import { triggerConfig, triggerRules } from './trigger-rules.config.js';
import { registerEvent, getEntry, getLastFired, markRuleFired } from './trigger-store.js';
import { executeAction } from './trigger-actions.js';

/**
 * Verifica que todos los eventos requeridos de la regla hayan llegado
 * (sin importar el orden).
 */
const ruleSatisfied = (rule, entry) =>
    rule.requiredEvents.every((key) => Boolean(entry.events[key]));

/**
 * Verifica que haya llegado una NUEVA ocurrencia de algún evento requerido
 * desde la última vez que la regla disparó (para no re-disparar cuando
 * llega un evento que no pertenece a la regla).
 */
const hasNewOccurrence = (rule, entry, lastFired) => {
    if (lastFired == null) return true;
    return rule.requiredEvents.some((key) => entry.events[key].lastSeenAt > lastFired);
};

/**
 * Verifica la ventana de repetición de la regla:
 *   - rule.enabled === false → no dispara
 *   - sin nueva ocurrencia desde el último disparo → no dispara
 *   - repeatWindowMs <= 0    → repite siempre (en cada nueva ocurrencia)
 *   - si hay lastFired, no dispara hasta que pase la ventana
 */
const canFire = (rule, entry) => {
    if (rule.enabled === false) return false;

    const lastFired = getLastFired(entry, rule.id);
    if (!hasNewOccurrence(rule, entry, lastFired)) return false;
    if (!rule.repeatWindowMs || rule.repeatWindowMs <= 0) return true;
    if (lastFired == null) return true;
    return Date.now() - lastFired >= rule.repeatWindowMs;
};

/**
 * Procesa un evento entrante del portal:
 *   1. Si el motor está desactivado (triggerConfig.enabled=false) → no-op.
 *   2. Registra el evento en el estado del email.
 *   3. Evalúa TODAS las reglas activas contra el estado.
 *   4. Dispara las reglas cumplidas y dentro de ventana, ejecutando su acción.
 *
 * Los eventos del MISMO email se serializan (cola en memoria) para evitar
 * carreras: sin esto, si llegan dos eventos seguidos (ej. login y robot
 * encendido), el segundo puede evaluarse antes de que el primero marque
 * lastFired y re-disparar una regla duplicando la nota.
 */
const processEventInner = async ({ email, robotId, eventKey, data }) => {
    if (!triggerConfig.enabled) {
        console.log(`[triggers-engine] Motor DESACTIVADO (triggerConfig.enabled=false). Evento ignorado: ${eventKey} (${email})`);
        return { processed: false, reason: 'engine_disabled' };
    }

    const entry = registerEvent(email, robotId, eventKey, data);
    console.log(`[triggers-engine] Evento registrado: ${eventKey} | ${email}`);

    const fired = [];

    for (const rule of triggerRules) {
        if (!ruleSatisfied(rule, entry)) continue;
        if (!canFire(rule, entry)) continue;

        try {
            console.log(`[triggers-engine] Disparando regla "${rule.id}" para ${email}`);
            await executeAction(rule, entry, eventKey);
            markRuleFired(email, rule.id, Date.now());
            fired.push(rule.id);
        } catch (err) {
            console.error(`[triggers-engine] ✗ Error ejecutando regla "${rule.id}" (${email}):`, err.message);
            if (err.response?.status) console.error(`  HTTP ${err.response.status}`);
            if (err.response?.data)   console.error('  Detalle:', JSON.stringify(err.response.data));
        }
    }

    if (fired.length === 0) {
        const hasRule = triggerRules.some((r) => r.requiredEvents.includes(eventKey));
        if (!hasRule) {
            console.log(`[triggers-engine] Evento "${eventKey}" sin regla configurada — ignorado (${email})`);
        } else {
            console.log(`[triggers-engine] Ninguna regla disparada para ${email}`);
        }
    }

    return { processed: true, fired };
};

// Cola por email: serializa el procesamiento de eventos del mismo email.
// Sin esto, dos eventos seguidos (ej. login + robot) podrían evaluarse en
// paralelo y re-disparar una regla (nota duplicada).
const queues = new Map();

/**
 * Punto de entrada del motor.
 * Serializa los eventos del MISMO email (cola en memoria) y delega en
 * `processEventInner`. Devuelve una promesa con el resultado del evento.
 *
 * @param {Object} params
 * @param {string} params.email
 * @param {string|null} params.robotId
 * @param {string} params.eventKey  - eventName enviado por el portal
 * @param {Object} params.data      - payload completo del evento
 * @returns {Promise<{processed: boolean, fired: string[], reason?: string}>}
 */
export const processEvent = async (params) => {
    const prev = queues.get(params.email) || Promise.resolve();
    const task = prev.then(() => processEventInner(params));
    queues.set(params.email, task);
    task.finally(() => {
        if (queues.get(params.email) === task) queues.delete(params.email);
    });
    return task;
};
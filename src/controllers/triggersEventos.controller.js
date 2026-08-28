import { processEvent } from '../services/triggers/trigger-engine.js';

/**
 * POST /api/v2/triggers/events
 *
 * Endpoint único para recibir eventos del Portal de Recetas. El tipo de
 * evento llega en el body como `eventName` (ej: "login-portal",
 * "robot-encendido" o cualquier evento/campaña nuevo).
 *
 * Adaptador HTTP delgado: valida eventName y email, responde 202 y delega el
 * procesamiento al motor de triggers (trigger-engine), que según la
 * configuración en src/services/triggers/trigger-rules.config.js decide qué
 * combinación de eventos dispara una conversación y con qué nota.
 *
 * Los eventNames desconocidos se aceptan (202) y se registran, pero no hacen
 * nada hasta que se configure una regla para ellos.
 *
 * Body esperado (evento del portal de recetas):
 * { "eventName", "clientId", "clientName", "robotId", "email", "cellphone", ... }
 */
const processTriggerEvent = async (req, res) => {
    const event = req.body || {};
    const eventName = (event.eventName || '').trim();
    const email = (event.email || '').trim();

    if (!eventName) {
        console.error('[triggers-eventos] Body inválido. Recibido:', JSON.stringify(req.body));
        return res.status(400).json({
            success: false,
            error: 'Body inválido: se requiere eventName'
        });
    }

    if (!email.includes('@')) {
        console.error(`[triggers-eventos] Body inválido (${eventName}). Recibido:`, JSON.stringify(req.body));
        return res.status(400).json({
            success: false,
            error: 'Body inválido: se requiere un email válido'
        });
    }

    console.log(`[triggers-eventos] Evento "${eventName}" recibido para: ${email}`);

    // Responder inmediatamente (202) para evitar reintentos del portal
    res.status(202).json({
        success: true,
        message: 'Procesando en background',
        event: eventName
    });

    setImmediate(async () => {
        try {
            const result = await processEvent({
                email,
                robotId: event.robotId || null,
                eventKey: eventName,
                data: event
            });
            console.log(`[triggers-eventos] "${eventName}" procesado (${email}):`, result);
        } catch (err) {
            console.error(`[triggers-eventos] ✗ ERROR procesando "${eventName}" (${email}):`, err.message);
            if (err.response?.status) console.error(`  HTTP ${err.response.status}`);
            if (err.response?.data)   console.error('  Detalle:', JSON.stringify(err.response.data));
        }
    });
};

export default processTriggerEvent;
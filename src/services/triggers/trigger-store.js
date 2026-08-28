import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.resolve(__dirname, '..', '..', '..', 'data', 'triggers_state.json');

/**
 * Registro de eventos del motor de triggers, agrupado por email.
 *
 * Estructura de cada entrada:
 * {
 *   email, robotId,
 *   events:    { [eventKey]: { firstSeenAt, lastSeenAt, data } },
 *   lastFired: { [ruleId]: timestamp },
 *   updatedAt
 * }
 *
 * Se persiste en data/triggers_state.json para sobrevivir reinicios.
 */
let state = new Map();

const load = () => {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
            state = new Map(Object.entries(raw));
        }
    } catch (err) {
        console.error('[triggers-store] Error cargando estado:', err.message);
    }
};

let saveTimer = null;
const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
            fs.writeFileSync(STATE_FILE, JSON.stringify(Object.fromEntries(state), null, 2));
        } catch (err) {
            console.error('[triggers-store] Error guardando estado:', err.message);
        }
    }, 500);
};

/** Devuelve la entrada del store para un email (o null). */
export const getEntry = (email) => state.get(email) || null;

/** Devuelve (o crea) la entrada del store para un email. */
export const ensureEntry = (email, robotId) => {
    let entry = state.get(email);
    if (!entry) {
        entry = { email, robotId: robotId || null, events: {}, lastFired: {}, updatedAt: Date.now() };
        state.set(email, entry);
    } else if (robotId && entry.robotId !== robotId) {
        entry.robotId = robotId;
    }
    return entry;
};

/**
 * Registra la llegada de un evento para el email: actualiza lastSeenAt y
 * data (o crea la entrada del evento si es la primera vez).
 */
export const registerEvent = (email, robotId, eventKey, data) => {
    const entry = ensureEntry(email, robotId);
    const now = Date.now();
    const existing = entry.events[eventKey];
    if (existing) {
        existing.lastSeenAt = now;
        existing.data = data;
    } else {
        entry.events[eventKey] = { firstSeenAt: now, lastSeenAt: now, data };
    }
    entry.updatedAt = now;
    persist();
    return entry;
};

/** Registra la fecha/hora en que una regla disparó para un email. */
export const markRuleFired = (email, ruleId, timestamp) => {
    const entry = getEntry(email);
    if (!entry) return;
    entry.lastFired[ruleId] = timestamp;
    entry.updatedAt = timestamp;
    persist();
};

/** Última fecha/hora en que la regla disparó para ese email (o null). */
export const getLastFired = (entry, ruleId) => entry.lastFired[ruleId] || null;

load();
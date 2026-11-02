import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Store persistente y mínimo para los eventos de afiliados.
 *
 * Se mantiene en JSON para no agregar una dependencia ni tocar la base actual
 * del hub. La escritura se serializa y se hace sobre un archivo temporal para
 * evitar archivos parciales.
 *
 * El path se puede cambiar con AFFILIATE_EVENT_STORE_PATH.
 */
const DEFAULT_STORE_PATH = path.join(process.cwd(), 'data', 'affiliate-events.json');
const STORE_PATH = process.env.AFFILIATE_EVENT_STORE_PATH || DEFAULT_STORE_PATH;

let statePromise = null;
let writeQueue = Promise.resolve();

const emptyState = () => ({
    version: 1,
    updated_at: new Date().toISOString(),
    events: {},
});

const clone = (value) => JSON.parse(JSON.stringify(value));

async function loadState() {
    if (statePromise) {
        return statePromise;
    }

    statePromise = (async () => {
        try {
            const raw = await fs.readFile(STORE_PATH, 'utf8');
            const parsed = JSON.parse(raw);

            if (!parsed || typeof parsed !== 'object') {
                return emptyState();
            }

            if (!parsed.events || typeof parsed.events !== 'object') {
                parsed.events = {};
            }

            return parsed;
        } catch (error) {
            if (error.code === 'ENOENT') {
                return emptyState();
            }

            console.error(`[affiliate-events] No se pudo leer el store (${STORE_PATH}):`, error.message);
            return emptyState();
        }
    })();

    return statePromise;
}

async function persistState(state) {
    writeQueue = writeQueue.then(async () => {
        const directory = path.dirname(STORE_PATH);
        await fs.mkdir(directory, { recursive: true });

        state.updated_at = new Date().toISOString();
        const tempPath = `${STORE_PATH}.${process.pid}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(state, null, 2), 'utf8');
        await fs.rename(tempPath, STORE_PATH);
    });

    return writeQueue;
}

function now() {
    return new Date().toISOString();
}

export async function getAffiliateEvent(eventId) {
    const state = await loadState();
    const event = state.events[String(eventId)];

    return event ? clone(event) : null;
}

/**
 * Registra un evento recibido. No lo marca como procesado.
 *
 * Si ya existe y estaba en estado terminal, devuelve duplicate=true.
 * Si existe en un estado recuperable (pending_handler/failed), actualiza el
 * payload y permite reintentar.
 */
export async function registerAffiliateEvent(event) {
    const state = await loadState();
    const eventId = String(event.event_id);
    const existing = state.events[eventId] || null;

    if (existing && [ 'processing', 'processed' ].includes(existing.status)) {
        return { duplicate: true, event: clone(existing) };
    }

    const record = {
        ...(existing || {}),
        event_id: eventId,
        event_name: event.event_name,
        source: event.source || existing?.source || 'wordpress',
        status: 'received',
        attempts: existing?.attempts || 0,
        last_error: existing?.last_error || '',
        received_at: existing?.received_at || now(),
        updated_at: now(),
        payload: clone(event),
    };

    state.events[eventId] = record;
    await persistState(state);

    return { duplicate: false, event: clone(record) };
}

export async function markAffiliateEvent(eventId, status, patch = {}) {
    const state = await loadState();
    const eventIdString = String(eventId);
    const existing = state.events[eventIdString];

    if (!existing) {
        return null;
    }

    const updated = {
        ...existing,
        ...patch,
        status,
        updated_at: now(),
    };

    state.events[eventIdString] = updated;
    await persistState(state);

    return clone(updated);
}

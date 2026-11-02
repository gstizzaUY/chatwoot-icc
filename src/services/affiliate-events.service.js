import {
    AFFILIATE_EVENT_NAMES,
    AFFILIATE_EVENT_STATUS,
} from '../constants/affiliate.constants.js';
import {
    getAffiliateEvent,
    registerAffiliateEvent,
    markAffiliateEvent,
} from './affiliate-event-store.service.js';

/**
 * Handlers de negocio del programa de afiliados.
 *
 * Fase 1: la infraestructura de eventos queda lista, pero los handlers de
 * negocio se incorporan en las fases siguientes. No se marca un evento como
 * procesado si todavía no existe handler; queda en pending_handler para poder
 * reintentarlo sin perder el evento.
 */
const HANDLERS = {
    [AFFILIATE_EVENT_NAMES.SELLER_CREATED]: async () => pendingHandler(),
    [AFFILIATE_EVENT_NAMES.SELLER_UPDATED]: async () => pendingHandler(),
    [AFFILIATE_EVENT_NAMES.SELLER_LOVER_LINKED]: async () => pendingHandler(),
    [AFFILIATE_EVENT_NAMES.LEAD_CREATED]: async () => pendingHandler(),
    [AFFILIATE_EVENT_NAMES.LEAD_SELLER_ASSIGNED]: async () => pendingHandler(),
    [AFFILIATE_EVENT_NAMES.LEAD_SELLER_CONFIRMED]: async () => pendingHandler(),
    [AFFILIATE_EVENT_NAMES.LEAD_SELLER_REASSIGNED]: async () => pendingHandler(),
};

function pendingHandler() {
    return {
        ok: false,
        reason: 'handler_not_implemented',
    };
}

export function isAffiliateEventEnabled() {
    return process.env.AFFILIATE_EVENTS_ENABLED === 'true';
}

export function isKnownAffiliateEvent(eventName) {
    return Object.values(AFFILIATE_EVENT_NAMES).includes(eventName);
}

export async function acceptAffiliateEvent(event) {
    return registerAffiliateEvent(event);
}

/**
 * Procesa un evento ya aceptado.
 *
 * Es idempotente a nivel de estado: si ya está processed no lo vuelve a
 * ejecutar. Los eventos pending_handler/failed pueden reintentarse.
 */
export async function processAffiliateEvent(eventId) {
    const event = await getAffiliateEvent(eventId);

    if (!event) {
        return { processed: false, reason: 'not_found' };
    }

    if (event.status === AFFILIATE_EVENT_STATUS.PROCESSED) {
        return { processed: true, reason: 'already_processed' };
    }

    if (event.status === AFFILIATE_EVENT_STATUS.PROCESSING) {
        return { processed: false, reason: 'already_processing' };
    }

    await markAffiliateEvent(eventId, AFFILIATE_EVENT_STATUS.PROCESSING, {
        attempts: Number(event.attempts || 0) + 1,
        last_error: '',
    });

    const handler = HANDLERS[event.event_name];

    if (!handler) {
        return markAffiliateEvent(eventId, AFFILIATE_EVENT_STATUS.FAILED, {
            last_error: `Handler no encontrado para ${event.event_name}`,
        });
    }

    try {
        const result = await handler(event);

        if (result && result.ok === false) {
            return markAffiliateEvent(eventId, AFFILIATE_EVENT_STATUS.PENDING_HANDLER, {
                last_error: result.reason || 'handler_pending',
            });
        }

        return markAffiliateEvent(eventId, AFFILIATE_EVENT_STATUS.PROCESSED, {
            last_error: '',
            processed_at: new Date().toISOString(),
        });
    } catch (error) {
        console.error(`[affiliate-events] Error procesando ${event.event_name} (${eventId}):`, error.message);
        return markAffiliateEvent(eventId, AFFILIATE_EVENT_STATUS.FAILED, {
            last_error: error.message,
        });
    }
}

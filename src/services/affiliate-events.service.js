import {
    AFFILIATE_EVENT_NAMES,
    AFFILIATE_EVENT_STATUS,
} from '../constants/affiliate.constants.js';
import {
    getAffiliateEvent,
    registerAffiliateEvent,
    markAffiliateEvent,
} from './affiliate-event-store.service.js';
import {
    syncLeadCreatedEvent,
    syncSellerEvent,
} from './affiliate-program.service.js';
import { syncAssignmentEvent } from './affiliate-opportunity.service.js';

/**
 * Handlers de negocio del programa de afiliados.
 *
 * Fase 3: Sellers y leads se sincronizan con RD Marketing y Chatwoot cuenta 2.
 * Fase 4: las asignaciones reutilizan y actualizan el deal existente.
 * Los eventos sin handler o sin deal disponible quedan en pending_handler.
 */
const HANDLERS = {
    [AFFILIATE_EVENT_NAMES.SELLER_CREATED]: syncSellerEvent,
    [AFFILIATE_EVENT_NAMES.SELLER_UPDATED]: syncSellerEvent,
    [AFFILIATE_EVENT_NAMES.SELLER_LOVER_LINKED]: syncSellerEvent,
    [AFFILIATE_EVENT_NAMES.LEAD_CREATED]: syncLeadCreatedEvent,
    // Fase 4: reutilización/actualización de la oportunidad existente.
    [AFFILIATE_EVENT_NAMES.LEAD_SELLER_ASSIGNED]: syncAssignmentEvent,
    [AFFILIATE_EVENT_NAMES.LEAD_SELLER_CONFIRMED]: syncAssignmentEvent,
    [AFFILIATE_EVENT_NAMES.LEAD_SELLER_REASSIGNED]: syncAssignmentEvent,
};

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
 * Normaliza el registro persistido al evento de dominio que esperan los
 * handlers (el store lo guarda dentro de `payload`).
 */
export function getAffiliateEventPayload(event) {
    return event?.payload && typeof event.payload === 'object'
        ? event.payload
        : event;
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
        // El store guarda el payload dentro de `payload`; los handlers de
        // negocio reciben el evento de dominio, no el registro de persistencia.
        const result = await handler(getAffiliateEventPayload(event));

        if (result && result.ok === false) {
            return markAffiliateEvent(eventId, AFFILIATE_EVENT_STATUS.PENDING_HANDLER, {
                last_error: result.reason || 'handler_pending',
            });
        }

        const patch = result && result.patch && typeof result.patch === 'object'
            ? result.patch
            : {};

        return markAffiliateEvent(eventId, AFFILIATE_EVENT_STATUS.PROCESSED, {
            ...patch,
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

import {
    acceptAffiliateEvent,
    isAffiliateEventEnabled,
    isKnownAffiliateEvent,
    processAffiliateEvent,
} from '../services/affiliate-events.service.js';
import { getAffiliateEvent } from '../services/affiliate-event-store.service.js';

function getEventId(body) {
    return String(body?.event_id || '').trim();
}

/**
 * POST /api/v2/affiliates/events
 *
 * Endpoint de entrada de WordPress. Responde 202 y procesa en background.
 * La autenticación se aplica en la ruta con AFFILIATE_EVENTS_SECRET.
 */
export async function receiveAffiliateEvent(req, res) {
    try {
        const event = req.body || {};
        const eventId = getEventId(event);
        const eventName = String(event.event_name || '').trim();

        if (!eventId) {
            return res.status(400).json({
                success: false,
                error: 'event_id es obligatorio',
            });
        }

        if (!eventName) {
            return res.status(400).json({
                success: false,
                error: 'event_name es obligatorio',
            });
        }

        if (!isKnownAffiliateEvent(eventName)) {
            return res.status(400).json({
                success: false,
                error: `event_name desconocido: ${eventName}`,
            });
        }

        if (!event.source) {
            event.source = 'wordpress';
        }

        if (!isAffiliateEventEnabled()) {
            return res.status(202).json({
                success: true,
                accepted: false,
                disabled: true,
                event_id: eventId,
                event_name: eventName,
                message: 'AFFILIATE_EVENTS_ENABLED no está activo',
            });
        }

        const registration = await acceptAffiliateEvent(event);

        if (registration.duplicate) {
            return res.status(202).json({
                success: true,
                duplicate: true,
                event_id: eventId,
                event_name: eventName,
                status: registration.event.status,
            });
        }

        res.status(202).json({
            success: true,
            accepted: true,
            event_id: eventId,
            event_name: eventName,
            status: 'received',
        });

        setImmediate(() => {
            processAffiliateEvent(eventId).catch((error) => {
                console.error(`[affiliate-events] Error en background (${eventId}):`, error.message);
            });
        });
    } catch (error) {
        console.error('[affiliate-events] Error recibiendo evento:', error.message);
        return res.status(500).json({
            success: false,
            error: 'No se pudo registrar el evento',
        });
    }
}

/**
 * GET /api/v2/affiliates/events/:eventId
 * Inspección de estado para operación/soporte. No modifica nada.
 */
export async function getAffiliateEventStatus(req, res) {
    try {
        const event = await getAffiliateEvent(req.params.eventId);

        if (!event) {
            return res.status(404).json({
                success: false,
                error: 'Evento no encontrado',
            });
        }

        return res.status(200).json({
            success: true,
            event,
        });
    } catch (error) {
        console.error('[affiliate-events] Error consultando evento:', error.message);
        return res.status(500).json({
            success: false,
            error: 'No se pudo consultar el evento',
        });
    }
}

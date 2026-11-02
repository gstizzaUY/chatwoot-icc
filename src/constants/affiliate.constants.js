/**
 * Contrato de eventos WordPress → hub para el programa de afiliados.
 *
 * Estos son eventos internos del hub. Los identificadores de conversión de
 * RD Station son distintos:
 *   - seller-asignado
 *   - referido-asignado
 *   - referido-portal
 */
export const AFFILIATE_EVENT_NAMES = Object.freeze({
    SELLER_CREATED: 'seller.created',
    SELLER_UPDATED: 'seller.updated',
    SELLER_LOVER_LINKED: 'seller.lover_linked',
    LEAD_CREATED: 'lead.created',
    LEAD_SELLER_ASSIGNED: 'lead.seller_assigned',
    LEAD_SELLER_CONFIRMED: 'lead.seller_confirmed',
    LEAD_SELLER_REASSIGNED: 'lead.seller_reassigned',
});

export const AFFILIATE_EVENT_NAME_LIST = Object.freeze(Object.values(AFFILIATE_EVENT_NAMES));

export const AFFILIATE_EVENT_STATUS = Object.freeze({
    RECEIVED: 'received',
    PROCESSING: 'processing',
    PENDING_HANDLER: 'pending_handler',
    PROCESSED: 'processed',
    FAILED: 'failed',
});

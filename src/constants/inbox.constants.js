/**
 * Constantes de canales/inboxes de Chatwoot
 *
 * Mapea cada inbox_id de Chatwoot a un slug normalizado (para nombres de eventos
 * de RD Station) y a un canal legible. La lista se mantiene en sincronía con los
 * inboxes reales de la cuenta de Chatwoot (consultar con GET /api/v1/accounts/:id/inboxes).
 */

export const INBOX_TO_CHANNEL = {
    1:  { slug: 'correo-marty',          channel: 'email' },
    12: { slug: 'correo-comercial',      channel: 'email' },
    13: { slug: 'manual-telefono',       channel: 'api' },
    14: { slug: 'manual-wpp',            channel: 'api' },
    15: { slug: 'manual-presencial',     channel: 'api' },
    20: { slug: 'pre-venta-sdr',         channel: 'api' },
    23: { slug: 'ichef-marty-wpp',       channel: 'whatsapp' },
    33: { slug: 'correo-marty-mkt-rd',   channel: 'email' },
    34: { slug: 'ichef-center-wpp',      channel: 'whatsapp' },
    38: { slug: 'experiencias-ichef-wpp', channel: 'whatsapp' },
    41: { slug: 'actualizaciones-firmware', channel: 'api' },
    46: { slug: 'ichef-mkt-wpp',         channel: 'whatsapp' },
    47: { slug: 'ichef-sistemas-wpp',    channel: 'whatsapp' },
    48: { slug: 'ichef-comercial-wpp',   channel: 'whatsapp' },
    54: { slug: 'ichefuy',               channel: 'instagram' }
};

/**
 * Devuelve la configuración de canal para un inbox_id
 *
 * @param {number} inboxId - ID del inbox en Chatwoot
 * @returns {{slug: string, channel: string}} - Configuración del inbox
 */
export function getInboxChannel(inboxId) {
    const config = INBOX_TO_CHANNEL[inboxId];
    if (config) {
        return config;
    }
    // Fallback para inboxes desconocidos
    return {
        slug: `inbox-${inboxId}`,
        channel: 'otro'
    };
}

/**
 * Devuelve el slug normalizado de un inbox (para nombres de eventos de RD Station)
 *
 * @param {number} inboxId - ID del inbox en Chatwoot
 * @returns {string} - Slug del inbox (ej: 'ichef-center-wpp')
 */
export function getInboxSlug(inboxId) {
    return getInboxChannel(inboxId).slug;
}

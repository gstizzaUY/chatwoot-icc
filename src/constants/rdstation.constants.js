/**
 * Constantes de conversión para RD Station
 * 
 * Estos son los identificadores de conversión que se pueden usar
 * al enviar eventos de conversión a RD Station
 */

export const RD_CONVERSIONS = {
    // Conversaciones básicas
    CONVERSATION_CLOSED: 'conversation-closed',
    CONVERSATION_ANALYZED: 'conversation-analyzed',
    
    // Leads
    LEAD_QUALIFICATION: 'lead-qualification',
    LEAD_CONTACT: 'lead-contact',
    
    // Demos y pruebas
    DEMO_REQUESTED: 'demo-requested',
    DEMO_COMPLETED: 'demo-completed',
    TRIAL_STARTED: 'trial-started',
    
    // Onboarding
    ONBOARDING_STARTED: 'onboarding-started',
    ONBOARDING_COMPLETED: 'onboarding-completed',
    
    // Ventas
    PURCHASE_COMPLETED: 'purchase-completed',
    CONTRACT_SIGNED: 'contract-signed',
    
    // Engagement
    WEBINAR_REGISTERED: 'webinar-registered',
    WEBINAR_ATTENDED: 'webinar-attended',
    CONTENT_DOWNLOADED: 'content-downloaded',

    // Social
    INSTAGRAM_MESSAGE_RECEIVED: 'instagram-message-received',
    
    // Soporte
    SUPPORT_TICKET_CREATED: 'support-ticket-created',
    SUPPORT_TICKET_RESOLVED: 'support-ticket-resolved'
};

/**
 * Mapeo de etiquetas de Chatwoot a conversiones de RD Station
 */
export const LABEL_TO_CONVERSION = {
    'demo': RD_CONVERSIONS.DEMO_REQUESTED,
    'cliente': RD_CONVERSIONS.PURCHASE_COMPLETED,
    'trial': RD_CONVERSIONS.TRIAL_STARTED,
    'webinar': RD_CONVERSIONS.WEBINAR_REGISTERED
};

/**
 * Obtiene el identificador de conversión basado en las etiquetas
 * 
 * @param {string[]} labels - Array de etiquetas de la conversación
 * @returns {string} - Identificador de conversión
 */
export function getConversionFromLabels(labels = []) {
    for (const label of labels) {
        if (LABEL_TO_CONVERSION[label]) {
            return LABEL_TO_CONVERSION[label];
        }
    }
    
    // Default: conversación cerrada
    return RD_CONVERSIONS.CONVERSATION_CLOSED;
}

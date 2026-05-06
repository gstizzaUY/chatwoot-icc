/**
 * Constantes para sistema de agentes IA
 */

// Tipos de agentes disponibles
export const AGENT_TYPES = {
    PRE_VENTA: 'pre-venta',
    POST_VENTA: 'post-venta',
    RESUMEN: 'resumen'
};

// Canales de pre-venta (comerciales)
export const PRE_VENTA_CHANNELS = [
    23, // iChef Marty Wpp
    33, // Correo Marty MKT-RD
    1,  // Correo Marty
    20, // Pre-Venta SDR
    34, // iChef Center Wpp
    46, // iChef MKT Wpp
    12, // Correo Comercial
    45  // iChef Comercial Wpp
];

// Canales de post-venta
export const POST_VENTA_CHANNELS = [
    41, // Actualizaciones Firmware
    38  // Experiencias iChef Wpp
];

// Mapeo de canales a tipos de agente
export const CHANNEL_TO_AGENT = {
    // Pre-venta
    23: AGENT_TYPES.PRE_VENTA,
    33: AGENT_TYPES.PRE_VENTA,
    1: AGENT_TYPES.PRE_VENTA,
    20: AGENT_TYPES.PRE_VENTA,
    34: AGENT_TYPES.PRE_VENTA,
    46: AGENT_TYPES.PRE_VENTA,
    12: AGENT_TYPES.PRE_VENTA,
    45: AGENT_TYPES.PRE_VENTA,
    
    // Post-venta
    41: AGENT_TYPES.POST_VENTA,
    38: AGENT_TYPES.POST_VENTA
};

// Configuración de triggers por tipo de agente
export const AGENT_TRIGGERS = {
    [AGENT_TYPES.PRE_VENTA]: {
        events: ['message_created'],    // Eventos que activan este agente
        onMessageNumber: [1],           // Se activa en mensaje inicial del cliente
        everyNMessages: 3               // Y luego cada 3 mensajes del cliente
    },
    [AGENT_TYPES.POST_VENTA]: {
        events: ['message_created'],
        onMessageNumber: [1],
        everyNMessages: 3
    },
    [AGENT_TYPES.RESUMEN]: {
        events: ['conversation_status_changed'],
        status: ['resolved']            // Solo cuando se cierra la conversación
    }
};

// Configuración de rate limiting por agente
export const AGENT_RATE_LIMITS = {
    [AGENT_TYPES.PRE_VENTA]: {
        maxPerConversation: 20,     // Máximo 20 análisis por conversación
        cooldown: 60000             // 1 minuto entre análisis
    },
    [AGENT_TYPES.POST_VENTA]: {
        maxPerConversation: 20,
        cooldown: 60000
    },
    [AGENT_TYPES.RESUMEN]: {
        maxPerConversation: 1,      // Solo 1 vez al cerrar
        cooldown: 0
    }
};

// Campos críticos que requieren protección
export const PROTECTED_FIELDS = {
    NEVER_DOWNGRADE: ['tiene_ichef', 'es_cliente'], // Nunca retroceder de "Sí"
    FORWARD_ONLY: ['stage'],                        // Solo avanzar en funnel
    PRIORITY_REAL: ['email']                        // Priorizar datos reales
};

// Jerarquía de stages (menor a mayor)
export const STAGE_HIERARCHY = {
    'lead': 0,
    'prospect': 0,
    'marketingQualifiedLead': 1,
    'mql': 1,
    'salesQualifiedLead': 2,
    'sql': 2,
    'opportunity': 3,
    'oportunidad': 3,
    'customer': 4,
    'cliente': 4
};

// Contactos excluidos (conversaciones internas)
// Los agentes NO deben procesar estos contactos
export const EXCLUDED_CONTACT_IDS = [
    24148,  // Contacto interno
    24155,  // Contacto interno
    9613,   // Contacto interno
    6724,   // Contacto interno
    24203,  // Contacto interno
    24153,  // Contacto interno
    7574,   // Contacto interno
    11974,  // Contacto interno
    7631,   // Contacto interno
    25573   // Contacto interno
];

/**
 * Utilidades para extraer información estructurada de mensajes de conversaciones
 */

/**
 * Extrae información del contacto desde los mensajes de una conversación
 * Busca patrones comunes como emails, confirmaciones de compra, etc.
 * 
 * @param {Array} messages - Array de mensajes de la conversación
 * @param {Object} currentContact - Contacto actual con datos existentes
 * @returns {Object} - Información extraída { email, lastname, tiene_ichef, es_cliente, otros_datos }
 */
export function extractContactInfoFromMessages(messages, currentContact = {}) {
    const extractedInfo = {
        email: null,
        lastname: null,
        firstname: null,
        tiene_ichef: null,
        es_cliente: null,
        id_equipo: null,
        city: null,
        country: null,
        metadata: {
            confidence: 'low', // low, medium, high
            sources: []
        }
    };

    // Filtrar solo mensajes del cliente (incoming) que sean TEXTO
    // Chatwoot usa message_type: 0=incoming, 1=outgoing, 2=activity
    // NOTA: Por ahora ignora multimedia (attachments), solo procesa texto
    // TODO: En el futuro, agregar soporte para analizar contenido de multimedia
    const customerMessages = messages.filter(msg => {
        // Solo mensajes entrantes del cliente
        const isIncoming = msg.message_type === 0 || msg.message_type === 'incoming';
        
        // Ignorar mensajes multimedia (imágenes, videos, documentos)
        const hasAttachments = msg.attachments && msg.attachments.length > 0;
        
        return isIncoming && !hasAttachments;
    });

    for (const message of customerMessages) {
        const content = message.content?.toLowerCase() || '';

        // Extraer email
        const emailMatch = content.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
        if (emailMatch && !extractedInfo.email) {
            extractedInfo.email = emailMatch[0];
            extractedInfo.metadata.sources.push('email_mentioned');
        }

        // Detectar si tiene iChef (menciones explícitas)
        if (
            content.includes('tengo ichef') ||
            content.includes('compré ichef') ||
            content.includes('mi ichef') ||
            content.includes('ya tengo el equipo') ||
            content.includes('ya compré')
        ) {
            extractedInfo.tiene_ichef = 'Sí';
            extractedInfo.metadata.sources.push('ichef_mentioned');
        }

        // Detectar número de serie
        const serialMatch = content.match(/\b([A-Z0-9]{8,})\b/);
        if (serialMatch && !extractedInfo.id_equipo) {
            extractedInfo.id_equipo = serialMatch[0];
            extractedInfo.metadata.sources.push('serial_detected');
        }

        // Detectar ciudad
        const cities = ['montevideo', 'salto', 'paysandú', 'maldonado', 'colonia', 'canelones'];
        for (const city of cities) {
            if (content.includes(city)) {
                extractedInfo.city = city.charAt(0).toUpperCase() + city.slice(1);
                extractedInfo.metadata.sources.push('city_mentioned');
                break;
            }
        }
    }

    // Analizar mensajes del agente para confirmar información
    // También filtrar multimedia de los mensajes del agente
    const agentMessages = messages.filter(msg => {
        const isOutgoing = (msg.message_type === 1 || msg.message_type === 'outgoing') && !msg.private;
        const hasAttachments = msg.attachments && msg.attachments.length > 0;
        
        return isOutgoing && !hasAttachments;
    });
    
    for (const message of agentMessages) {
        const content = message.content?.toLowerCase() || '';

        // Si el agente confirma que es cliente
        if (
            content.includes('ya eres cliente') ||
            content.includes('veo que ya compraste') ||
            content.includes('tienes registrado')
        ) {
            extractedInfo.es_cliente = 'Sí';
            extractedInfo.tiene_ichef = 'Sí';
            extractedInfo.metadata.confidence = 'high';
            extractedInfo.metadata.sources.push('agent_confirmed_customer');
        }
    }

    // NOTA: NO asumir que tiene_ichef implica es_cliente
    // Una persona puede tener/usar un iChef sin haberlo comprado (regalo, familiar, etc)

    // Calcular confianza general
    const sourceCount = extractedInfo.metadata.sources.length;
    if (sourceCount >= 3) {
        extractedInfo.metadata.confidence = 'high';
    } else if (sourceCount >= 1) {
        extractedInfo.metadata.confidence = 'medium';
    }

    // Si no hay email extraído, usar el del contacto actual
    if (!extractedInfo.email && currentContact.email) {
        extractedInfo.email = currentContact.email;
    }

    return extractedInfo;
}

/**
 * Determina las etiquetas apropiadas basándose en la información extraída
 * 
 * @param {Object} extractedInfo - Información extraída de los mensajes
 * @param {Array} currentLabels - Etiquetas actuales de la conversación
 * @returns {Array} - Array de etiquetas a aplicar
 */
export function determineLabels(extractedInfo, currentLabels = []) {
    const labels = new Set(currentLabels);

    // Etiquetas basadas en tiene_ichef
    if (extractedInfo.tiene_ichef === 'Sí') {
        labels.add('tiene_ichef');
        labels.add('cliente');
        // Remover etiquetas contradictorias
        labels.delete('lead');
        labels.delete('prospecto');
    } else {
        labels.add('lead');
        labels.delete('tiene_ichef');
    }

    // Si es cliente confirmado
    if (extractedInfo.es_cliente === 'Sí') {
        labels.add('cliente');
        labels.delete('lead');
        labels.delete('prospecto');
    }

    // Si tiene serial, definitivamente es cliente
    if (extractedInfo.id_equipo) {
        labels.add('cliente');
        labels.add('tiene_ichef');
        labels.add('serial_registrado');
        labels.delete('lead');
    }

    return Array.from(labels);
}

/**
 * Analiza el sentimiento general de la conversación
 * 
 * @param {Array} messages - Array de mensajes
 * @returns {Object} - { sentiment: 'positive' | 'neutral' | 'negative', reason: string }
 */
export function analyzeSentiment(messages) {
    // Filtrar mensajes del cliente: message_type 0 o 'incoming'
    const customerMessages = messages.filter(msg => msg.message_type === 0 || msg.message_type === 'incoming');
    
    let positiveCount = 0;
    let negativeCount = 0;

    const positiveWords = [
        'gracias', 'excelente', 'perfecto', 'genial', 'bueno', 'bien',
        'feliz', 'encantado', 'satisfecho', 'contento', 'me gusta',
        'estoy feliz', 'funciona bien', 'resuelto'
    ];

    const negativeWords = [
        'problema', 'mal', 'error', 'falla', 'no funciona', 'molesto',
        'decepcionado', 'insatisfecho', 'roto', 'defectuoso', 'queja',
        'devolver', 'reembolso'
    ];

    for (const message of customerMessages) {
        const content = message.content?.toLowerCase() || '';

        for (const word of positiveWords) {
            if (content.includes(word)) {
                positiveCount++;
            }
        }

        for (const word of negativeWords) {
            if (content.includes(word)) {
                negativeCount++;
            }
        }
    }

    let sentiment = 'neutral';
    let reason = 'No se detectaron indicadores claros de sentimiento';

    if (positiveCount > negativeCount) {
        sentiment = 'positive';
        reason = `Cliente expresó satisfacción (${positiveCount} indicadores positivos)`;
    } else if (negativeCount > positiveCount) {
        sentiment = 'negative';
        reason = `Cliente expresó insatisfacción (${negativeCount} indicadores negativos)`;
    }

    return { sentiment, reason };
}

/**
 * Genera un resumen de la conversación
 * 
 * @param {Array} messages - Array de mensajes
 * @param {Object} extractedInfo - Información extraída
 * @returns {string} - Resumen de la conversación
 */
export function generateConversationSummary(messages, extractedInfo) {
    const topics = [];

    if (extractedInfo.tiene_ichef === 'Sí') {
        topics.push('Cliente con iChef');
    }

    if (extractedInfo.id_equipo) {
        topics.push(`Serial: ${extractedInfo.id_equipo}`);
    }

    if (extractedInfo.email) {
        topics.push(`Email: ${extractedInfo.email}`);
    }

    const messageCount = messages.length;
    // Chatwoot usa message_type numérico: 0=incoming (cliente), 1=outgoing (agente), 2=activity
    const customerMessageCount = messages.filter(m => m.message_type === 0 || m.message_type === 'incoming').length;

    const summary = `Conversación con ${messageCount} mensajes (${customerMessageCount} del cliente). ${topics.join(', ')}`;

    return summary;
}

/**
 * Valida la calidad de la información extraída
 * 
 * @param {Object} extractedInfo
 * @returns {Object} - { isValid: boolean, issues: Array, score: number }
 */
export function validateExtractedInfo(extractedInfo) {
    const issues = [];
    let score = 100;

    // Validar email si existe
    if (extractedInfo.email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(extractedInfo.email)) {
            issues.push('Email extraído tiene formato inválido');
            score -= 30;
        }
    } else {
        issues.push('No se pudo extraer email');
        score -= 10;
    }

    // Validar coherencia
    if (extractedInfo.id_equipo && extractedInfo.tiene_ichef !== 'Sí') {
        issues.push('Serial detectado pero tiene_ichef no marcado como Sí');
        score -= 20;
    }

    // Validar que si es cliente, debería tener el equipo
    // (pero tener equipo NO implica ser cliente)
    if (extractedInfo.es_cliente === 'Sí' && extractedInfo.tiene_ichef !== 'Sí') {
        issues.push('Marcado como cliente pero tiene_ichef no es Sí');
        score -= 15;
    }

    // Validar confianza
    if (extractedInfo.metadata.confidence === 'low') {
        issues.push('Confianza baja en la información extraída');
        score -= 25;
    }

    const isValid = score >= 50;

    return { isValid, issues, score };
}

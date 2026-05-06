import {
    ATTACHMENT_TYPES,
    AUDIO_FORMATS,
    IMAGE_FORMATS,
    DOCUMENT_FORMATS
} from '../constants/multimedia.constants.js';

/**
 * Mapper para clasificar y procesar attachments de Chatwoot
 */

/**
 * Clasifica un attachment por su tipo MIME
 * 
 * @param {Object} attachment - Attachment de Chatwoot
 * @returns {string} - Tipo de attachment (audio, image, document, video, other)
 */
export function classifyAttachment(attachment) {
    const fileType = attachment.file_type || '';

    // Verificar por MIME type exacto
    if (AUDIO_FORMATS.includes(fileType)) {
        return ATTACHMENT_TYPES.AUDIO;
    }

    if (IMAGE_FORMATS.includes(fileType)) {
        return ATTACHMENT_TYPES.IMAGE;
    }

    if (DOCUMENT_FORMATS.includes(fileType)) {
        return ATTACHMENT_TYPES.DOCUMENT;
    }

    // Verificar por prefijo de MIME type (más flexible)
    if (fileType.startsWith('audio/')) {
        return ATTACHMENT_TYPES.AUDIO;
    }

    if (fileType.startsWith('image/')) {
        return ATTACHMENT_TYPES.IMAGE;
    }

    if (fileType.startsWith('video/')) {
        return ATTACHMENT_TYPES.VIDEO;
    }

    // Tipos genéricos de Chatwoot (cuando la URL no tiene extensión visible)
    // Ejemplo: Rails Active Storage con URLs de redirección
    if (fileType === 'audio') {
        return ATTACHMENT_TYPES.AUDIO;
    }

    if (fileType === 'image') {
        return ATTACHMENT_TYPES.IMAGE;
    }

    if (fileType === 'video') {
        return ATTACHMENT_TYPES.VIDEO;
    }

    // Fallback: verificar por extensión del archivo
    const dataUrl = attachment.data_url || '';
    if (dataUrl) {
        const urlLower = dataUrl.toLowerCase();
        
        // Audio
        if (urlLower.match(/\.(mp3|m4a|wav|webm|ogg|aac|flac)(\?|$)/)) {
            return ATTACHMENT_TYPES.AUDIO;
        }
        
        // Imagen
        if (urlLower.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/)) {
            return ATTACHMENT_TYPES.IMAGE;
        }
        
        // Video
        if (urlLower.match(/\.(mp4|mov|avi|mkv|webm)(\?|$)/)) {
            return ATTACHMENT_TYPES.VIDEO;
        }
        
        // Documento
        if (urlLower.match(/\.(pdf|doc|docx)(\?|$)/)) {
            return ATTACHMENT_TYPES.DOCUMENT;
        }
    }

    return ATTACHMENT_TYPES.OTHER;
}

/**
 * Determina si un attachment es procesable por IA
 * 
 * @param {Object} attachment - Attachment de Chatwoot
 * @returns {boolean}
 */
export function isProcessable(attachment) {
    const type = classifyAttachment(attachment);
    
    // Solo procesar audio, imágenes y documentos
    return [
        ATTACHMENT_TYPES.AUDIO,
        ATTACHMENT_TYPES.IMAGE,
        ATTACHMENT_TYPES.DOCUMENT
    ].includes(type);
}

/**
 * Deriva el MIME type correcto desde la extensión del archivo
 * Usado cuando Chatwoot envía MIME types genéricos como "image" o "audio"
 * 
 * @param {string} url - URL del archivo
 * @returns {string|null} - MIME type derivado o null
 */
export function deriveMimeTypeFromUrl(url) {
    if (!url) return null;

    const urlLower = url.toLowerCase();
    
    // Imágenes
    if (urlLower.match(/\.jpe?g(\?|$)/)) return 'image/jpeg';
    if (urlLower.match(/\.png(\?|$)/)) return 'image/png';
    if (urlLower.match(/\.gif(\?|$)/)) return 'image/gif';
    if (urlLower.match(/\.webp(\?|$)/)) return 'image/webp';
    if (urlLower.match(/\.bmp(\?|$)/)) return 'image/bmp';
    
    // Audio
    if (urlLower.match(/\.mp3(\?|$)/)) return 'audio/mpeg';
    if (urlLower.match(/\.m4a(\?|$)/)) return 'audio/mp4';
    if (urlLower.match(/\.wav(\?|$)/)) return 'audio/wav';
    if (urlLower.match(/\.webm(\?|$)/)) return 'audio/webm';
    if (urlLower.match(/\.ogg(\?|$)/)) return 'audio/ogg';
    
    // Documentos
    if (urlLower.match(/\.pdf(\?|$)/)) return 'application/pdf';
    
    return null;
}

/**
 * Extrae metadata relevante de un attachment
 * 
 * @param {Object} attachment - Attachment de Chatwoot
 * @returns {Object}
 */
export function extractMetadata(attachment) {
    let fileType = attachment.file_type;
    
    console.log(`🔍 [extractMetadata] Attachment ${attachment.id}: file_type="${fileType}", url="${attachment.data_url?.substring(0, 100)}..."`);
    
    // Si el file_type es genérico ("image", "audio"), derivar el correcto
    if (fileType === 'image' || fileType === 'audio' || fileType === 'video') {
        const derived = deriveMimeTypeFromUrl(attachment.data_url);
        console.log(`🔧 Derivando MIME type: "${fileType}" → "${derived || 'NO DERIVADO'}"`);
        if (derived) {
            fileType = derived;
        }
    }
    
    // Crear objeto temporal con fileType actualizado para clasificación
    const attachmentWithDerivedType = {
        ...attachment,
        file_type: fileType
    };
    
    const metadata = {
        id: attachment.id,
        fileType: fileType,
        dataUrl: attachment.data_url,
        thumbUrl: attachment.thumb_url,
        type: classifyAttachment(attachmentWithDerivedType),
        processable: isProcessable(attachmentWithDerivedType)
    };
    
    console.log(`✅ Metadata generada:`, {
        id: metadata.id,
        fileType: metadata.fileType,
        type: metadata.type,
        processable: metadata.processable
    });
    
    return metadata;
}

/**
 * Filtra solo attachments procesables de un mensaje
 * 
 * @param {Object} message - Mensaje de Chatwoot
 * @returns {Array} - Array de attachments procesables
 */
export function getProcessableAttachments(message) {
    if (!message.attachments || message.attachments.length === 0) {
        return [];
    }

    return message.attachments
        .filter(att => isProcessable(att))
        .map(att => extractMetadata(att));
}

/**
 * Separa attachments por tipo
 * 
 * @param {Array} attachments - Array de attachments
 * @returns {Object} - { audio: [], images: [], documents: [] }
 */
export function groupAttachmentsByType(attachments) {
    const grouped = {
        audio: [],
        images: [],
        documents: []
    };

    attachments.forEach(att => {
        const metadata = extractMetadata(att);
        
        switch (metadata.type) {
            case ATTACHMENT_TYPES.AUDIO:
                grouped.audio.push(metadata);
                break;
            case ATTACHMENT_TYPES.IMAGE:
                grouped.images.push(metadata);
                break;
            case ATTACHMENT_TYPES.DOCUMENT:
                grouped.documents.push(metadata);
                break;
        }
    });

    return grouped;
}

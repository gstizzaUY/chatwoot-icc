/**
 * Constantes para procesamiento multimedia
 */

// Tipos de attachments procesables
export const ATTACHMENT_TYPES = {
    AUDIO: 'audio',
    IMAGE: 'image',
    DOCUMENT: 'document',
    VIDEO: 'video',
    OTHER: 'other'
};

// Formatos de audio soportados por Whisper
export const AUDIO_FORMATS = [
    'audio/mpeg', // mp3
    'audio/mp4',  // m4a
    'audio/wav',
    'audio/webm',
    'audio/ogg',
    'audio/x-m4a'
];

// Formatos de imagen soportados por GPT-4 Vision
export const IMAGE_FORMATS = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp'
];

// Formatos de documento que pueden tener texto
export const DOCUMENT_FORMATS = [
    'application/pdf',
    'image/jpeg', // Puede ser documento escaneado
    'image/jpg',
    'image/png'
];

// Límites de procesamiento
export const MULTIMEDIA_LIMITS = {
    MAX_AUDIO_SIZE_MB: 25,      // Límite de Whisper
    MAX_IMAGE_SIZE_MB: 20,      // Límite razonable para GPT-4V
    MAX_AUDIO_PER_CONVERSATION: 10,
    MAX_IMAGES_PER_CONVERSATION: 15,
    DOWNLOAD_TIMEOUT_MS: 30000,  // 30 segundos
    TRANSCRIPTION_TIMEOUT_MS: 60000, // 60 segundos
    VISION_TIMEOUT_MS: 30000     // 30 segundos
};

// Configuración de caché
export const CACHE_CONFIG = {
    ENABLED: true,
    TTL_DAYS: 7,
    MAX_ENTRIES: 1000
};

// Configuración de OpenAI
export const OPENAI_CONFIG = {
    WHISPER_MODEL: 'whisper-1',        // Único modelo, más económico
    VISION_MODEL: 'gpt-4o',            // GPT-4o con visión nativa
    VISION_DETAIL: 'auto',             // auto, low, high
    WHISPER_LANGUAGE: 'es',            // Español para mejor precisión
    VISION_MAX_TOKENS: 500             // Límite para análisis de imagen
};

// Prompts para análisis de imágenes/documentos
export const VISION_PROMPTS = {
    EXTRACT_INFO: `Analiza esta imagen/documento y extrae TODA la información del contacto que puedas identificar.

Busca específicamente:
- Nombre y apellido
- Email
- Teléfono/celular
- Dirección (ciudad, departamento, país)
- Cualquier dato adicional del contacto

Si es un documento (factura, formulario, captura de pantalla):
- Busca campos de texto, formularios rellenados, datos de contacto
- ID de equipo, número de serie
- Fechas relevantes

Si es una foto de un producto o problema técnico:
- Describe brevemente lo que se ve
- Identifica marcas, modelos, códigos de error si aparecen

Devuelve SOLO un JSON con la información extraída:
{
  "contact_info_found": true/false,
  "firstname": "string o null",
  "lastname": "string o null",
  "email": "string o null",
  "mobile_phone": "string o null",
  "city": "string o null",
  "state": "string o null",
  "country": "string o null",
  "equipment_serial": "string o null",
  "description": "breve descripción de lo que se ve en la imagen (máx 100 chars)",
  "additional_notes": "cualquier otro dato relevante"
}

NO incluyas datos que no estén claramente visibles. Si no hay información de contacto, devuelve contact_info_found: false.`,

    TECHNICAL_ANALYSIS: `Analiza esta imagen de un problema técnico o producto.

Identifica:
- ¿Qué se ve en la imagen?
- ¿Hay códigos de error visibles?
- ¿Hay números de serie o modelos?
- ¿Es un producto iChef o de la competencia?

Devuelve JSON:
{
  "type": "technical_issue|product|document|other",
  "description": "descripción clara y concisa",
  "error_code": "string o null",
  "serial_number": "string o null",
  "brand": "string o null",
  "notes": "observaciones adicionales"
}`
};

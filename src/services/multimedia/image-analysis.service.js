import OpenAI from 'openai';
import dotenv from 'dotenv';
import crypto from 'crypto';
import attachmentDownloader from '../../utils/attachment-downloader.utils.js';
import {
    IMAGE_FORMATS,
    DOCUMENT_FORMATS,
    MULTIMEDIA_LIMITS,
    OPENAI_CONFIG,
    VISION_PROMPTS,
    CACHE_CONFIG
} from '../../constants/multimedia.constants.js';

dotenv.config();

/**
 * Servicio de análisis de imágenes y documentos usando GPT-4o Vision
 */
class ImageAnalysisService {
    constructor() {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            console.warn('⚠️  OPENAI_API_KEY no configurada - análisis de imágenes deshabilitado');
            this.enabled = false;
            return;
        }

        this.openai = new OpenAI({ apiKey });
        this.enabled = true;
        this.analysisCache = new Map();
        
        console.log('✅ Servicio de análisis de imágenes inicializado');
    }

    /**
     * Analiza una imagen o documento para extraer información
     * 
     * @param {string} imageUrl - URL de la imagen
     * @param {string} mimeType - Tipo MIME
     * @param {string} analysisType - Tipo de análisis: 'extract_info' o 'technical'
     * @returns {Promise<Object>} - Información extraída
     */
    async analyze(imageUrl, mimeType, analysisType = 'extract_info') {
        if (!this.enabled) {
            console.warn('⚠️  Análisis de imágenes deshabilitado (falta API key)');
            return {
                error: true,
                description: '[Análisis no disponible - API key faltante]'
            };
        }

        // Verificar formato soportado (flexible)
        const supportedFormats = [...IMAGE_FORMATS, ...DOCUMENT_FORMATS];
        const isExactMatch = supportedFormats.includes(mimeType);
        const isImagePrefix = mimeType.startsWith('image/');
        const isPdfPrefix = mimeType.startsWith('application/pdf');
        const isGenericImage = mimeType === 'image'; // Tipo genérico de Chatwoot
        
        if (!isExactMatch && !isImagePrefix && !isPdfPrefix && !isGenericImage) {
            console.warn(`⚠️  Formato no soportado: ${mimeType}`);
            return {
                error: true,
                description: `[Formato no soportado: ${mimeType}]`
            };
        }

        console.log(`🖼️  Analizando imagen con MIME type: ${mimeType}`);

        // Generar hash para caché
        const cacheKey = crypto.createHash('md5').update(imageUrl + analysisType).digest('hex');

        // Verificar caché
        if (CACHE_CONFIG.ENABLED && this.analysisCache.has(cacheKey)) {
            console.log(`📦 Usando análisis cacheado: ${cacheKey.substring(0, 8)}`);
            return {
                ...this.analysisCache.get(cacheKey),
                cached: true
            };
        }

        console.log('🖼️  Iniciando análisis de imagen/documento...');

        try {
            // Usar URL directamente (GPT-4 Vision puede acceder a URLs públicas)
            // Esto es más eficiente que base64 y reduce tokens
            const useDirectUrl = true;

            let imageContent;

            if (useDirectUrl) {
                imageContent = {
                    type: 'image_url',
                    image_url: {
                        url: imageUrl,
                        detail: OPENAI_CONFIG.VISION_DETAIL
                    }
                };
            } else {
                // Alternativa: descargar y convertir a base64
                const imageBuffer = await attachmentDownloader.download(
                    imageUrl,
                    MULTIMEDIA_LIMITS.MAX_IMAGE_SIZE_MB
                );
                const base64Image = attachmentDownloader.toBase64(imageBuffer);
                
                imageContent = {
                    type: 'image_url',
                    image_url: {
                        url: `data:${mimeType};base64,${base64Image}`,
                        detail: OPENAI_CONFIG.VISION_DETAIL
                    }
                };
            }

            // Seleccionar prompt según tipo de análisis
            const prompt = analysisType === 'technical' 
                ? VISION_PROMPTS.TECHNICAL_ANALYSIS 
                : VISION_PROMPTS.EXTRACT_INFO;

            // Llamar a GPT-4o Vision
            const startTime = Date.now();

            const completion = await this.openai.chat.completions.create({
                model: OPENAI_CONFIG.VISION_MODEL,
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: prompt
                            },
                            imageContent
                        ]
                    }
                ],
                max_tokens: OPENAI_CONFIG.VISION_MAX_TOKENS,
                temperature: 0.2
            });

            const duration = Date.now() - startTime;

            // Parsear respuesta JSON
            const responseText = completion.choices[0].message.content;
            let extractedData;

            try {
                // Intentar parsear como JSON
                extractedData = JSON.parse(responseText);
            } catch (parseError) {
                // Si falla, buscar JSON en el texto
                const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    extractedData = JSON.parse(jsonMatch[0]);
                } else {
                    console.warn('⚠️  No se pudo parsear respuesta como JSON');
                    extractedData = {
                        description: responseText,
                        raw_response: true
                    };
                }
            }

            const result = {
                ...extractedData,
                analysisType,
                processingTime: duration,
                cached: false,
                timestamp: new Date().toISOString()
            };

            console.log(`✅ Imagen analizada exitosamente (${duration}ms)`);
            console.log('📊 Datos extraídos:', JSON.stringify(extractedData, null, 2));

            // Guardar en caché
            if (CACHE_CONFIG.ENABLED) {
                this.analysisCache.set(cacheKey, result);
                
                // Limpiar caché después del TTL
                setTimeout(() => {
                    this.analysisCache.delete(cacheKey);
                }, CACHE_CONFIG.TTL_DAYS * 24 * 60 * 60 * 1000);
            }

            return result;

        } catch (error) {
            console.error('❌ Error analizando imagen:', error.message);
            
            if (error.code === 'insufficient_quota') {
                return {
                    error: true,
                    description: '[Error: Cuota de OpenAI excedida]'
                };
            }

            return {
                error: true,
                description: `[Error analizando imagen: ${error.message}]`
            };
        }
    }

    /**
     * Analiza imagen para extraer información de contacto
     * 
     * @param {string} imageUrl - URL de la imagen
     * @param {string} mimeType - Tipo MIME
     * @returns {Promise<Object>}
     */
    async extractContactInfo(imageUrl, mimeType) {
        return await this.analyze(imageUrl, mimeType, 'extract_info');
    }

    /**
     * Analiza imagen de problema técnico
     * 
     * @param {string} imageUrl - URL de la imagen
     * @param {string} mimeType - Tipo MIME
     * @returns {Promise<Object>}
     */
    async analyzeTechnical(imageUrl, mimeType) {
        return await this.analyze(imageUrl, mimeType, 'technical');
    }

    /**
     * Limpia la caché de análisis
     */
    clearCache() {
        this.analysisCache.clear();
        console.log('🗑️  Caché de análisis de imágenes limpiada');
    }

    /**
     * Obtiene estadísticas de la caché
     * 
     * @returns {Object}
     */
    getCacheStats() {
        return {
            entries: this.analysisCache.size,
            maxEntries: CACHE_CONFIG.MAX_ENTRIES,
            ttlDays: CACHE_CONFIG.TTL_DAYS
        };
    }
}

export default new ImageAnalysisService();

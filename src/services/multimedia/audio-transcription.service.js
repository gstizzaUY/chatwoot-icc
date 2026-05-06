import OpenAI, { toFile } from 'openai';
import dotenv from 'dotenv';
import crypto from 'crypto';
import attachmentDownloader from '../../utils/attachment-downloader.utils.js';
import {
    AUDIO_FORMATS,
    MULTIMEDIA_LIMITS,
    OPENAI_CONFIG,
    CACHE_CONFIG
} from '../../constants/multimedia.constants.js';

dotenv.config();

/**
 * Servicio de transcripción de audio usando OpenAI Whisper
 * Whisper-1 es la opción más económica: ~$0.006 por minuto
 */
class AudioTranscriptionService {
    constructor() {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            console.warn('⚠️  OPENAI_API_KEY no configurada - transcripción de audio deshabilitada');
            this.enabled = false;
            return;
        }

        this.openai = new OpenAI({ apiKey });
        this.enabled = true;
        this.transcriptionCache = new Map();
        
        console.log('✅ Servicio de transcripción de audio inicializado');
    }

    /**
     * Transcribe un archivo de audio a texto
     * 
     * @param {string} audioUrl - URL del archivo de audio
     * @param {string} mimeType - Tipo MIME del audio
     * @returns {Promise<Object>} - { text, duration, cached }
     */
    async transcribe(audioUrl, mimeType = 'audio/mpeg') {
        if (!this.enabled) {
            console.warn('⚠️  Transcripción deshabilitada (falta API key)');
            return {
                text: '[Transcripción no disponible - API key faltante]',
                error: true
            };
        }

        // Verificar formato soportado (flexible)
        const isExactMatch = AUDIO_FORMATS.includes(mimeType);
        const isAudioPrefix = mimeType && mimeType.startsWith('audio/');
        const isGenericAudio = mimeType === 'audio'; // Tipo genérico de Chatwoot
        
        if (!isExactMatch && !isAudioPrefix && !isGenericAudio) {
            console.warn(`⚠️  Formato de audio no soportado: ${mimeType}`);
            return {
                text: `[Audio en formato no soportado: ${mimeType}]`,
                error: true
            };
        }

        console.log(`🎤 Transcribiendo audio con MIME type: ${mimeType}`);

        // Generar hash para caché
        const cacheKey = crypto.createHash('md5').update(audioUrl).digest('hex');

        // Verificar caché
        if (CACHE_CONFIG.ENABLED && this.transcriptionCache.has(cacheKey)) {
            console.log(`📦 Usando transcripción cacheada: ${cacheKey.substring(0, 8)}`);
            return {
                ...this.transcriptionCache.get(cacheKey),
                cached: true
            };
        }

        console.log('🎤 Iniciando transcripción de audio...');

        try {
            // 1. Descargar archivo de audio
            const audioBuffer = await attachmentDownloader.download(
                audioUrl,
                MULTIMEDIA_LIMITS.MAX_AUDIO_SIZE_MB
            );

            // 2. Determinar extensión del archivo
            const extension = this._getExtensionFromMime(mimeType);
            
            // 3. Crear File object para Whisper API (Node.js compatible)
            // toFile() convierte el Buffer en un objeto File-like que funciona en Node.js
            const audioFile = await toFile(
                audioBuffer,
                `audio.${extension}`,
                { type: mimeType }
            );

            // 4. Llamar a Whisper API
            const startTime = Date.now();
            
            const transcription = await this.openai.audio.transcriptions.create({
                file: audioFile,
                model: OPENAI_CONFIG.WHISPER_MODEL,
                language: OPENAI_CONFIG.WHISPER_LANGUAGE,
                response_format: 'verbose_json' // Incluye duration y otros metadatos
            });

            const duration = Date.now() - startTime;

            const result = {
                text: transcription.text.trim(),
                duration: transcription.duration || 0, // Duración del audio en segundos
                transcriptionTime: duration,           // Tiempo de procesamiento
                language: transcription.language || 'es',
                cached: false,
                timestamp: new Date().toISOString()
            };

            console.log(`✅ Audio transcrito exitosamente (${result.duration}s de audio, ${duration}ms de procesamiento)`);

            // Guardar en caché
            if (CACHE_CONFIG.ENABLED) {
                this.transcriptionCache.set(cacheKey, result);
                
                // Limpiar caché después del TTL
                setTimeout(() => {
                    this.transcriptionCache.delete(cacheKey);
                }, CACHE_CONFIG.TTL_DAYS * 24 * 60 * 60 * 1000);
            }

            return result;

        } catch (error) {
            console.error('❌ Error transcribiendo audio:', error.message);
            
            // Errores específicos de Whisper
            if (error.code === 'insufficient_quota') {
                return {
                    text: '[Error: Cuota de OpenAI excedida]',
                    error: true
                };
            }
            
            if (error.status === 413) {
                return {
                    text: '[Error: Audio muy grande (máximo 25MB)]',
                    error: true
                };
            }

            return {
                text: `[Error transcribiendo audio: ${error.message}]`,
                error: true
            };
        }
    }

    /**
     * Obtiene la extensión de archivo desde el MIME type
     * 
     * @param {string} mimeType - Tipo MIME
     * @returns {string} - Extensión del archivo
     */
    _getExtensionFromMime(mimeType) {
        const mimeMap = {
            'audio/mpeg': 'mp3',
            'audio/mp4': 'm4a',
            'audio/wav': 'wav',
            'audio/webm': 'webm',
            'audio/ogg': 'ogg',
            'audio/x-m4a': 'm4a'
        };
        return mimeMap[mimeType] || 'mp3';
    }

    /**
     * Limpia la caché de transcripciones
     */
    clearCache() {
        this.transcriptionCache.clear();
        console.log('🗑️  Caché de transcripciones limpiada');
    }

    /**
     * Obtiene estadísticas de la caché
     * 
     * @returns {Object}
     */
    getCacheStats() {
        return {
            entries: this.transcriptionCache.size,
            maxEntries: CACHE_CONFIG.MAX_ENTRIES,
            ttlDays: CACHE_CONFIG.TTL_DAYS
        };
    }
}

export default new AudioTranscriptionService();

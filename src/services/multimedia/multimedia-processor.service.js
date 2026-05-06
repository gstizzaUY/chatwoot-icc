import audioTranscriptionService from './audio-transcription.service.js';
import imageAnalysisService from './image-analysis.service.js';
import { groupAttachmentsByType } from '../../mappers/attachment.mapper.js';
import { MULTIMEDIA_LIMITS } from '../../constants/multimedia.constants.js';

/**
 * Servicio coordinador para procesar multimedia
 * Orquesta transcripciones de audio y análisis de imágenes/documentos
 */
class MultimediaProcessorService {
    /**
     * Procesa todos los attachments de un mensaje
     * 
     * @param {Object} message - Mensaje de Chatwoot con attachments
     * @returns {Promise<Object>} - { transcriptions: [], imageAnalysis: [], extractedInfo: {} }
     */
    async processMessageAttachments(message) {
        if (!message.attachments || message.attachments.length === 0) {
            return {
                transcriptions: [],
                imageAnalysis: [],
                extractedInfo: {},
                hasMultimedia: false
            };
        }

        console.log(`📎 Procesando ${message.attachments.length} attachment(s) del mensaje ${message.id}...`);

        // Agrupar attachments por tipo
        const grouped = groupAttachmentsByType(message.attachments);

        const results = {
            transcriptions: [],
            imageAnalysis: [],
            extractedInfo: {},
            hasMultimedia: false,
            summary: ''
        };

        // 1. Procesar audios (transcripción)
        if (grouped.audio.length > 0) {
            console.log(`🎤 Procesando ${grouped.audio.length} audio(s)...`);
            
            // Limitar cantidad de audios
            const audiosToProcess = grouped.audio.slice(0, MULTIMEDIA_LIMITS.MAX_AUDIO_PER_CONVERSATION);

            for (const audioMetadata of audiosToProcess) {
                try {
                    const transcription = await audioTranscriptionService.transcribe(
                        audioMetadata.dataUrl,
                        audioMetadata.fileType
                    );

                    results.transcriptions.push({
                        ...audioMetadata,
                        ...transcription
                    });

                    results.hasMultimedia = true;

                } catch (error) {
                    console.error(`❌ Error transcribiendo audio ${audioMetadata.id}:`, error.message);
                    results.transcriptions.push({
                        ...audioMetadata,
                        text: '[Error transcribiendo audio]',
                        error: true
                    });
                }
            }

            if (grouped.audio.length > MULTIMEDIA_LIMITS.MAX_AUDIO_PER_CONVERSATION) {
                console.warn(`⚠️  Solo se procesaron ${MULTIMEDIA_LIMITS.MAX_AUDIO_PER_CONVERSATION} de ${grouped.audio.length} audios (límite alcanzado)`);
            }
        }

        // 2. Procesar imágenes y documentos (análisis con Vision)
        const visualMedia = [...grouped.images, ...grouped.documents];
        
        if (visualMedia.length > 0) {
            console.log(`🖼️  Procesando ${visualMedia.length} imagen(es)/documento(s)...`);
            
            // Limitar cantidad de imágenes
            const imagesToProcess = visualMedia.slice(0, MULTIMEDIA_LIMITS.MAX_IMAGES_PER_CONVERSATION);

            for (const imageMetadata of imagesToProcess) {
                try {
                    const analysis = await imageAnalysisService.extractContactInfo(
                        imageMetadata.dataUrl,
                        imageMetadata.fileType
                    );

                    results.imageAnalysis.push({
                        ...imageMetadata,
                        ...analysis
                    });

                    results.hasMultimedia = true;

                    // Consolidar información extraída
                    if (analysis.contact_info_found && !analysis.error) {
                        this._mergeExtractedInfo(results.extractedInfo, analysis);
                    }

                } catch (error) {
                    console.error(`❌ Error analizando imagen ${imageMetadata.id}:`, error.message);
                    results.imageAnalysis.push({
                        ...imageMetadata,
                        description: '[Error analizando imagen]',
                        error: true
                    });
                }
            }

            if (visualMedia.length > MULTIMEDIA_LIMITS.MAX_IMAGES_PER_CONVERSATION) {
                console.warn(`⚠️  Solo se procesaron ${MULTIMEDIA_LIMITS.MAX_IMAGES_PER_CONVERSATION} de ${visualMedia.length} imágenes (límite alcanzado)`);
            }
        }

        // 3. Generar resumen de multimedia procesada
        results.summary = this._generateSummary(results);

        console.log(`✅ Multimedia procesada: ${results.transcriptions.length} audios, ${results.imageAnalysis.length} imágenes`);

        return results;
    }

    /**
     * Consolida información extraída de múltiples imágenes/documentos
     * 
     * @param {Object} target - Objeto donde consolidar
     * @param {Object} source - Información extraída
     */
    _mergeExtractedInfo(target, source) {
        // Solo agregar campos que tengan valor
        const fields = [
            'firstname', 'lastname', 'email', 'mobile_phone',
            'city', 'state', 'country', 'equipment_serial'
        ];

        fields.forEach(field => {
            if (source[field] && source[field] !== null && source[field] !== '') {
                // Si ya existe, mantener el primero encontrado
                if (!target[field]) {
                    target[field] = source[field];
                }
            }
        });

        // Consolidar notas adicionales
        if (source.additional_notes) {
            if (!target.additional_notes) {
                target.additional_notes = [];
            }
            target.additional_notes.push(source.additional_notes);
        }

        // Consolidar descripciones
        if (source.description) {
            if (!target.descriptions) {
                target.descriptions = [];
            }
            target.descriptions.push(source.description);
        }
    }

    /**
     * Genera resumen legible del multimedia procesado
     * 
     * @param {Object} results - Resultados del procesamiento
     * @returns {string}
     */
    _generateSummary(results) {
        const parts = [];

        if (results.transcriptions.length > 0) {
            const successfulTranscriptions = results.transcriptions.filter(t => !t.error);
            parts.push(`${successfulTranscriptions.length} audio(s) transcrito(s)`);
        }

        if (results.imageAnalysis.length > 0) {
            const successfulAnalysis = results.imageAnalysis.filter(a => !a.error);
            const withContactInfo = successfulAnalysis.filter(a => a.contact_info_found);
            
            parts.push(`${successfulAnalysis.length} imagen(es) analizada(s)`);
            
            if (withContactInfo.length > 0) {
                parts.push(`${withContactInfo.length} con información de contacto`);
            }
        }

        return parts.length > 0 ? parts.join(', ') : 'Sin multimedia procesada';
    }

    /**
     * Formatea transcripciones para incluir en contexto de IA
     * 
     * @param {Array} transcriptions - Transcripciones procesadas
     * @returns {string}
     */
    formatTranscriptionsForAI(transcriptions) {
        if (!transcriptions || transcriptions.length === 0) {
            return '';
        }

        return transcriptions
            .map((t, index) => {
                const duration = t.duration ? ` (${Math.round(t.duration)}s)` : '';
                return `[🎤 AUDIO ${index + 1}${duration}]: ${t.text}`;
            })
            .join('\n');
    }

    /**
     * Formatea análisis de imágenes para incluir en contexto de IA
     * 
     * @param {Array} imageAnalysis - Análisis procesados
     * @returns {string}
     */
    formatImageAnalysisForAI(imageAnalysis) {
        if (!imageAnalysis || imageAnalysis.length === 0) {
            return '';
        }

        return imageAnalysis
            .map((img, index) => {
                let text = `[🖼️  IMAGEN ${index + 1}]`;
                
                if (img.description) {
                    text += `: ${img.description}`;
                }

                if (img.contact_info_found && !img.error) {
                    text += ' [Contiene información de contacto]';
                }

                return text;
            })
            .join('\n');
    }
}

export default new MultimediaProcessorService();

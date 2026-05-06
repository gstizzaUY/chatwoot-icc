import chatwootClient from '../../clients/chatwoot.client.js';
import multimediaProcessorService from '../multimedia/multimedia-processor.service.js';
import { getProcessableAttachments } from '../../mappers/attachment.mapper.js';

/**
 * Servicio constructor de contexto para agentes IA
 * Prepara y formatea información para análisis
 */
class ContextBuilderService {
    /**
     * Construye contexto completo para análisis de conversación
     * 
     * @param {number} conversationId - ID de la conversación
     * @param {Object} options - Opciones de construcción
     * @returns {Promise<Object>} - Contexto completo
     */
    async buildContext(conversationId, options = {}) {
        const {
            includeHistory = false,
            includeContact = true,
            maxMessages = null,
            processMultimedia = false  // Nueva opción para procesar attachments
        } = options;

        console.log(`📦 Construyendo contexto para conversación ${conversationId}...`);

        try {
            // 1. Obtener conversación
            const conversation = await chatwootClient.getConversation(conversationId);

            if (!conversation) {
                throw new Error(`Conversación ${conversationId} no encontrada`);
            }

            // 2. Obtener mensajes
            let messages = await chatwootClient.getConversationMessages(conversationId);

            if (maxMessages && messages.length > maxMessages) {
                messages = messages.slice(-maxMessages); // Últimos N mensajes
            }

            // 3. Procesar multimedia si se solicita
            let multimediaResult = null;
            if (processMultimedia) {
                console.log('🖼️  Procesando multimedia en mensajes...');
                multimediaResult = await this.processMultimediaMessages(messages);
                messages = multimediaResult.processedMessages; // Usar mensajes enriquecidos
            }

            // 4. Obtener contacto
            let contact = null;
            const contactId = conversation.meta?.sender?.id || conversation.contact_id;

            if (includeContact && contactId) {
                contact = await chatwootClient.getContactById(contactId);
            }

            // 5. Obtener conversaciones previas (si se solicita)
            let previousConversations = [];
            if (includeHistory && contactId) {
                try {
                    const allConversations = await chatwootClient.getConversationsByContact(contactId);
                    previousConversations = allConversations
                        .filter(conv => conv.id !== conversationId)
                        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

                    console.log(`📚 Encontradas ${previousConversations.length} conversaciones previas`);
                } catch (error) {
                    console.warn('⚠️  No se pudieron obtener conversaciones previas:', error.message);
                }
            }

            const context = {
                conversation,
                messages,
                contact,
                previousConversations,
                metadata: {
                    conversationId,
                    contactId,
                    inboxId: conversation.inbox_id,
                    status: conversation.status,
                    messageCount: messages.length,
                    hasHistory: previousConversations.length > 0
                }
            };

            // Agregar información de multimedia si se procesó
            if (multimediaResult) {
                context.multimediaInfo = {
                    extractedInfo: multimediaResult.allExtractedInfo,
                    summary: multimediaResult.multimediaSummary,
                    hasMultimedia: Object.keys(multimediaResult.allExtractedInfo).length > 0
                };
                context.metadata.hasMultimedia = context.multimediaInfo.hasMultimedia;
            }

            return context;
        } catch (error) {
            console.error(`❌ Error construyendo contexto: ${error.message}`);
            throw error;
        }
    }

    /**
     * Cuenta mensajes del cliente en una conversación
     * 
     * @param {Array} messages - Mensajes de la conversación
     * @returns {number} - Cantidad de mensajes del cliente
     */
    countIncomingMessages(messages) {
        return messages.filter(msg => {
            // message_type === 0 es mensaje del cliente
            // o incoming === true
            return msg.message_type === 0 || msg.message_type === '0' || msg.incoming === true;
        }).length;
    }

    /**
     * Obtiene el último mensaje de una conversación
     * 
     * @param {Array} messages - Mensajes de la conversación
     * @returns {Object|null} - Último mensaje o null
     */
    getLastMessage(messages) {
        if (!messages || messages.length === 0) return null;
        return messages[messages.length - 1];
    }

    /**
     * Filtra mensajes para análisis (excluye notas automáticas)
     * NOTA: Ya NO filtra attachments - se procesan por separado
     * 
     * @param {Array} messages - Mensajes originales
     * @returns {Array} - Mensajes filtrados
     */
    filterMessagesForAnalysis(messages) {
        return messages.filter(msg => {
            // Ignorar sin contenido Y sin attachments
            if ((!msg.content || msg.content.trim().length === 0) && 
                (!msg.attachments || msg.attachments.length === 0)) {
                return false;
            }

            // Ignorar notas automáticas del sistema
            if (msg.private && msg.content_type === 'text') {
                const isAutoSummary =
                    msg.content.includes('📋 RESUMEN DE LA CONVERSACIÓN') ||
                    msg.content.includes('Análisis generado automáticamente') ||
                    msg.content.includes('😊 SENTIMIENTO:') ||
                    msg.content.includes('🔍 INFORMACIÓN DETECTADA') ||
                    msg.content.includes('🤖 SUGERENCIA DEL ASISTENTE') ||
                    msg.content.includes('💡 ASISTENTE DE');

                if (isAutoSummary) {
                    return false;
                }
            }

            return true;
        });
    }

    /**
     * Formatea mensajes para enviar a IA
     * 
     * @param {Array} messages - Mensajes a formatear
     * @returns {string} - Texto formateado
     */
    formatMessagesForAI(messages) {
        return messages
            .map((msg, index) => {
                const sender = msg.message_type === 0 ? 'Cliente' : 'Agente';
                const content = msg.content.trim();
                const isNote = msg.private ? ' [NOTA PRIVADA AGENTE]' : '';
                return `[${index + 1}] ${sender}${isNote}: ${content}`;
            })
            .join('\n');
    }

    /**     * Procesa attachments multimedia de mensajes del cliente
     * SOLO procesa mensajes incoming (del cliente), NO mensajes del agente
     * 
     * @param {Array} messages - Mensajes de la conversación
     * @returns {Promise<Object>} - { processedMessages: [], allExtractedInfo: {}, multimediaSummary: '' }
     */
    async processMultimediaMessages(messages) {
        const processedMessages = [];
        const allExtractedInfo = {};
        const multimediaSummaries = [];

        for (const msg of messages) {
            // SOLO procesar attachments de mensajes incoming (del cliente)
            const isIncoming = 
                msg.message_type === 0 || 
                msg.message_type === '0' || 
                msg.message_type === 'incoming' || 
                msg.incoming === true;

            if (isIncoming && msg.attachments && msg.attachments.length > 0) {
                const processableAttachments = getProcessableAttachments(msg);

                if (processableAttachments.length > 0) {
                    console.log(`📎 Procesando ${processableAttachments.length} attachment(s) del mensaje ${msg.id} (cliente)...`);

                    try {
                        const multimediaResult = await multimediaProcessorService.processMessageAttachments(msg);

                        // Enriquecer mensaje con multimedia procesada
                        const enrichedMessage = {
                            ...msg,
                            multimediaProcessed: multimediaResult,
                            hasMultimedia: multimediaResult.hasMultimedia
                        };

                        processedMessages.push(enrichedMessage);

                        // Consolidar información extraída
                        if (Object.keys(multimediaResult.extractedInfo).length > 0) {
                            Object.assign(allExtractedInfo, multimediaResult.extractedInfo);
                        }

                        // Agregar resumen
                        if (multimediaResult.summary) {
                            multimediaSummaries.push(`Mensaje ${msg.id}: ${multimediaResult.summary}`);
                        }

                    } catch (error) {
                        console.error(`❌ Error procesando multimedia del mensaje ${msg.id}:`, error.message);
                        processedMessages.push(msg); // Incluir sin multimedia
                    }
                } else {
                    processedMessages.push(msg);
                }
            } else {
                // Mensaje sin attachments o mensaje del agente
                processedMessages.push(msg);
            }
        }

        return {
            processedMessages,
            allExtractedInfo,
            multimediaSummary: multimediaSummaries.join('; ')
        };
    }

    /**
     * Formatea mensajes con multimedia para contexto de IA
     * Incluye transcripciones y análisis de imágenes
     * 
     * @param {Array} processedMessages - Mensajes ya procesados con multimedia
     * @returns {string}
     */
    formatMessagesWithMultimediaForAI(processedMessages) {
        return processedMessages
            .map((msg, index) => {
                const sender = msg.message_type === 0 ? 'Cliente' : 'Agente';
                const isNote = msg.private ? ' [NOTA PRIVADA AGENTE]' : '';
                
                let parts = [];

                // Contenido de texto
                if (msg.content && msg.content.trim().length > 0) {
                    parts.push(msg.content.trim());
                }

                // Transcripciones de audio
                if (msg.multimediaProcessed?.transcriptions?.length > 0) {
                    const transcriptionsText = multimediaProcessorService.formatTranscriptionsForAI(
                        msg.multimediaProcessed.transcriptions
                    );
                    parts.push(transcriptionsText);
                }

                // Análisis de imágenes
                if (msg.multimediaProcessed?.imageAnalysis?.length > 0) {
                    const imageAnalysisText = multimediaProcessorService.formatImageAnalysisForAI(
                        msg.multimediaProcessed.imageAnalysis
                    );
                    parts.push(imageAnalysisText);
                }

                const content = parts.join('\n');
                return `[${index + 1}] ${sender}${isNote}: ${content}`;
            })
            .join('\n');
    }

    /**     * Construye contexto de conversaciones previas
     * 
     * @param {Array} conversations - Conversaciones previas
     * @param {number} maxConversations - Máximo de conversaciones a incluir
     * @returns {string|null} - Contexto formateado o null
     */
    buildPreviousConversationsContext(conversations, maxConversations = 5) {
        if (!conversations || conversations.length === 0) {
            return null;
        }

        const summaries = conversations
            .filter(conv => conv.status === 'resolved' && conv.custom_attributes?.last_conversation_summary)
            .slice(0, maxConversations)
            .map((conv, index) => {
                const date = new Date(conv.created_at).toLocaleDateString('es-UY');
                const channel = conv.inbox?.name || 'Canal desconocido';
                const summary = conv.custom_attributes.last_conversation_summary;

                return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 Conversación anterior #${index + 1}
   📆 Fecha: ${date}
   📱 Canal: ${channel}
   📝 Resumen:
${summary}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
            })
            .join('\n\n');

        return summaries || null;
    }
}

export default new ContextBuilderService();

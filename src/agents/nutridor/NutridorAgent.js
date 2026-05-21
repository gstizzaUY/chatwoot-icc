import BaseAgent from '../base/BaseAgent.js';
import { NUTRIDOR_SYSTEM_PROMPT, NUTRIDOR_USER_PROMPT_TEMPLATE } from './nutridor.prompts.js';
import { NUTRIDOR_CHANNELS } from '../../constants/agent.constants.js';
import chatwootClient from '../../clients/chatwoot.client.js';

/**
 * Agente Nutridor
 * Captura información del contacto de manera amable mientras espera al agente humano
 * Se activa cuando el bot detecta derivación a humano
 */
class NutridorAgent extends BaseAgent {
    constructor() {
        super({
            agentType: 'nutridor',
            channels: NUTRIDOR_CHANNELS
        });
        
        // Estado de conversaciones activas (para tracking)
        this.activeConversations = new Map();
    }

    /**
     * Prompt del sistema específico para nutridor
     */
    getSystemPrompt() {
        return NUTRIDOR_SYSTEM_PROMPT;
    }

    /**
     * Construye prompt del usuario con contexto
     */
    buildUserPrompt(context) {
        const { contact, filteredMessages, previousConversations } = context;

        // Información del contacto
        let contactInfo = '';
        if (contact) {
            contactInfo = `CONTACTO ACTUAL:\n`;
            if (contact.name) contactInfo += `- Nombre: ${contact.name}\n`;
            if (contact.email) contactInfo += `- Email: ${contact.email}\n`;
            if (contact.phone_number) contactInfo += `- Teléfono: ${contact.phone_number}\n`;
            if (contact.custom_attributes?.city) contactInfo += `- Ciudad: ${contact.custom_attributes.city}\n`;
            if (contact.custom_attributes?.tiene_ichef) contactInfo += `- Tiene iChef: ${contact.custom_attributes.tiene_ichef}\n`;
        }

        // Historial previo (si existe)
        let conversationHistory = '';
        if (previousConversations && previousConversations.length > 0) {
            const resolved = previousConversations.filter(c => c.status === 'resolved').slice(0, 2);
            if (resolved.length > 0) {
                conversationHistory = `\nHISTORIAL PREVIO (${resolved.length} conversaciones):\n`;
                resolved.forEach((conv, i) => {
                    const summary = conv.custom_attributes?.last_conversation_summary;
                    if (summary) {
                        conversationHistory += `${i + 1}. ${summary.substring(0, 100)}...\n`;
                    }
                });
            }
        }

        // Mensajes actuales
        const messagesText = this.contextBuilder.formatMessagesWithMultimediaForAI(filteredMessages);

        // Agregar información de multimedia si está disponible
        let multimediaInfo = '';
        if (context.multimediaInfo && context.multimediaInfo.hasMultimedia) {
            const extracted = context.multimediaInfo.extractedInfo;
            const fields = Object.entries(extracted).map(([key, value]) => `${key}: ${value}`).join(', ');
            multimediaInfo = `\n\nINFORMACIÓN EXTRAÍDA DE MULTIMEDIA:\n${fields}\n`;
        }

        return NUTRIDOR_USER_PROMPT_TEMPLATE
            .replace('{contact_info}', contactInfo)
            .replace('{conversation_history}', conversationHistory)
            .replace('{messages}', messagesText)
            .replace('{multimedia_info}', multimediaInfo);
    }

    /**
     * Procesa resultado del análisis
     */
    async processResult(aiResult, context) {
        const { conversation, contact } = context;

        console.log('🌱 Nutridor - Resultado:', aiResult);

        // Validar estructura de respuesta
        if (!aiResult.should_respond && !aiResult.bot_message) {
            console.log('⚠️  Respuesta de IA inválida, ignorando');
            return { success: false, reason: 'invalid_response' };
        }

        // Extraer información
        const extractedInfo = aiResult.extracted_info || {};
        const completionStatus = aiResult.completion_status || {};

        console.log('📊 Info extraída:', extractedInfo);
        console.log('📈 Estado:', completionStatus);

        // Actualizar tracking de conversación
        this.updateConversationTracking(conversation.id, completionStatus);

        // Validar y limpiar información extraída
        const validatedInfo = this.applyBusinessRules(extractedInfo, contact);

        // Actualizar CRMs si hay información nueva
        let crmUpdate = null;
        const hasNewInfo = Object.values(validatedInfo).some(v => v !== null && v !== undefined);

        if (hasNewInfo) {
            try {
                crmUpdate = await this.syncBothCRMs(
                    contact.id,
                    contact,
                    validatedInfo,
                    { summary: null }
                );
                console.log('✅ CRMs actualizados con información capturada');
            } catch (error) {
                console.error('⚠️  Error actualizando CRMs:', error.message);
            }
        }

        // Si el bot debe responder, enviar mensaje
        if (aiResult.should_respond && aiResult.bot_message) {
            try {
                await chatwootClient.sendMessage(conversation.id, {
                    content: aiResult.bot_message,
                    message_type: 'outgoing',
                    private: false  // Mensaje público del bot
                });

                console.log('💬 Mensaje del bot enviado');
            } catch (error) {
                console.error('❌ Error enviando mensaje del bot:', error.message);
            }
        }

        // Si debe desconectarse, marcar conversación como completada
        if (completionStatus.should_disconnect || !aiResult.should_respond) {
            console.log('👋 Nutridor se desconecta de la conversación');
            this.activeConversations.delete(conversation.id);

            // Agregar nota interna con resumen de información capturada
            await this.createCompletionNote(conversation.id, {
                extractedInfo: validatedInfo,
                questionsAsked: completionStatus.questions_asked || 0,
                hasCriticalInfo: completionStatus.has_critical_info || false,
                crmUpdate
            });
        }

        return {
            success: true,
            extractedInfo: validatedInfo,
            responded: aiResult.should_respond,
            disconnected: completionStatus.should_disconnect,
            crmUpdate
        };
    }

    /**
     * Actualiza tracking de conversación activa
     */
    updateConversationTracking(conversationId, status) {
        const current = this.activeConversations.get(conversationId) || {
            startedAt: new Date(),
            questionsAsked: 0
        };

        this.activeConversations.set(conversationId, {
            ...current,
            questionsAsked: status.questions_asked || current.questionsAsked,
            hasCriticalInfo: status.has_critical_info || false,
            lastUpdate: new Date()
        });
    }

    /**
     * Verifica si la conversación está activa para este agente
     */
    isConversationActive(conversationId) {
        return this.activeConversations.has(conversationId);
    }

    /**
     * Verifica si debe activarse el agente (detecta mensaje trigger)
     */
    shouldActivate(messages) {
        if (!messages || messages.length === 0) return false;
        
        const triggerPattern = 'como no ingresaste ninguna opción';
        
        console.log('🔍 Nutridor - Verificando activación:', {
            totalMessages: messages.length,
            lastMessageContent: messages[messages.length - 1]?.content?.substring(0, 60)
        });
        
        // Buscar el mensaje trigger en los últimos 5 mensajes
        // El trigger debe activar el Nutridor INMEDIATAMENTE
        for (let i = messages.length - 1; i >= 0 && i >= messages.length - 5; i--) {
            const msg = messages[i];
            if (msg.content && msg.content.toLowerCase().includes(triggerPattern)) {
                console.log('✅ Mensaje trigger encontrado - activando Nutridor:', {
                    content: msg.content.substring(0, 100),
                    posicion: messages.length - i,
                    mensajesAtras: messages.length - i
                });
                console.log('🎯 Resultado shouldActivate: true (trigger detectado)');
                return true;
            }
        }
        
        console.log('❌ No se encontró mensaje trigger en últimos 5 mensajes');
        return false;
    }

    /**
     * Verifica si un humano respondió
     */
    hasHumanResponded(messages) {
        // Buscar mensajes del agente (message_type !== 0) en los últimos mensajes
        const recentAgentMessages = messages
            .slice(-10)  // Últimos 10 mensajes
            .filter(msg => msg.message_type === 1 || msg.message_type === '1');

        console.log('👤 Verificando respuesta humana:', {
            recentAgentCount: recentAgentMessages.length,
            samples: recentAgentMessages.slice(0, 3).map(m => ({
                content: m.content?.substring(0, 60),
                length: m.content?.length
            }))
        });

        // Filtrar mensajes del bot (Marty, PreVenta, notas automáticas)
        const humanMessages = recentAgentMessages.filter(msg => {
            if (!msg.content) return false;
            
            const content = msg.content.toLowerCase();
            const originalContent = msg.content;
            const length = msg.content.length;
            
            // 1. Filtrar por patrones de texto (bot pre-atendedor y PreVenta)
            const hasAutomationPatterns = 
                content.includes('[bot]') ||
                content.includes('asistente virtual') ||
                content.includes('marty') ||
                content.includes('asistente de ventas') ||
                content.includes('sugerencias:') ||
                content.includes('respuesta sugerida:') ||
                content.includes('sugerencia generada automáticamente') ||
                content.includes('opciones:') ||
                content.includes('seleccioná alguna') ||
                content.includes('volver al menú') ||
                content.includes('como no ingresaste ninguna opción') ||  // ✅ MENSAJE TRIGGER
                /^\d+$/m.test(content);  // Solo números
            
            // 2. Filtrar mensajes MUY LARGOS (> 300 caracteres = probablemente bot)
            const isTooLong = length > 300;
            
            // 3. Filtrar emojis específicos del bot Marty (buscar en original, no lowercase)
            const hasBotEmojis = 
                originalContent.includes('👋') ||
                originalContent.includes('🤖') ||
                originalContent.includes('👨‍🍳') ||
                originalContent.includes('👩‍🍳') ||
                originalContent.includes('⭐') ||
                originalContent.includes('😊');
            
            // Es mensaje de bot si cumple alguna condición
            const isBotMessage = hasAutomationPatterns || isTooLong || hasBotEmojis;
            
            if (!isBotMessage) {
                console.log('   ✅ Mensaje humano detectado:', {
                    content: originalContent.substring(0, 60),
                    length
                });
            }
            
            // Retornar true solo si NO es bot y tiene al menos 20 caracteres
            return !isBotMessage && length > 20;
        });
        
        const hasHuman = humanMessages.length > 0;
        console.log(`🎯 Resultado hasHumanResponded: ${hasHuman} (${humanMessages.length} mensajes humanos)`);
        
        return hasHuman;
    }

    /**
     * Crea nota interna cuando el agente completa su trabajo
     */
    async createCompletionNote(conversationId, data) {
        const { extractedInfo, questionsAsked, hasCriticalInfo, crmUpdate } = data;

        let note = `🌱 **AGENTE NUTRIDOR - INFORMACIÓN CAPTURADA**\n\n`;
        
        note += `📊 **Resumen:**\n`;
        note += `- Preguntas realizadas: ${questionsAsked}\n`;
        note += `- Información crítica completa: ${hasCriticalInfo ? '✅ Sí' : '⚠️ Parcial'}\n\n`;

        // Información capturada
        const capturedFields = Object.entries(extractedInfo)
            .filter(([_, value]) => value !== null && value !== undefined)
            .map(([key, value]) => `  • ${this.getFieldDisplayName(key)}: ${value}`)
            .join('\n');

        if (capturedFields) {
            note += `✅ **Información capturada:**\n${capturedFields}\n\n`;
        } else {
            note += `⚠️ No se capturó información nueva\n\n`;
        }

        // Cambios en CRM
        if (crmUpdate?.chatwootUpdate?.changes?.length > 0) {
            note += `📝 **Campos actualizados en Chatwoot:**\n`;
            crmUpdate.chatwootUpdate.changes.forEach(change => {
                note += `  • ${change.field}: ${change.old} → ${change.new}\n`;
            });
            note += `\n`;
        }

        if (crmUpdate?.rdStationUpdate?.success) {
            note += `🔄 **RD Station:** Contacto sincronizado\n\n`;
        }

        note += `💡 El agente humano puede continuar la conversación desde aquí.\n`;
        note += `---\n`;
        note += `_Generado automáticamente por el Agente Nutridor_`;

        await this.createInternalNote(conversationId, note);
    }

    /**
     * Obtiene nombre legible de campo
     */
    getFieldDisplayName(field) {
        const displayNames = {
            firstname: 'Nombre',
            lastname: 'Apellido',
            email: 'Email',
            mobile_phone: 'Celular',
            city: 'Ciudad',
            state: 'Departamento',
            country: 'País',
            tiene_ichef: 'Tiene iChef',
            le_gusta_cocinar: 'Le gusta cocinar',
            cocina_para_cuantos: 'Cocina para',
            como_se_entero: 'Cómo se enteró',
            restricciones: 'Restricciones alimenticias',
            nivel_cocina: 'Nivel de cocina'
        };

        return displayNames[field] || field;
    }
}

console.log('✅ Agente nutridor inicializado');

export default NutridorAgent;

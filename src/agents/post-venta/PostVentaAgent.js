import BaseAgent from '../base/BaseAgent.js';
import { POST_VENTA_SYSTEM_PROMPT, POST_VENTA_USER_PROMPT_TEMPLATE } from './post-venta.prompts.js';
import { POST_VENTA_CHANNELS } from '../../constants/agent.constants.js';

/**
 * Agente de Post-Venta
 * Actúa en canales de soporte y onboarding
 * Ayuda con problemas técnicos y guía a clientes nuevos
 */
class PostVentaAgent extends BaseAgent {
    constructor() {
        super({
            agentType: 'post-venta',
            channels: POST_VENTA_CHANNELS
        });
    }

    getSystemPrompt() {
        return POST_VENTA_SYSTEM_PROMPT;
    }

    buildUserPrompt(context) {
        const { contact, filteredMessages, previousConversations } = context;

        let contactInfo = '';
        if (contact) {
            contactInfo = `CLIENTE:\n`;
            if (contact.name) contactInfo += `- Nombre: ${contact.name}\n`;
            if (contact.email) contactInfo += `- Email: ${contact.email}\n`;
            if (contact.custom_attributes?.id_equipo) contactInfo += `- Serial equipo: ${contact.custom_attributes.id_equipo}\n`;
            if (contact.custom_attributes?.tiene_ichef) contactInfo += `- Tiene iChef: ${contact.custom_attributes.tiene_ichef}\n`;
        }

        let conversationHistory = '';
        if (previousConversations && previousConversations.length > 0) {
            const resolved = previousConversations.filter(c => c.status === 'resolved').slice(0, 3);
            if (resolved.length > 0) {
                conversationHistory = `\nHISTORIAL DE SOPORTE:\n`;
                resolved.forEach((conv, i) => {
                    const summary = conv.custom_attributes?.last_conversation_summary;
                    if (summary) {
                        conversationHistory += `${i + 1}. ${summary.substring(0, 150)}...\n`;
                    }
                });
            }
        }

        const recentMessages = filteredMessages.slice(-10);
        const messagesText = this.contextBuilder.formatMessagesWithMultimediaForAI(recentMessages);

        // Agregar información de multimedia si está disponible
        let multimediaInfo = '';
        if (context.multimediaInfo && context.multimediaInfo.hasMultimedia) {
            const extracted = context.multimediaInfo.extractedInfo;
            const fields = Object.entries(extracted).map(([key, value]) => `${key}: ${value}`).join(', ');
            multimediaInfo = `\n\nINFORMACIÓN EXTRAÍDA DE MULTIMEDIA:\n${fields}\n`;
        }

        return POST_VENTA_USER_PROMPT_TEMPLATE
            .replace('{contact_info}', contactInfo)
            .replace('{conversation_history}', conversationHistory)
            .replace('{messages}', messagesText + multimediaInfo);
    }

    async processResult(aiResult, context) {
        const { conversation, contact } = context;

        const extractedInfo = aiResult.extracted_info || {};
        const analysis = aiResult.analysis || {};
        const suggestions = aiResult.suggestions || {};

        // En post-venta, forzar tiene_ichef y es_cliente a "Sí"
        extractedInfo.tiene_ichef = 'Sí';
        extractedInfo.es_cliente = 'Sí';
        extractedInfo.stage = 'customer';

        console.log('🔍 Post-Venta - Info extraída:', extractedInfo);
        console.log('📊 Análisis:', analysis);

        const validatedInfo = this.applyBusinessRules(extractedInfo, contact);

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
                console.log('✅ CRMs actualizados');
            } catch (error) {
                console.error('⚠️  Error actualizando CRMs:', error.message);
            }
        }

        await this.createSuggestionNote(conversation.id, {
            analysis,
            suggestions,
            extractedInfo: validatedInfo,
            crmUpdate,
            multimediaInfo: context.multimediaInfo  // Agregar info de multimedia
        });

        return {
            extractedInfo: validatedInfo,
            analysis,
            suggestions,
            crmUpdate
        };
    }

    async createSuggestionNote(conversationId, data) {
        const { analysis, suggestions, extractedInfo, crmUpdate, multimediaInfo } = data;

        let note = `💡 **ASISTENTE DE SOPORTE**\n\n`;

        // Tipo de conversación
        const typeEmojis = {
            onboarding: '🎓',
            recetas: '👨‍🍳',
            problema: '🔧',
            garantia: '📋'
        };
        const emoji = typeEmojis[analysis.conversation_type] || '💬';
        note += `${emoji} **Tipo**: ${analysis.conversation_type || 'consulta'}\n`;

        // Urgencia
        const urgencyEmojis = { alta: '🔴', media: '🟡', baja: '🟢' };
        const urgencyEmoji = urgencyEmojis[analysis.urgency] || '🟡';
        note += `${urgencyEmoji} **Urgencia**: ${analysis.urgency || 'media'}\n`;

        // Satisfacción
        const satisfactionEmojis = { alto: '😊', medio: '😐', bajo: '😞' };
        const satEmoji = satisfactionEmojis[analysis.satisfaction] || '😐';
        note += `${satEmoji} **Satisfacción**: ${analysis.satisfaction || 'medio'}\n\n`;

        // Descripción del problema
        if (analysis.issue_description) {
            note += `❗ **Problema**: ${analysis.issue_description}\n\n`;
        }

        // Lo que intentó el cliente
        if (analysis.customer_tried && analysis.customer_tried.length > 0) {
            note += `✅ **Cliente ya intentó**:\n`;
            analysis.customer_tried.forEach(action => {
                note += `  • ${action}\n`;
            });
            note += `\n`;
        }

        // Sugerencias
        note += `🤖 **SUGERENCIAS**:\n\n`;

        if (suggestions.response) {
            note += `💬 **Respuesta sugerida**:\n"${suggestions.response}"\n\n`;
        }

        if (suggestions.topics && suggestions.topics.length > 0) {
            note += `📌 **Temas a abordar**:\n`;
            suggestions.topics.forEach((topic, i) => {
                note += `  ${i + 1}. ${topic}\n`;
            });
            note += `\n`;
        }

        if (suggestions.action) {
            const actionEmojis = {
                escalar_tecnico: '🚨',
                enviar_tutorial: '📚',
                agendar_llamada: '📞',
                enviar_garantia: '📋',
                guiar_onboarding: '🎓'
            };
            const actionEmoji = actionEmojis[suggestions.action] || '🎯';
            note += `${actionEmoji} **Acción recomendada**: ${suggestions.action.replace(/_/g, ' ')}\n`;
        }

        if (suggestions.reasoning) {
            note += `\n💭 _${suggestions.reasoning}_\n`;
        }

        // Multimedia procesada (especialmente útil para capturas de pantalla de errores)
        if (multimediaInfo && multimediaInfo.hasMultimedia) {
            note += `\n🎬 **MULTIMEDIA PROCESADA**:\n`;
            
            const extracted = multimediaInfo.extractedInfo || {};
            const fieldsCount = Object.keys(extracted).length;
            
            if (fieldsCount > 0) {
                note += `  ✓ ${fieldsCount} campo(s) extraído(s) de multimedia\n`;
                const relevantFields = [];
                if (extracted.equipment_serial) relevantFields.push(`Serial: ${extracted.equipment_serial}`);
                if (extracted.mobile_phone) relevantFields.push(`Teléfono: ${extracted.mobile_phone}`);
                if (extracted.email) relevantFields.push(`Email: ${extracted.email}`);
                if (relevantFields.length > 0) {
                    note += `  📋 ${relevantFields.join(', ')}\n`;
                }
            }
            
            if (multimediaInfo.summary) {
                note += `  ℹ️  ${multimediaInfo.summary}\n`;
            }
        }

        // Serial capturado
        if (extractedInfo.id_equipo) {
            note += `\n🔢 **Serial capturado**: ${extractedInfo.id_equipo}\n`;
        }

        // Estado de CRM
        if (crmUpdate) {
            const chatwootChanges = crmUpdate.chatwoot?.changes?.length || 0;
            const rdChanges = crmUpdate.rdStation?.changes?.length || 0;
            if (chatwootChanges > 0 || rdChanges > 0) {
                note += `\n✅ Actualizado: Chatwoot (${chatwootChanges}), RD Station (${rdChanges})\n`;
            }
        }

        note += `\n---\n_Sugerencia generada automáticamente por Post-Venta Agent_`;

        await this.createInternalNote(conversationId, note, true);
    }
}

export default PostVentaAgent;

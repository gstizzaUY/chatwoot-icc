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
        const { analysis, suggestions, extractedInfo, crmUpdate } = data;

        let note = `**Agente IA - Asistente de Soporte**\n`;
        note += `**Tipo:** ${analysis.conversation_type || 'consulta'} | **Urgencia:** ${analysis.urgency || 'media'} | **Satisfaccion:** ${analysis.satisfaction || 'medio'}`;

        if (analysis.issue_description) {
            note += `\n**Problema:** ${analysis.issue_description}`;
        }

        if (analysis.customer_tried && analysis.customer_tried.length > 0) {
            note += `\n**Cliente intento:** ${analysis.customer_tried.join(', ')}`;
        }

        if (suggestions.response) {
            note += `\n**Respuesta sugerida:** "${suggestions.response}"`;
        }

        if (suggestions.topics && suggestions.topics.length > 0) {
            note += `\n**Temas:** ${suggestions.topics.join(' | ')}`;
        }

        if (suggestions.action) {
            note += `\n**Accion:** ${suggestions.action.replace(/_/g, ' ')}`;
        }

        if (extractedInfo.id_equipo) {
            note += `\n**Serial:** ${extractedInfo.id_equipo}`;
        }

        const chatwootChanges = crmUpdate?.chatwoot?.changes;
        if (chatwootChanges && chatwootChanges.length > 0) {
            note += `\n\n**Cambios en Chatwoot (${chatwootChanges.length}):**\n`;
            chatwootChanges.forEach(c => {
                note += `  ${c.field}: "${c.old}" → "${c.new}"\n`;
            });
        }

        await this.createInternalNote(conversationId, note, true);
    }
}

export default PostVentaAgent;

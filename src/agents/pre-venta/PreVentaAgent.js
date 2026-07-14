import BaseAgent from '../base/BaseAgent.js';
import { PRE_VENTA_SYSTEM_PROMPT, PRE_VENTA_USER_PROMPT_TEMPLATE } from './pre-venta.prompts.js';
import { PRE_VENTA_CHANNELS } from '../../constants/agent.constants.js';

/**
 * Agente de Pre-Venta
 * Actua en tiempo real en canales comerciales
 * Sugiere respuestas y acciones comerciales
 */
class PreVentaAgent extends BaseAgent {
    constructor() {
        super({
            agentType: 'pre-venta',
            channels: PRE_VENTA_CHANNELS
        });
        this.reportedFields = new Map();
        this.SUGGESTIONS_ENABLED = false;
    }

    getSystemPrompt() {
        return PRE_VENTA_SYSTEM_PROMPT;
    }

    buildUserPrompt(context) {
        const { contact, filteredMessages, previousConversations } = context;

        let contactInfo = '';
        if (contact) {
            contactInfo = `CONTACTO ACTUAL:\n`;
            if (contact.name) contactInfo += `- Nombre: ${contact.name}\n`;
            if (contact.email) contactInfo += `- Email: ${contact.email}\n`;
            if (contact.phone_number) contactInfo += `- Telefono: ${contact.phone_number}\n`;
            if (contact.custom_attributes?.city) contactInfo += `- Ciudad: ${contact.custom_attributes.city}\n`;
            if (contact.custom_attributes?.tiene_ichef) contactInfo += `- Tiene iChef: ${contact.custom_attributes.tiene_ichef}\n`;
        }

        let conversationHistory = '';
        if (previousConversations && previousConversations.length > 0) {
            const resolved = previousConversations.filter(c => c.status === 'resolved').slice(0, 3);
            if (resolved.length > 0) {
                conversationHistory = `\nHISTORIAL PREVIO (${resolved.length} conversaciones):\n`;
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

        let multimediaInfo = '';
        if (context.multimediaInfo && context.multimediaInfo.hasMultimedia) {
            const extracted = context.multimediaInfo.extractedInfo;
            const fields = Object.entries(extracted).map(([key, value]) => `${key}: ${value}`).join(', ');
            multimediaInfo = `\n\nINFORMACION EXTRAIDA DE MULTIMEDIA:\n${fields}\n`;
        }

        return PRE_VENTA_USER_PROMPT_TEMPLATE
            .replace('{contact_info}', contactInfo)
            .replace('{conversation_history}', conversationHistory)
            .replace('{messages}', messagesText + multimediaInfo);
    }

    async processResult(aiResult, context) {
        const { conversation, contact } = context;

        const extractedInfo = aiResult.extracted_info || {};
        const analysis = aiResult.analysis || {};
        const suggestions = aiResult.suggestions || {};

        console.log('Pre-Venta - Info extraida:', extractedInfo);
        console.log('Analisis:', analysis);

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
                console.log('CRMs actualizados con nueva informacion');
            } catch (error) {
                console.error('Error actualizando CRMs:', error.message);
            }
        }

        await this.createSuggestionNote(conversation.id, {
            analysis,
            suggestions,
            extractedInfo: validatedInfo,
            crmUpdate,
            multimediaInfo: context.multimediaInfo
        });

        return {
            extractedInfo: validatedInfo,
            analysis,
            suggestions,
            crmUpdate
        };
    }

    /**
     * Crea nota interna con sugerencias para el agente humano.
     * - Respuesta sugerida DESTACADA al inicio
     * - Datos tecnicos en texto pequeno al final
     * - No repite campos ya reportados en notas anteriores
     */
    async createSuggestionNote(conversationId, data) {
        const { analysis, suggestions, extractedInfo, crmUpdate } = data;

        const alreadyReported = this.reportedFields.get(conversationId) || new Set();

        const newFields = Object.entries(extractedInfo)
            .filter(([k, v]) => v !== null && v !== undefined && v !== '' && !alreadyReported.has(k));

        const chatwootChanges = crmUpdate?.chatwoot?.changes;
        const hasChanges = (chatwootChanges && chatwootChanges.length > 0);

        // SILENCIOSO: si no hay datos nuevos ni cambios en CRM, no crear nota
        if (newFields.length === 0 && !hasChanges) {
            console.log(`🤫 Pre-Venta: sin datos nuevos en conversacion ${conversationId} - sin nota`);
            return;
        }

        const updated = new Set(alreadyReported);
        newFields.forEach(([k]) => updated.add(k));
        this.reportedFields.set(conversationId, updated);

        let note = '';

        if (this.SUGGESTIONS_ENABLED) {
            if (suggestions.response) {
                note += `### 💬 Respuesta sugerida\n\n> ${suggestions.response}\n\n`;
            }
            if (suggestions.action) {
                note += `**Accion:** ${suggestions.action.replace(/_/g, ' ')}\n\n`;
            }
            note += `---\n*Analisis de IA*\n`;
            const interestEmoji = analysis.interest_level === 'alto' ? '🔥' :
                                  analysis.interest_level === 'medio' ? '🌡️' : '❄️';
            note += `Interes: ${interestEmoji} ${analysis.interest_level || 'medio'}`;
            if (analysis.urgency) note += ` | Urgencia: ${analysis.urgency}`;
            if (analysis.intent) note += ` | Intencion: ${analysis.intent}`;
            if (analysis.buying_signals?.length) note += `\nSeniales: ${analysis.buying_signals.join(', ')}`;
            if (analysis.objections?.length) note += `\nObjeciones: ${analysis.objections.join(', ')}`;
            note += `\n\n`;
        }

        if (newFields.length > 0) {
            note += `*Datos capturados:* ${newFields.map(([k, v]) => `\`${k}=${v}\``).join(', ')}`;
        }

        if (alreadyReported.size > 0) {
            note += `\n*Ya registrado:* ${[...alreadyReported].join(', ')}`;
        }

        if (hasChanges) {
            note += `\n\n**Cambios en Chatwoot (${chatwootChanges.length}):**\n`;
            chatwootChanges.forEach(c => {
                note += `  ${c.field}: "${c.old}" → "${c.new}"\n`;
            });
        }

        await this.createInternalNote(conversationId, note, true);
    }
}

export default PreVentaAgent;

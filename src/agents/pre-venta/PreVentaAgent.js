import BaseAgent from '../base/BaseAgent.js';
import { PRE_VENTA_SYSTEM_PROMPT, PRE_VENTA_USER_PROMPT_TEMPLATE } from './pre-venta.prompts.js';
import { PRE_VENTA_CHANNELS } from '../../constants/agent.constants.js';

/**
 * Agente de Pre-Venta
 * Actúa en tiempo real en canales comerciales
 * Sugiere respuestas y acciones comerciales
 */
class PreVentaAgent extends BaseAgent {
    constructor() {
        super({
            agentType: 'pre-venta',
            channels: PRE_VENTA_CHANNELS
        });
    }

    /**
     * Prompt del sistema específico para pre-venta
     */
    getSystemPrompt() {
        return PRE_VENTA_SYSTEM_PROMPT;
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

        // Mensajes actuales (últimos 10 para contexto reciente)
        const recentMessages = filteredMessages.slice(-10);
        const messagesText = this.contextBuilder.formatMessagesWithMultimediaForAI(recentMessages);

        // Agregar información de multimedia si está disponible
        let multimediaInfo = '';
        if (context.multimediaInfo && context.multimediaInfo.hasMultimedia) {
            const extracted = context.multimediaInfo.extractedInfo;
            const fields = Object.entries(extracted).map(([key, value]) => `${key}: ${value}`).join(', ');
            multimediaInfo = `\n\nINFORMACIÓN EXTRAÍDA DE MULTIMEDIA:\n${fields}\n`;
        }

        return PRE_VENTA_USER_PROMPT_TEMPLATE
            .replace('{contact_info}', contactInfo)
            .replace('{conversation_history}', conversationHistory)
            .replace('{messages}', messagesText + multimediaInfo);
    }

    /**
     * Procesa resultado del análisis
     */
    async processResult(aiResult, context) {
        const { conversation, contact } = context;

        // 1. Extraer información
        const extractedInfo = aiResult.extracted_info || {};
        const analysis = aiResult.analysis || {};
        const suggestions = aiResult.suggestions || {};

        console.log('🔍 Pre-Venta - Info extraída:', extractedInfo);
        console.log('📊 Análisis:', analysis);

        // 2. Aplicar reglas de negocio
        const validatedInfo = this.applyBusinessRules(extractedInfo, contact);

        // 3. Actualizar CRMs si hay información nueva
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
                console.log('✅ CRMs actualizados con nueva información');
            } catch (error) {
                console.error('⚠️  Error actualizando CRMs:', error.message);
            }
        }

        // 4. Crear nota interna con sugerencias
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

    /**
     * Crea nota interna con sugerencias para el agente humano
     */
    async createSuggestionNote(conversationId, data) {
        const { analysis, suggestions, extractedInfo, crmUpdate, multimediaInfo } = data;

        let note = `💡 **ASISTENTE DE VENTAS**\n\n`;

        // Análisis
        const interestEmoji = { alto: '🔥', medio: '🌡️', bajo: '❄️' }[analysis.interest_level] || '📊';
        note += `${interestEmoji} **Interés**: ${analysis.interest_level || 'medio'}\n`;
        note += `⚡ **Urgencia**: ${analysis.urgency || 'media'}\n`;
        note += `🎯 **Intención**: ${analysis.intent || 'consulta'}\n\n`;

        // Señales de compra
        if (analysis.buying_signals && analysis.buying_signals.length > 0) {
            note += `✅ **Señales de compra**:\n`;
            analysis.buying_signals.forEach(signal => {
                note += `  • ${signal}\n`;
            });
            note += `\n`;
        }

        // Objeciones
        if (analysis.objections && analysis.objections.length > 0) {
            note += `⚠️ **Objeciones detectadas**:\n`;
            analysis.objections.forEach(obj => {
                note += `  • ${obj}\n`;
            });
            note += `\n`;
        }

        // Sugerencias
        note += `🤖 **SUGERENCIAS**:\n\n`;

        if (suggestions.response) {
            note += `💬 **Respuesta sugerida**:\n"${suggestions.response}"\n\n`;
        }

        if (suggestions.questions && suggestions.questions.length > 0) {
            note += `❓ **Preguntas estratégicas**:\n`;
            suggestions.questions.forEach((q, i) => {
                note += `  ${i + 1}. ${q}\n`;
            });
            note += `\n`;
        }

        if (suggestions.action) {
            const actionEmojis = {
                agendar_demo: '📅',
                enviar_catalogo: '📧',
                hacer_oferta: '💰',
                dar_seguimiento: '📞',
                capturar_contacto: '📝'
            };
            const emoji = actionEmojis[suggestions.action] || '🎯';
            note += `${emoji} **Acción recomendada**: ${suggestions.action.replace(/_/g, ' ')}\n`;
        }

        if (suggestions.reasoning) {
            note += `\n💭 _${suggestions.reasoning}_\n`;
        }

        // Multimedia procesada
        if (multimediaInfo && multimediaInfo.hasMultimedia) {
            note += `\n🎬 **MULTIMEDIA PROCESADA**:\n`;
            
            const extracted = multimediaInfo.extractedInfo || {};
            const fieldsCount = Object.keys(extracted).length;
            
            if (fieldsCount > 0) {
                note += `  ✓ ${fieldsCount} campo(s) extraído(s) de multimedia\n`;
                const relevantFields = [];
                if (extracted.firstname) relevantFields.push(`Nombre: ${extracted.firstname}`);
                if (extracted.lastname) relevantFields.push(`Apellido: ${extracted.lastname}`);
                if (extracted.email) relevantFields.push(`Email: ${extracted.email}`);
                if (extracted.mobile_phone) relevantFields.push(`Celular: ${extracted.mobile_phone}`);
                if (relevantFields.length > 0) {
                    note += `  📋 ${relevantFields.join(', ')}\n`;
                }
            }
            
            if (multimediaInfo.summary) {
                note += `  ℹ️  ${multimediaInfo.summary}\n`;
            }
        }

        // Información capturada
        const capturedFields = Object.entries(extractedInfo).filter(([k, v]) => v !== null && v !== undefined && v !== '');
        if (capturedFields.length > 0) {
            note += `\n📋 **Info capturada** (${capturedFields.length} campos):\n`;
            capturedFields.slice(0, 5).forEach(([key, value]) => {
                note += `  • ${key}: ${value}\n`;
            });
        }

        // Estado de CRM
        if (crmUpdate) {
            const chatwootChanges = crmUpdate.chatwoot?.changes?.length || 0;
            const rdChanges = crmUpdate.rdStation?.changes?.length || 0;
            if (chatwootChanges > 0 || rdChanges > 0) {
                note += `\n✅ Actualizado: Chatwoot (${chatwootChanges}), RD Station (${rdChanges})\n`;
            }
        }

        note += `\n---\n_Sugerencia generada automáticamente por Pre-Venta Agent_`;

        await this.createInternalNote(conversationId, note, true);
    }
}

export default PreVentaAgent;

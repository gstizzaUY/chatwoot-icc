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
        const { analysis, suggestions, extractedInfo } = data;

        let note = `**Agente IA - Asistente de Ventas**\n`;
        note += `**Interes:** ${analysis.interest_level || 'medio'} | **Urgencia:** ${analysis.urgency || 'media'} | **Intencion:** ${analysis.intent || 'consulta'}`;

        if (analysis.buying_signals && analysis.buying_signals.length > 0) {
            note += `\n**Seniales de compra:** ${analysis.buying_signals.join(', ')}`;
        }

        if (analysis.objections && analysis.objections.length > 0) {
            note += `\n**Objeciones:** ${analysis.objections.join(', ')}`;
        }

        if (suggestions.response) {
            note += `\n**Respuesta sugerida:** "${suggestions.response}"`;
        }

        if (suggestions.action) {
            note += `\n**Accion:** ${suggestions.action.replace(/_/g, ' ')}`;
        }

        const capturedFields = Object.entries(extractedInfo)
            .filter(([k, v]) => v !== null && v !== undefined && v !== '');
        if (capturedFields.length > 0) {
            note += `\n**Info:** ${capturedFields.map(([k, v]) => `${k}=${v}`).join(', ')}`;
        }

        await this.createInternalNote(conversationId, note, true);
    }
}

export default PreVentaAgent;

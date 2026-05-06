import agentFactory from '../agents/AgentFactory.js';
import contextBuilderService from './shared/context-builder.service.js';
import {
    CHANNEL_TO_AGENT,
    AGENT_TRIGGERS,
    AGENT_TYPES,
    EXCLUDED_CONTACT_IDS
} from '../constants/agent.constants.js';

/**
 * Orquestador de Agentes IA
 * Determina qué agente ejecutar según canal, evento y contexto
 */
class AgentOrchestratorService {
    constructor() {
        this.processingMap = new Map(); // Cache de procesamiento para evitar duplicados
        this.cacheTimeout = 60000; // 60 segundos
    }

    /**
     * Procesa un evento de webhook y ejecuta el agente apropiado
     * 
     * @param {string} eventType - Tipo de evento (message_created, conversation_status_changed)
     * @param {Object} payload - Payload del webhook
     * @returns {Promise<Object>} - Resultado de la ejecución
     */
    async processWebhookEvent(eventType, payload) {
        console.log(`🎯 Orquestador - Procesando evento: ${eventType}`);

        try {
            // 1. Determinar agente según canal
            const inboxId = payload.conversation?.inbox_id || payload.inbox?.id;
            if (!inboxId) {
                console.log('⚠️  No se pudo determinar inbox_id');
                return { success: false, reason: 'no_inbox_id' };
            }

            const agentType = this.determineAgentType(inboxId);
            if (!agentType) {
                console.log(`⚠️  Inbox ${inboxId} no tiene agente asignado`);
                return { success: false, reason: 'no_agent_for_inbox' };
            }

            // 2. Verificar si el contacto está excluido (conversaciones internas)
            const contactId = payload.conversation?.meta?.sender?.id || 
                            payload.meta?.sender?.id || 
                            payload.sender?.id ||
                            payload.contact_id;

            if (contactId && EXCLUDED_CONTACT_IDS.includes(contactId)) {
                console.log(`🚫 Contacto ${contactId} está en lista de exclusión (conversación interna) - ignorado`);
                return { success: false, reason: 'excluded_contact' };
            }

            // 3. Validar si debe ejecutarse según evento y tipo de agente
            const shouldExecute = await this.shouldExecuteAgent(
                agentType,
                eventType,
                payload
            );

            if (!shouldExecute) {
                console.log(`⏭️  Agente ${agentType} no debe ejecutarse en este momento`);
                return { success: false, reason: 'trigger_conditions_not_met' };
            }

            // 4. Evitar procesamiento duplicado
            const conversationId = payload.conversation?.id || payload.id;
            const cacheKey = `${agentType}-${conversationId}-${Date.now()}`;
            
            if (this.processingMap.has(cacheKey)) {
                console.log('⏭️  Ya procesando esta conversación');
                return { success: false, reason: 'already_processing' };
            }

            this.processingMap.set(cacheKey, true);
            setTimeout(() => this.processingMap.delete(cacheKey), this.cacheTimeout);

            // 5. Obtener y ejecutar agente
            const agent = agentFactory.getAgent(agentType);
            const result = await agent.execute(conversationId, {
                includeHistory: true
            });

            console.log(`✅ Orquestador - Agente ${agentType} ejecutado exitosamente`);

            return result;
        } catch (error) {
            console.error('❌ Error en orquestador:', error.message);
            throw error;
        }
    }

    /**
     * Determina tipo de agente según inbox ID
     * 
     * @param {number} inboxId - ID del inbox
     * @returns {string|null} - Tipo de agente o null
     */
    determineAgentType(inboxId) {
        return CHANNEL_TO_AGENT[inboxId] || null;
    }

    /**
     * Valida si un agente debe ejecutarse según las condiciones de trigger
     * 
     * @param {string} agentType - Tipo de agente
     * @param {string} eventType - Tipo de evento
     * @param {Object} payload - Payload del webhook
     * @returns {Promise<boolean>}
     */
    async shouldExecuteAgent(agentType, eventType, payload) {
        const triggers = AGENT_TRIGGERS[agentType];

        if (!triggers) {
            console.warn(`⚠️  No hay triggers definidos para agente ${agentType}`);
            return false;
        }

        console.log(`🔍 Validando triggers para ${agentType}:`, {
            eventType,
            triggersEvents: triggers.events,
            triggersConfig: triggers
        });

        // 1. Validar evento
        if (!triggers.events.includes(eventType)) {
            console.log(`⏭️  Evento ${eventType} no está en triggers para ${agentType}`);
            return false;
        }

        // 2. Para eventos de estado, validar estado específico
        if (eventType === 'conversation_status_changed') {
            const status = payload.status;
            if (triggers.status && !triggers.status.includes(status)) {
                console.log(`⏭️  Status ${status} no está en triggers para ${agentType}`);
                return false;
            }
            return true; // Si el status coincide, ejecutar
        }

        // 3. Para eventos de mensaje, validar conteo
        if (eventType === 'message_created') {
            const conversationId = payload.conversation?.id;
            if (!conversationId) {
                console.log('⏭️  No se pudo obtener conversationId del payload');
                return false;
            }

            // Obtener mensajes del cliente
            const context = await contextBuilderService.buildContext(conversationId, {
                includeHistory: false,
                includeContact: false
            });

            const incomingCount = contextBuilderService.countIncomingMessages(context.messages);

            console.log(`📊 Análisis de mensajes:`, {
                totalMessages: context.messages.length,
                clientMessages: incomingCount,
                triggerOnMessageNumber: triggers.onMessageNumber,
                triggerEveryNMessages: triggers.everyNMessages
            });

            // Ejecutar en mensaje inicial
            if (triggers.onMessageNumber && triggers.onMessageNumber.includes(incomingCount)) {
                console.log(`✅ Mensaje inicial (${incomingCount}) - ejecutar agente`);
                return true;
            }

            // Ejecutar cada N mensajes
            if (triggers.everyNMessages && incomingCount > 1) {
                const isMultiple = incomingCount % triggers.everyNMessages === 0;
                if (isMultiple) {
                    console.log(`✅ Cada ${triggers.everyNMessages} mensajes (actual: ${incomingCount}) - ejecutar agente`);
                    return true;
                } else {
                    const nextTrigger = Math.ceil(incomingCount / triggers.everyNMessages) * triggers.everyNMessages;
                    console.log(`⏭️  No es múltiplo de ${triggers.everyNMessages}. Próximo trigger en mensaje ${nextTrigger}`);
                }
            }

            console.log(`⏭️  Condiciones de trigger no cumplidas (${incomingCount} mensajes del cliente)`);
            return false;
        }

        return false;
    }

    /**
     * Ejecuta agente de resumen (legacy support para conversation-analysis)
     * 
     * @param {number} conversationId - ID de la conversación
     * @returns {Promise<Object>}
     */
    async executeResumenAgent(conversationId) {
        console.log('📝 Ejecutando agente de resumen (legacy)');
        
        // Importar dinámicamente para evitar dependencia circular
        const { default: conversationAnalysisService } = await import('./conversation-analysis.service.js');
        
        return await conversationAnalysisService.processClosedConversation(conversationId);
    }
}

export default new AgentOrchestratorService();

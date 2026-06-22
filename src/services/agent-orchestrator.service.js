import agentFactory from '../agents/AgentFactory.js';
import contextBuilderService from './shared/context-builder.service.js';
import {
    CHANNEL_TO_AGENT,
    AGENT_TRIGGERS,
    AGENT_TYPES,
    EXCLUDED_CONTACT_IDS
} from '../constants/agent.constants.js';

const NUTRIDOR_ENABLED = process.env.NUTRIDOR_ENABLED !== 'false';

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

            console.log(`🤖 Agente determinado: ${agentType} para inbox ${inboxId}`);

            // SALVEDAD: Canal 23 (iChef Marty Wpp) tiene prioridad de Nutridor
            // Si Nutridor debe activarse o está activo, bloquear otros agentes
            if (inboxId === 23 && eventType === 'message_created') {
                const nutridorPriority = await this._checkNutridorPriority(
                    payload.conversation?.id,
                    agentType
                );

                if (nutridorPriority.shouldBlockOtherAgents) {
                    console.log(`🌱 Canal 23: Nutridor tiene prioridad - bloqueando ${agentType}`);
                    
                    // Si el agente actual ES el nutridor, continuar
                    // Si es otro agente (PreVenta), bloquear
                    if (nutridorPriority.executeNutridor) {
                        console.log('✅ Ejecutando Nutridor en su lugar');
                        const nutridorAgent = agentFactory.getAgent('nutridor');
                        const result = await nutridorAgent.execute(payload.conversation?.id);
                        return { success: true, agent: 'nutridor', result };
                    } else {
                        console.log('⏭️  Nutridor activo - otros agentes bloqueados');
                        return { success: false, reason: 'nutridor_active' };
                    }
                }
            }

            // 3. Verificar si el contacto está excluido (conversaciones internas)
            // En canales email (1, 12, 33), meta.sender puede apuntar al agente en vez del contacto real
            const isEmailChannel = [1, 12, 33].includes(inboxId);
            const contactId = isEmailChannel
                ? (payload.contact?.id || payload.sender?.id || payload.contact_id)
                : (payload.conversation?.meta?.sender?.id || payload.meta?.sender?.id || payload.sender?.id || payload.contact_id);

            if (contactId && EXCLUDED_CONTACT_IDS.includes(contactId)) {
                console.log(`🚫 Contacto ${contactId} está en lista de exclusión (conversación interna) - ignorado`);
                return { success: false, reason: 'excluded_contact' };
            }

            // 4. Validar si debe ejecutarse según evento y tipo de agente
            const shouldExecute = await this.shouldExecuteAgent(
                agentType,
                eventType,
                payload
            );

            if (!shouldExecute) {
                console.log(`⏭️  Agente ${agentType} no debe ejecutarse en este momento`);
                return { success: false, reason: 'trigger_conditions_not_met' };
            }

            // 5. Evitar procesamiento duplicado
            const conversationId = payload.conversation?.id || payload.id;
            const cacheKey = `${agentType}-${conversationId}-${Date.now()}`;
            
            if (this.processingMap.has(cacheKey)) {
                console.log('⏭️  Ya procesando esta conversación');
                return { success: false, reason: 'already_processing' };
            }

            this.processingMap.set(cacheKey, true);
            setTimeout(() => this.processingMap.delete(cacheKey), this.cacheTimeout);

            // 6. Obtener y ejecutar agente
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

        // 3. Para eventos de mensaje, validar según tipo de agente
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

            // CASO ESPECIAL: Agente Nutridor (trigger por mensaje específico)
            if (agentType === 'nutridor') {
                return await this._shouldExecuteNutridor(conversationId, context.messages, triggers);
            }

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
     * Lógica especial para agente nutridor
     * Se activa cuando detecta mensaje trigger del bot y continúa hasta que humano responda
     * 
     * @private
     */
    async _shouldExecuteNutridor(conversationId, messages, triggers) {
        if (!NUTRIDOR_ENABLED) return false;

        const agentFactory = (await import('../agents/AgentFactory.js')).default;
        const nutridorAgent = agentFactory.getAgent('nutridor');

        // Verificar si el agente ya está activo en esta conversación
        const isActive = nutridorAgent.isConversationActive(conversationId);

        // Si está activo, verificar si un humano respondió
        if (isActive) {
            const humanResponded = nutridorAgent.hasHumanResponded(messages);
            if (humanResponded) {
                console.log('👤 Humano respondió - desactivando agente nutridor');
                nutridorAgent.activeConversations.delete(conversationId);
                return false;
            }

            // Continuar activo si no hay respuesta humana
            console.log('🌱 Nutridor continúa activo');
            return true;
        }

        // Si no está activo, verificar si debe activarse (mensaje trigger)
        const shouldActivate = nutridorAgent.shouldActivate(messages);

        if (shouldActivate) {
            console.log('✅ Mensaje trigger detectado - activando agente nutridor');
            return true;
        }

        console.log('⏭️  Agente nutridor no debe activarse');
        return false;
    }

    /**
     * Verifica si el Nutridor debe tener prioridad sobre otros agentes (canal 23)
     * 
     * @private
     * @param {number} conversationId - ID de la conversación
     * @param {string} requestedAgentType - Tipo de agente que se quiere ejecutar
     * @returns {Promise<Object>} - { shouldBlockOtherAgents, executeNutridor }
     */
    async _checkNutridorPriority(conversationId, requestedAgentType) {
        if (!NUTRIDOR_ENABLED) {
            return { shouldBlockOtherAgents: false, executeNutridor: false };
        }

        if (!conversationId) {
            return { shouldBlockOtherAgents: false, executeNutridor: false };
        }

        try {
            // Obtener contexto para verificar mensajes
            const context = await contextBuilderService.buildContext(conversationId, {
                includeHistory: false,
                includeContact: false,
                processMultimedia: false  // No necesario para esta verificación
            });

            const agentFactory = (await import('../agents/AgentFactory.js')).default;
            const nutridorAgent = agentFactory.getAgent('nutridor');

            // Verificar si el Nutridor ya está activo
            const isActive = nutridorAgent.isConversationActive(conversationId);

            // Verificar si debe activarse (mensaje trigger)
            const shouldActivate = nutridorAgent.shouldActivate(context.messages);

            // Verificar si un humano ya respondió
            const humanResponded = nutridorAgent.hasHumanResponded(context.messages);

            console.log(`🔍 Prioridad Nutridor - Canal 23:`, {
                isActive,
                shouldActivate,
                humanResponded,
                requestedAgent: requestedAgentType
            });

            // Si el Nutridor está activo y NO ha respondido un humano, ejecutarlo
            if (isActive && !humanResponded) {
                return {
                    shouldBlockOtherAgents: true,
                    executeNutridor: true  // ✅ SIEMPRE ejecutar si está activo
                };
            }

            // Si debe activarse (mensaje trigger detectado), activar Nutridor y bloquear otros
            if (shouldActivate && !humanResponded) {
                return {
                    shouldBlockOtherAgents: true,
                    executeNutridor: true  // Ejecutar Nutridor en lugar del agente solicitado
                };
            }

            // Si un humano respondió, desactivar Nutridor y permitir otros agentes
            if (humanResponded && isActive) {
                console.log('👤 Humano respondió - liberando canal para otros agentes');
                nutridorAgent.activeConversations.delete(conversationId);
            }

            // No bloquear - permitir que otros agentes (PreVenta) se ejecuten
            return {
                shouldBlockOtherAgents: false,
                executeNutridor: false
            };

        } catch (error) {
            console.error('❌ Error verificando prioridad de Nutridor:', error.message);
            // En caso de error, no bloquear
            return {
                shouldBlockOtherAgents: false,
                executeNutridor: false
            };
        }
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

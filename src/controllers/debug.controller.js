import agentOrchestratorService from '../services/agent-orchestrator.service.js';
import contextBuilderService from '../services/shared/context-builder.service.js';
import { CHANNEL_TO_AGENT, AGENT_TRIGGERS, EXCLUDED_CONTACT_IDS } from '../constants/agent.constants.js';

/**
 * Controladores de debugging para el sistema multi-agente
 */

/**
 * Verifica si un agente debe ejecutarse en una conversación
 * GET /api/v2/debug/should-trigger/:conversationId
 */
export const checkTrigger = async (req, res) => {
    try {
        const { conversationId } = req.params;

        console.log(`🔍 Debugging trigger para conversación ${conversationId}`);

        // 1. Construir contexto
        const context = await contextBuilderService.buildContext(parseInt(conversationId), {
            includeHistory: false,
            includeContact: true
        });

        // 2. Determinar agente
        const inboxId = context.conversation.inbox_id;
        const agentType = CHANNEL_TO_AGENT[inboxId];

        // 2.1. Verificar si el contacto está excluido
        const contactId = context.contact?.id;
        const isExcluded = contactId && EXCLUDED_CONTACT_IDS.includes(contactId);

        // 3. Contar mensajes
        const allMessages = context.messages.length;
        const incomingCount = contextBuilderService.countIncomingMessages(context.messages);

        // 4. Obtener triggers
        const triggers = AGENT_TRIGGERS[agentType];

        // 5. Verificar condiciones
        let shouldTriggerInitial = false;
        let shouldTriggerEvery = false;

        if (triggers) {
            shouldTriggerInitial = triggers.onMessageNumber?.includes(incomingCount) || false;
            
            if (triggers.everyNMessages && incomingCount > 1) {
                shouldTriggerEvery = (incomingCount % triggers.everyNMessages === 0);
            }
        }

        const shouldExecute = shouldTriggerInitial || shouldTriggerEvery;

        // 6. Construir respuesta detallada
        const response = {
            conversationId: parseInt(conversationId),
            status: context.conversation.status,
            inboxId,
            agentType: agentType || 'ninguno (canal no configurado)',
            
            contact: {
                id: contactId,
                name: context.contact?.name,
                isExcluded: isExcluded,
                exclusionReason: isExcluded ? 'Contacto en lista de exclusión (conversación interna)' : null
            },
            
            messages: {
                total: allMessages,
                fromClient: incomingCount,
                lastMessage: context.messages[context.messages.length - 1]?.content?.substring(0, 100)
            },
            
            triggers: triggers || 'No hay triggers configurados para este agente',
            
            evaluation: {
                shouldTriggerOnInitial: shouldTriggerInitial,
                shouldTriggerOnEvery: shouldTriggerEvery,
                shouldExecute: shouldExecute && !isExcluded,
                reasoning: isExcluded 
                    ? `🚫 Contacto excluido (conversación interna)`
                    : shouldExecute 
                    ? `✅ Debería ejecutarse: ${shouldTriggerInitial ? 'mensaje inicial' : `cada ${triggers.everyNMessages} mensajes`}`
                    : `❌ NO debería ejecutarse: ${incomingCount} mensajes del cliente no cumplen condiciones`
            },

            recommendations: []
        };

        // Agregar recomendaciones
        if (isExcluded) {
            response.recommendations.push(`🚫 Contacto ${contactId} está en EXCLUDED_CONTACT_IDS - los agentes no procesarán esta conversación`);
        }

        if (!agentType) {
            response.recommendations.push(`Inbox ${inboxId} no tiene agente asignado. Verifica CHANNEL_TO_AGENT en agent.constants.js`);
        }

        if (incomingCount === 0) {
            response.recommendations.push('No hay mensajes del cliente todavía');
        }

        if (triggers && incomingCount > 0 && !shouldExecute && !isExcluded) {
            const nextTrigger = Math.ceil(incomingCount / triggers.everyNMessages) * triggers.everyNMessages;
            response.recommendations.push(`Próximo trigger en mensaje ${nextTrigger} del cliente`);
        }

        console.log('📊 Resultado debug:', JSON.stringify(response, null, 2));

        res.json({
            success: true,
            data: response
        });

    } catch (error) {
        console.error('❌ Error en checkTrigger:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

/**
 * Simula un webhook de message_created
 * POST /api/v2/debug/simulate-message/:conversationId
 */
export const simulateMessage = async (req, res) => {
    try {
        const { conversationId } = req.params;

        console.log(`🧪 Simulando message_created para conversación ${conversationId}`);

        // Obtener conversación real
        const context = await contextBuilderService.buildContext(parseInt(conversationId), {
            includeHistory: false,
            includeContact: true
        });

        // Construir payload simulado
        const payload = {
            event: 'message_created',
            message_type: 0, // incoming
            incoming: true,
            conversation: {
                id: parseInt(conversationId),
                inbox_id: context.conversation.inbox_id
            }
        };

        // Ejecutar orquestador
        const result = await agentOrchestratorService.processWebhookEvent(
            'message_created',
            payload
        );

        res.json({
            success: true,
            message: 'Webhook simulado ejecutado',
            payload,
            result
        });

    } catch (error) {
        console.error('❌ Error simulando webhook:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Lista todos los mensajes de una conversación con detalles
 * GET /api/v2/debug/messages/:conversationId
 */
export const listMessages = async (req, res) => {
    try {
        const { conversationId } = req.params;

        const context = await contextBuilderService.buildContext(parseInt(conversationId), {
            includeHistory: false,
            includeContact: false
        });

        const messagesDetail = context.messages.map((msg, index) => ({
            index: index + 1,
            id: msg.id,
            message_type: msg.message_type,
            incoming: msg.incoming,
            sender: msg.sender?.name || 'Unknown',
            sender_type: msg.sender?.type,
            content: msg.content?.substring(0, 100) + (msg.content?.length > 100 ? '...' : ''),
            private: msg.private,
            created_at: msg.created_at,
            isFromClient: msg.message_type === 0 || msg.message_type === '0' || msg.incoming === true
        }));

        const incomingCount = messagesDetail.filter(m => m.isFromClient).length;

        res.json({
            success: true,
            conversationId: parseInt(conversationId),
            totalMessages: messagesDetail.length,
            clientMessages: incomingCount,
            messages: messagesDetail
        });

    } catch (error) {
        console.error('❌ Error listando mensajes:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

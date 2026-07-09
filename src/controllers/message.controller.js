import agentOrchestratorService from '../services/agent-orchestrator.service.js';
import formSubmissionHandler from '../services/form-submission-handler.service.js';
import agentFactory from '../agents/AgentFactory.js';

/**
 * Controlador para webhooks de mensajes
 * Maneja eventos message_created para agentes en tiempo real
 */

/**
 * Webhook: message_created
 * Ejecuta agentes de pre-venta o post-venta según el canal
 */
export const messageCreated = async (req, res) => {
    try {
        const payload = req.body;

        console.log('📨 Webhook recibido: message_created');
        console.log(`   Conversación ID: ${payload.conversation?.id}`);
        console.log(`   Inbox ID: ${payload.conversation?.inbox_id}`);
        console.log(`   Tipo mensaje: ${payload.message_type}`);
        console.log(`   Incoming: ${payload.incoming}`);

        // Determinar si es mensaje del cliente
        const isIncoming = 
            payload.message_type === 0 || 
            payload.message_type === '0' || 
            payload.message_type === 'incoming' ||
            payload.incoming === true;

        const inboxId = payload.conversation?.inbox_id;

        // EXCEPCIÓN: Canal 23 (iChef Marty Wpp) - verificar si es el mensaje trigger del Nutridor
        const isChannel23 = inboxId === 23;
        
        // Si es canal 23 y mensaje saliente, verificar si contiene el trigger
        if (!isIncoming && isChannel23) {
            const messageContent = (payload.content || '').toLowerCase();
            const hasTrigger = messageContent.includes('como no ingresaste ninguna opción');
            
            if (!hasTrigger) {
                console.log('⏭️  Mensaje saliente en canal 23 sin trigger - ignorado');
                return res.status(200).json({
                    success: true,
                    message: 'Mensaje saliente sin trigger ignorado'
                });
            }
            
            console.log('📤 Mensaje trigger detectado en canal 23 - procesando...');
        }

        // Ignorar mensajes salientes (del agente humano) en otros canales
        if (!isIncoming && !isChannel23) {
            console.log('⏭️  Mensaje saliente (del agente) - ignorado');
            return res.status(200).json({
                success: true,
                message: 'Mensaje saliente ignorado'
            });
        }

        if (isIncoming) {
            console.log('✅ Mensaje del cliente - procesando...');
        }

        // PRE-PROCESADOR: Detectar formularios web en canales email
        // Si el remitente es el sistema, extraer contacto real y redirigir
        if (isIncoming) {
            const formResult = await formSubmissionHandler.handleIfFormSubmission(payload);

            if (formResult.handled && formResult.newConversationId) {
                console.log(`✅ Formulario web redirigido a conversacion #${formResult.newConversationId}`);

                // Disparar agente PreVenta en la nueva conversacion (background, no bloquea respuesta)
                setImmediate(async () => {
                    try {
                        const agent = agentFactory.getAgent('pre-venta');
                        await agent.execute(formResult.newConversationId, { includeHistory: true });
                        console.log(`✅ PreVenta ejecutado en nueva conv #${formResult.newConversationId}`);
                    } catch (error) {
                        console.error(`❌ Error PreVenta en nueva conv: ${error.message}`);
                    }
                });

                return res.status(200).json({
                    success: true,
                    message: 'Formulario web procesado - conversacion redirigida',
                    newConversationId: formResult.newConversationId
                });
            }

            if (formResult.handled) {
                console.log('⚠️ Formulario web detectado pero no se pudo procesar completamente');
            }
        }

        // Ejecutar orquestador (pipeline normal para emails directos y otros canales)
        const result = await agentOrchestratorService.processWebhookEvent(
            'message_created',
            payload
        );

        res.status(200).json({
            success: true,
            result
        });
    } catch (error) {
        console.error('❌ Error en messageCreated:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

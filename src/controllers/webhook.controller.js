import agentOrchestratorService from '../services/agent-orchestrator.service.js';
import chatwootClient from '../clients/chatwoot.client.js';

/**
 * Controller para manejar webhooks de plataformas externas
 */

/**
 * Limpia las etiquetas [Agente IA] de una conversacion
 */
async function cleanupAiLabels(conversationId) {
    try {
        const conv = await chatwootClient.getConversation(conversationId);
        const labels = conv?.labels || [];
        const nonAiLabels = labels.filter(l => !l.startsWith('[Agente IA]'));

        if (nonAiLabels.length < labels.length) {
            await chatwootClient.setLabels(conversationId, nonAiLabels);
            console.log(`🧹 ${labels.length - nonAiLabels.length} etiquetas [Agente IA] eliminadas de conv #${conversationId}`);
        }
    } catch (error) {
        console.warn(`⚠️ No se pudieron limpiar etiquetas IA de conv #${conversationId}:`, error.message);
    }
}

/**
 * Webhook para recibir eventos de Chatwoot cuando se cierra una conversación
 * 
 * POST /api/v2/webhooks/chatwoot/conversation-status-changed
 * 
 * @param {Request} req
 * @param {Response} res
 * @param {NextFunction} next
 */
export const conversationStatusChanged = async (req, res, next) => {
    try {
        const webhookData = req.body;

        console.log('🔔 Webhook recibido de Chatwoot:', {
            event: webhookData.event,
            conversationId: webhookData.id,
            status: webhookData.status
        });

        // Validar que sea un evento de conversación
        // Chatwoot puede enviar 'conversation_status_changed' o 'conversation_updated'
        const validEvents = ['conversation_status_changed', 'conversation_updated'];
        if (!webhookData.event || !validEvents.includes(webhookData.event)) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_EVENT',
                    message: `Este webhook solo procesa eventos de conversación. Evento recibido: ${webhookData.event}`
                }
            });
        }

        // Verificar que el estado sea "resolved" (cerrada)
        if (webhookData.status !== 'resolved') {
            return res.status(200).json({
                success: true,
                message: 'Evento recibido pero no procesado (estado no es resolved)',
                status: webhookData.status
            });
        }

        const conversationId = webhookData.id;

        if (!conversationId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'MISSING_CONVERSATION_ID',
                    message: 'ID de conversación no encontrado en el webhook'
                }
            });
        }

        // Responder inmediatamente a Chatwoot (202 Accepted)
        res.status(202).json({
            success: true,
            message: 'Conversación recibida para análisis',
            conversationId,
            statusUrl: `/api/v2/conversations/${conversationId}/analysis-status`
        });

        // Procesar en background (sin bloquear la respuesta)
        setImmediate(async () => {
            try {
                console.log(`🔄 Iniciando análisis en background de conversación ${conversationId}`);
                
                // Usar orchestrator para ejecutar agente de resumen
                const result = await agentOrchestratorService.executeResumenAgent(conversationId);
                
                if (result.success) {
                    console.log(`✅ Conversación ${conversationId} procesada exitosamente en background`);
                } else {
                    console.log(`⚠️  Conversación ${conversationId} procesada con advertencias:`, result.reason);
                }

                // Limpiar etiquetas [Agente IA] al resolver la conversacion
                await cleanupAiLabels(conversationId);

            } catch (error) {
                console.error(`❌ Error procesando conversación ${conversationId} en background:`, error.message);
            }
        });

    } catch (error) {
        next(error);
    }
};

/**
 * Webhook para recibir eventos de conversión de RD Station
 * 
 * POST /api/v2/webhooks/rdstation/conversion
 */
export const rdStationConversion = async (req, res, next) => {
    try {
        const webhookData = req.body;

        console.log('🔔 Webhook de RD Station recibido:', {
            leads: webhookData.leads?.length || 0
        });

        const leads = webhookData.leads;

        if (!Array.isArray(leads) || leads.length === 0) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_PAYLOAD',
                    message: 'Se esperaba un array de leads'
                }
            });
        }

        // Responder inmediatamente
        res.status(202).json({
            success: true,
            message: 'Webhook recibido, procesando leads',
            received: leads.length
        });

        // Procesar en background
        setImmediate(async () => {
            for (const lead of leads) {
                try {
                    console.log(`🔄 Procesando lead de RD Station: ${lead.email}`);
                    
                    // TODO: Implementar sincronización de lead a Chatwoot
                    // Similar a V1: rdStationControllers.js

                } catch (error) {
                    console.error(`❌ Error procesando lead ${lead.email}:`, error.message);
                }
            }
        });

    } catch (error) {
        next(error);
    }
};

/**
 * Endpoint manual para analizar una conversación específica
 * Útil para testing o re-procesar conversaciones
 * 
 * POST /api/v2/webhooks/chatwoot/analyze-conversation
 */
export const analyzeConversation = async (req, res, next) => {
    try {
        const { conversationId } = req.body;

        if (!conversationId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'MISSING_CONVERSATION_ID',
                    message: 'conversationId es requerido'
                }
            });
        }

        console.log(`🔍 Análisis manual solicitado para conversación ${conversationId}`);

        const result = await conversationAnalysisService.processClosedConversation(conversationId);

        res.status(200).json({
            success: true,
            data: result
        });

    } catch (error) {
        next(error);
    }
};

/**
 * Endpoint para procesar múltiples conversaciones en lote
 * 
 * POST /api/v2/webhooks/chatwoot/bulk-analyze
 */
export const bulkAnalyzeConversations = async (req, res, next) => {
    try {
        const { conversationIds } = req.body;

        if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_PAYLOAD',
                    message: 'Se esperaba un array de conversationIds'
                }
            });
        }

        console.log(`🔍 Análisis en lote solicitado para ${conversationIds.length} conversaciones`);

        // Responder inmediatamente
        res.status(202).json({
            success: true,
            message: 'Procesamiento iniciado en background',
            total: conversationIds.length
        });

        // Procesar en background
        setImmediate(async () => {
            try {
                const results = await conversationAnalysisService.processBulkConversations(conversationIds);
                
                console.log(`✅ Análisis en lote completado:`, {
                    total: results.total,
                    success: results.success,
                    failed: results.failed
                });

            } catch (error) {
                console.error('❌ Error en análisis en lote:', error.message);
            }
        });

    } catch (error) {
        next(error);
    }
};

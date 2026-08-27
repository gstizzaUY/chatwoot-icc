import agentOrchestratorService from '../services/agent-orchestrator.service.js';
import conversationAnalysisService from '../services/conversation-analysis.service.js';
import chatwootClient from '../clients/chatwoot.client.js';
import rdStationClient from '../clients/rdstation.client.js';
import { logResumen } from '../utils/file-logger.utils.js';
import { RD_CONVERSIONS } from '../constants/rdstation.constants.js';
import { EXCLUDED_CONTACT_IDS } from '../constants/agent.constants.js';
import { getInboxChannel } from '../constants/inbox.constants.js';
import { generateEmailFromPhone } from '../utils/email.utils.js';

/**
 * Controller para manejar webhooks de plataformas externas
 */

// Estado de deduplicación para el evento de apertura de conversación.
// Guarda el último status conocido por conversación (en memoria).
// Evita enviar `conversation-opened` repetidamente cuando `conversation_updated`
// dispara con status "open" por cualquier otra actualización (labels, assignee, etc.).
const conversationLastStatus = new Map();

/**
 * Envía el evento `conversation-opened-<canal>` a RD Station.
 * Se ejecuta en background cuando una conversación pasa a status "open".
 *
 * @param {Object} webhookData - Payload del webhook
 * @param {number} conversationId - ID de la conversación
 */
async function sendConversationOpenedEvent(webhookData, conversationId) {
    try {
        const inboxId = webhookData.inbox_id || webhookData.conversation?.inbox_id;
        const { slug, channel } = getInboxChannel(inboxId);

        const sender = webhookData.meta?.sender || {};
        const contactId = sender.id || webhookData.contact_id;

        if (contactId && EXCLUDED_CONTACT_IDS.includes(contactId)) {
            logResumen(`🚫 Contacto excluido (${contactId}) - sin evento open para conv ${conversationId}`);
            return;
        }

        let email = sender.email;
        if (!email || email === 'null') {
            email = generateEmailFromPhone(sender.phone_number);
        }
        if (!email) {
            logResumen(`⚠️ Sin email disponible para evento open de conv ${conversationId} - omitido`);
            return;
        }

        const agent = webhookData.meta?.assignee?.name || sender.name || null;
        const conversionIdentifier = `${RD_CONVERSIONS.CONVERSATION_OPENED}-${slug}`;

        await rdStationClient.sendConversionEvent(email, conversionIdentifier, {
            conversation_id: conversationId,
            inbox_id: inboxId || null,
            inbox: slug,
            channel,
            agent,
            contact_name: sender.name || null
        });

        logResumen(`📤 Evento ${conversionIdentifier} enviado a RD para conv ${conversationId}`);
    } catch (error) {
        console.error('❌ Error enviando evento conversation-opened:', error.message);
        logResumen(`❌ Error evento open conv ${conversationId}: ${error.message}`);
    }
}

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
        logResumen(`Webhook recibido: ${webhookData.event} | conv ${webhookData.id} | status ${webhookData.status}`);

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

        // Verificar que sea un evento de conversación con status válido
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

        // Actualizar estado de deduplicación para el evento de apertura
        const previousStatus = conversationLastStatus.get(conversationId) || null;
        conversationLastStatus.set(conversationId, webhookData.status);

        // Responder inmediatamente a Chatwoot (202 Accepted)
        res.status(202).json({
            success: true,
            message: 'Conversación recibida para análisis',
            conversationId,
            status: webhookData.status,
            statusUrl: `/api/v2/conversations/${conversationId}/analysis-status`
        });

        // ============ CONVERSACIÓN ABIERTA (status: open) ============
        if (webhookData.status === 'open') {
            // Deduplicación: solo enviar si venimos de un estado NO abierto
            // (captura la apertura inicial y las reaperturas, evita el spam de
            // conversation_updated mientras la conversación ya está abierta)
            if (previousStatus !== 'open') {
                logResumen(`🔓 Conv ${conversationId} abierta - enviando evento open`);
                setImmediate(() => sendConversationOpenedEvent(webhookData, conversationId));
            } else {
                logResumen(`⏭️ Evento open duplicado para conv ${conversationId} - omitido`);
            }
            return;
        }

        // Otros estados (pending, snoozed, etc.): solo se actualizó el estado de dedup
        if (webhookData.status !== 'resolved') {
            return;
        }

        // ============ CONVERSACIÓN CERRADA (status: resolved) ============
        // Procesar en background (sin bloquear la respuesta)
        setImmediate(async () => {
            try {
                logResumen(`Iniciando Resumen para conv ${conversationId} (evento: ${webhookData.event})`);
                console.log(`🔄 Iniciando análisis en background de conversación ${conversationId}`);

                // Usar orchestrator para ejecutar agente de resumen
                const result = await agentOrchestratorService.executeResumenAgent(conversationId);

                if (result.success) {
                    logResumen(`✅ Conv ${conversationId} procesada exitosamente por Resumen`);
                    console.log(`✅ Conversación ${conversationId} procesada exitosamente en background`);
                } else {
                    logResumen(`⚠️ Conv ${conversationId} procesada con advertencias: ${result.reason}`);
                    console.log(`⚠️  Conversación ${conversationId} procesada con advertencias:`, result.reason);
                }
            } catch (error) {
                logResumen(`❌ Error procesando conv ${conversationId} en background: ${error.message}`);
                console.error(`❌ Error procesando conversación ${conversationId} en background:`, error.message);
            } finally {
                // Limpiar etiquetas [Agente IA] al resolver la conversacion (siempre)
                try {
                    await cleanupAiLabels(conversationId);
                    logResumen(`🧹 Labels [Agente IA] limpiadas en conv ${conversationId}`);
                } catch (cleanupError) {
                    logResumen(`⚠️ No se pudieron limpiar labels en conv ${conversationId}: ${cleanupError.message}`);
                }
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

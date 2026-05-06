import express from 'express';
import {
    conversationStatusChanged,
    rdStationConversion,
    analyzeConversation,
    bulkAnalyzeConversations
} from '../../controllers/webhook.controller.js';
import {
    messageCreated
} from '../../controllers/message.controller.js';
import { authenticateWebhook } from '../../middleware/auth.middleware.js';
import { webhookLimiter } from '../../middleware/ratelimit.middleware.js';

const router = express.Router();

// Aplicar rate limiting a todos los webhooks
router.use(webhookLimiter);

// ==================== WEBHOOKS DE CHATWOOT ====================

/**
 * POST /api/v2/webhooks/chatwoot/conversation-status-changed
 * 
 * Webhook para recibir eventos cuando cambia el estado de una conversación
 * Se activa cuando una conversación se cierra (status: resolved)
 * 
 * Autenticación: Ninguna (protegido por rate limiting)
 * Nota: Para mayor seguridad, implementar IP whitelist a nivel de infraestructura
 */
router.post(
    '/chatwoot/conversation-status-changed',
    conversationStatusChanged
);

/**
 * POST /api/v2/webhooks/chatwoot/message-created
 * 
 * Webhook para recibir eventos cuando se crea un mensaje
 * Usado para desactivar bot cuando agente responde
 * 
 * Autenticación: Ninguna (protegido por rate limiting)
 */
router.post(
    '/chatwoot/message-created',
    messageCreated
);

/**
 * POST /api/v2/webhooks/chatwoot/analyze-conversation
 * 
 * Endpoint manual para analizar una conversación específica
 * Útil para testing o re-procesar conversaciones
 * 
 * Body: { conversationId: number }
 * 
 * Requiere autenticación por API Key (no es webhook público)
 */
router.post(
    '/chatwoot/analyze-conversation',
    // Este endpoint requiere autenticación regular, no webhook token
    analyzeConversation
);

/**
 * POST /api/v2/webhooks/chatwoot/bulk-analyze
 * 
 * Endpoint para procesar múltiples conversaciones en lote
 * 
 * Body: { conversationIds: [number, number, ...] }
 * 
 * Requiere autenticación por API Key
 */
router.post(
    '/chatwoot/bulk-analyze',
    bulkAnalyzeConversations
);

// ==================== WEBHOOKS DE RD STATION ====================

/**
 * POST /api/v2/webhooks/rdstation/conversion
 * 
 * Webhook para recibir eventos de conversión desde RD Station
 * Se activa cuando un lead realiza una acción (registro, conversión, etc.)
 * 
 * Autenticación: Ninguna (RD Station no soporta headers personalizados)
 * Protección: Rate limiting + validación de payload
 */
router.post(
    '/rdstation/conversion',
    rdStationConversion
);

export default router;

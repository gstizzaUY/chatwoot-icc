import express from 'express';
import {
    checkTrigger,
    simulateMessage,
    listMessages
} from '../../controllers/debug.controller.js';

const router = express.Router();

/**
 * GET /api/v2/debug/should-trigger/:conversationId
 * Verifica si un agente debería ejecutarse en una conversación
 */
router.get('/should-trigger/:conversationId', checkTrigger);

/**
 * POST /api/v2/debug/simulate-message/:conversationId
 * Simula un webhook de message_created para testing
 */
router.post('/simulate-message/:conversationId', simulateMessage);

/**
 * GET /api/v2/debug/messages/:conversationId
 * Lista todos los mensajes con detalles de tipo
 */
router.get('/messages/:conversationId', listMessages);

export default router;

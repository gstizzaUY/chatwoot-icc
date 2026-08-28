import express from 'express';
import processTriggerEvent from '../../controllers/triggersEventos.controller.js';
import { authenticateSharedSecret } from '../../middleware/auth.middleware.js';
import { webhookLimiter } from '../../middleware/ratelimit.middleware.js';

const router = express.Router();

// Rate limiting + header de secreto compartido (x-webhook-secret)
router.use(webhookLimiter);
router.use(authenticateSharedSecret());

/**
 * POST /api/v2/triggers/events
 *
 * Endpoint único para recibir eventos del Portal de Recetas. El tipo de
 * evento va en el body como `eventName` (ej: "login-portal",
 * "robot-encendido", o cualquier evento/campaña nuevo).
 *
 * El controlador valida y delega en el motor de triggers
 * (src/services/triggers/trigger-engine.js), que según la configuración en
 * trigger-rules.config.js decide qué combinación de eventos dispara una
 * conversación y con qué nota.
 *
 * Responde 202 inmediatamente y procesa en background para evitar reintentos.
 */
router.post('/events', processTriggerEvent);

export default router;
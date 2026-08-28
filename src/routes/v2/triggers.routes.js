import express from 'express';
import { loginPortal, robotEncendido } from '../../controllers/triggersEventos.controller.js';
import { authenticateSharedSecret } from '../../middleware/auth.middleware.js';
import { webhookLimiter } from '../../middleware/ratelimit.middleware.js';

const router = express.Router();

// Rate limiting + header de secreto compartido (x-webhook-secret)
router.use(webhookLimiter);
router.use(authenticateSharedSecret());

/**
 * POST /api/v2/triggers/eventos/login-portal
 *
 * Recibe el evento "el usuario se logueó al portal de recetas" desde el portal.
 * Body: el JSON de evento de actividad del usuario.
 *
 * El controlador valida y delega en el motor de triggers
 * (src/services/triggers/trigger-engine.js), que según la configuración en
 * trigger-rules.config.js decide qué combinación de eventos dispara una
 * conversación y con qué mensaje privado.
 *
 * Responde 202 inmediatamente y procesa en background para evitar reintentos.
 */
router.post('/eventos/login-portal', loginPortal);

/**
 * POST /api/v2/triggers/eventos/robot-encendido
 *
 * Recibe el evento "el usuario encendió el robot iChef" desde el portal.
 * Mismo procesamiento que login-portal; la nota depende de la config.
 */
router.post('/eventos/robot-encendido', robotEncendido);

export default router;
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
 * Para cada evento:
 *   1. Busca el contacto en Chatwoot por email; si no existe lo crea
 *      (también en RD Station) con tiene_ichef, id_robot y version_del_firmware.
 *   2. Reutiliza la conversación abierta en "Experiencias iChef Wpp" (id=38)
 *      o crea una nueva, asignada al agente Neiff Cardozo (id=19), team id=4.
 *   3. Crea una nota interna con el título del evento y los datos.
 *
 * Responde 202 inmediatamente y procesa en background para evitar reintentos.
 */
router.post('/eventos/login-portal', loginPortal);

/**
 * POST /api/v2/triggers/eventos/robot-encendido
 *
 * Recibe el evento "el usuario encendió el robot iChef" desde el portal.
 * Mismo procesamiento que login-portal, con nota interna distinta.
 */
router.post('/eventos/robot-encendido', robotEncendido);

export default router;
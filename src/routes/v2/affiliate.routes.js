import express from 'express';
import {
    receiveAffiliateEvent,
    getAffiliateEventStatus,
} from '../../controllers/affiliateEvents.controller.js';
import { authenticateSharedSecret } from '../../middleware/auth.middleware.js';
import { webhookLimiter } from '../../middleware/ratelimit.middleware.js';

const router = express.Router();

// Secreto compartido WordPress → hub.
const affiliateAuth = authenticateSharedSecret('x-webhook-secret', 'AFFILIATE_EVENTS_SECRET');

router.use(webhookLimiter);
router.use(affiliateAuth);

/**
 * POST /api/v2/affiliates/events
 *
 * Endpoint único para eventos del programa de afiliados.
 * Acepta el evento, lo persiste y procesa en background.
 */
router.post('/events', receiveAffiliateEvent);

/**
 * GET /api/v2/affiliates/events/:eventId
 *
 * Consulta de estado para soporte e idempotencia.
 */
router.get('/events/:eventId', getAffiliateEventStatus);

export default router;

import express from 'express';
import hsmReferidosDiaMadre from '../../controllers/hsmReferidosDiaMadre.controller.js';

const router = express.Router();

/**
 * POST /api/v2/hsm/referidos-dia-madre
 *
 * Envía por WhatsApp (Evolution API) la imagen y texto de la promo
 * "Referí y Ganá - Día de la Madre 2026" a los leads que llegan
 * desde una automatización de RD Station.
 *
 * Body esperado:
 * { "leads": [ { "id", "uuid", "email", "mobile_phone", ... }, ... ] }
 *
 * Responde con HTTP 202 inmediatamente y procesa en background
 * para evitar reintentos de RD Station.
 * Incluye dedupe por campaña+lead+número (TTL 24h).
 */
router.post('/referidos-dia-madre', hsmReferidosDiaMadre);

export default router;

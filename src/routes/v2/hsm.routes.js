import express from 'express';
import hsmReferidosDiaMadre from '../../controllers/hsmReferidosDiaMadre.controller.js';
import promoExpoBebe2026 from '../../controllers/promoExpoBebe2026.controller.js';
import ciberLunes2026 from '../../controllers/ciberLunes2026.controller.js';
import ciberlunesMelany from '../../controllers/ciberlunesMelany.controller.js';

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

/**
 * POST /api/v2/hsm/promo-expo-bebe-2026
 *
 * Envía por WhatsApp (Sailbot API) el template "promo_expo_bebe" con el
 * PDF adjunto de la promo "Expo Bebé 2026" a los leads que llegan
 * desde una automatización de RD Station.
 *
 * Body esperado:
 * { "leads": [ { "id", "uuid", "email", "mobile_phone", ... }, ... ] }
 *
 * Responde con HTTP 202 inmediatamente y procesa en background
 * para evitar reintentos de RD Station.
 * Incluye dedupe por campaña+lead+número (TTL 24h).
 */
router.post('/promo-expo-bebe-2026', promoExpoBebe2026);

/**
 * POST /api/v2/hsm/ciber-lunes-2026
 *
 * Envía por WhatsApp (Sailbot API) el template "ciber_lunes_2026" con la
 * imagen de la promo "Ciber Lunes 2026" a los leads que llegan
 * desde una automatización de RD Station.
 *
 * Body esperado:
 * { "leads": [ { "id", "uuid", "email", "mobile_phone", ... }, ... ] }
 *
 * Responde con HTTP 202 inmediatamente y procesa en background
 * para evitar reintentos de RD Station.
 * Incluye dedupe por campaña+lead+número (TTL 24h).
 */
router.post('/ciber-lunes-2026', ciberLunes2026);

/**
 * POST /api/v2/hsm/ciberlunes-melany
 *
 * Envía por WhatsApp (Sailbot API) el template "ciberlunes_melany" con la
 * imagen de la promo "Ciberlunes Melany" a los leads que llegan
 * desde una automatización de RD Station.
 *
 * Body esperado:
 * { "leads": [ { "id", "uuid", "email", "mobile_phone", ... }, ... ] }
 *
 * Responde con HTTP 202 inmediatamente y procesa en background
 * para evitar reintentos de RD Station.
 * Incluye dedupe por campaña+lead+número (TTL 24h).
 */
router.post('/ciberlunes-melany', ciberlunesMelany);

export default router;

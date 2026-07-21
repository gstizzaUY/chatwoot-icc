import express from 'express';
import hsmReferidosDiaMadre from '../../controllers/hsmReferidosDiaMadre.controller.js';
import promoExpoBebe2026 from '../../controllers/promoExpoBebe2026.controller.js';
import ciberLunes2026 from '../../controllers/ciberLunes2026.controller.js';
import ciberlunesMelany from '../../controllers/ciberlunesMelany.controller.js';
import ichefTallerBlw from '../../controllers/ichefTallerBlw.controller.js';
import actualizacionFirmware from '../../controllers/actualizacionFirmware.controller.js';
import confirmacionPedidoWeb from '../../controllers/confirmacionPedidoWeb.controller.js';

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

/**
 * POST /api/v2/hsm/ichef-taller-blw
 *
 * Envía por WhatsApp (Sailbot API) el template "ichef_taller_blw" con la
 * imagen del taller BLW a los leads que llegan
 * desde una automatización de RD Station.
 *
 * Body esperado:
 * { "leads": [ { "id", "uuid", "email", "mobile_phone", ... }, ... ] }
 *
 * Responde con HTTP 202 inmediatamente y procesa en background
 * para evitar reintentos de RD Station.
 * Incluye dedupe por campaña+lead+número (TTL 24h).
 */
router.post('/ichef-taller-blw', ichefTallerBlw);

/**
 * POST /api/v2/hsm/actualizacion-firmware
 *
 * EnvIa por WhatsApp (Sailbot API) el template
 * "actualizacion_firmware_servidor_cns" con la imagen de
 * actualizaciOn de firmware a los leads que llegan
 * desde una automatizaciOn de RD Station.
 *
 * Body esperado:
 * { "leads": [ { "id", "uuid", "email", "mobile_phone", ... }, ... ] }
 *
 * Responde con HTTP 202 inmediatamente y procesa en background.
 * Incluye dedupe por campana+lead+nUmero (TTL 24h).
 */
router.post('/actualizacion-firmware', actualizacionFirmware);

/**
 * POST /api/v2/hsm/confirmacion-pedido-web
 *
 * Recibe notificación de nuevo pedido pagado desde el plugin
 * WooCommerce WhatsApp Events y envía un WhatsApp de confirmación
 * al cliente usando la plantilla HSM de utilidad "confirmacion_pedido_web"
 * a través de Sailbot (API oficial de WhatsApp).
 *
 * Variables del template (plantilla de utilidad con nombres explícitos):
 *   order_number, name, total, product
 *
 * Body esperado (viene del plugin WordPress):
 * {
 *   "event": "order_paid",
 *   "store": { "name", "url" },
 *   "order": { "id", "number", "status", "currency", "total" },
 *   "customer": { "name", "email", "phone" },
 *   "items": [ { "product_id", "name", "quantity", "total" } ],
 *   "created_at": "..."
 * }
 *
 * Responde con HTTP 202 inmediatamente y procesa en background
 * para evitar timeouts del plugin WordPress.
 */
router.post('/confirmacion-pedido-web', confirmacionPedidoWeb);

export default router;

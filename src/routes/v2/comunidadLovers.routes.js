import express from 'express';
import solicitudAccesoComunidad from '../../controllers/comunidadLovers.controller.js';

const router = express.Router();

/**
 * POST /api/v2/comunidad-lovers/solicitud-acceso
 *
 * Recibe leads desde una automatización de RD Station.
 * Para cada lead:
 *   1. Busca o crea el contacto en Chatwoot.
 *   2. Abre una conversación en el canal "Experiencias iChef Wpp" (id=38),
 *      estado abierta, asignada al agente Neiff Cardozo (ncardozo).
 *   3. Crea una nota interna con los datos del lead y el título:
 *      "Solicitud de Acceso a la comunidad iChef Lovers desde el Portal de Recetas"
 *
 * Responde 202 inmediatamente y procesa en background para evitar reintentos.
 */
router.post('/solicitud-acceso', solicitudAccesoComunidad);

export default router;

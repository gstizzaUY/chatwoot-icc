import express from 'express';
import oportunidadAbierta from '../../controllers/oportunidad.controller.js';

const router = express.Router();

/**
 * POST /api/v2/oportunidad/abierta
 *
 * Recibe leads desde una automatización de RD Station cuando se crea una oportunidad.
 * Para cada lead:
 *   1. Busca o crea el contacto en Chatwoot.
 *   2. Abre una conversación en el canal "iChef Center Wpp" (id=34),
 *      estado abierta, asignada a Melany Fulco (id=14), team "ventas" (id=2).
 *   3. Agrega la etiqueta "oportunidad".
 *   4. Crea una nota interna: "Oportunidad Abierta en rd-station a partir de lead scoring"
 *
 * Si ya existe una conversación abierta en ese inbox, reutiliza la existente.
 *
 * Responde 202 inmediatamente y procesa en background para evitar reintentos.
 */
router.post('/abierta', oportunidadAbierta);

export default router;

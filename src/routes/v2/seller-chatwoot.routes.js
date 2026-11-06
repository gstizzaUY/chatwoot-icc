import express from 'express';

import {
    updateSellerContactController,
} from '../../controllers/seller-chatwoot.controller.js';

const router = express.Router();

/**
 * Endpoint aislado de la pestaña Contacto del Seller.
 *
 * La autenticación se hace con el contexto HMAC `ctx` y la autorización con
 * SELLER_CONTACT_ALLOWLIST + SELLER_CONTACT_SYNC_MODE.
 */
router.post('/contact', updateSellerContactController);

export default router;

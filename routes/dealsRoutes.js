import express from 'express';
import { importDeals, createDeal, updateDeal } from '../controllers/dealsControllers.js';


const router = express.Router();

router.post('/import', importDeals); // Importa Negocios (Deals) desde inConcert a Chatwoot
router.post('/create', createDeal); // Crea Nuevos Negocios (Deals) en Chatwoot
router.post('/update', updateDeal); // Actualiza Negocios (Deals) en Chatwoot

export default router;
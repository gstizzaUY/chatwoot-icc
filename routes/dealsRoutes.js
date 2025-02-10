import express from 'express';
import { importDeals, createDeal, updateDeal } from '../controllers/dealsControllers.js';


const router = express.Router();

router.post('/import', importDeals);
router.post('/create', createDeal);
router.post('/update', updateDeal);

export default router;
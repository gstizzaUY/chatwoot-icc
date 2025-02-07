import express from 'express';
import { importDeals } from '../controllers/dealsControllers.js';


const router = express.Router();

router.post('/import', importDeals);

export default router;
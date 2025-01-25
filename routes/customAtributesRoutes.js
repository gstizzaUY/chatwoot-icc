import express from 'express';
import { createBatch, listCustomAttributes } from '../controllers/customAtributesControllers.js';


const router = express.Router();

router.post('/create-batch', createBatch);
router.get('/list-custom-attributes', listCustomAttributes);

export default router;
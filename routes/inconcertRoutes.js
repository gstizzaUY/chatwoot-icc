import express from 'express';
import { chatwootWebhook } from '../controllers/inconcertControllers.js';


const router = express.Router();

router.post('/chatwoot-webhook' , chatwootWebhook);

export default router;
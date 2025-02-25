import express from 'express';
import { chatwootWebhook, chatwootWebhookConversationCreated } from '../controllers/inconcertControllers.js';


const router = express.Router();

router.post('/chatwoot-webhook' , chatwootWebhook);
router.post('/conversation-created' , chatwootWebhookConversationCreated);

export default router;
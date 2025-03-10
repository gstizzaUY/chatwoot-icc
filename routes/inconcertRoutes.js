import express from 'express';
import { chatwootWebhook, chatwootWebhookConversationCreated, chatwootCampaignCreatedSdrPrueba } from '../controllers/inconcertControllers.js';


const router = express.Router();

router.post('/chatwoot-webhook', chatwootWebhook);
router.post('/conversation-created', chatwootWebhookConversationCreated);
router.post('/campaign-created/prueba-sdr', chatwootCampaignCreatedSdrPrueba);


export default router;
import express from 'express';
import { chatwootWebhook, chatwootWebhookConversationCreated, chatwootCampaignCreatedSdrPrueba, chatwootCampaignCreatedExpoBebe2025, chatwootCampaignUltimasVentas } from '../controllers/inconcertControllers.js';


const router = express.Router();

router.post('/chatwoot-webhook', chatwootWebhook);
router.post('/conversation-created', chatwootWebhookConversationCreated);
router.post('/campaign-created/prueba-sdr', chatwootCampaignCreatedSdrPrueba);
router.post('/campaign-created/expo-bebe-2025', chatwootCampaignCreatedExpoBebe2025);
 // Endpoint for Expo Bebe 2025 campaign
router.post('/campaign-ultimas-ventas', chatwootCampaignUltimasVentas);
export default router;
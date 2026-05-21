import express from 'express';
import webhookRoutes from './webhook.routes.js';
import debugRoutes from './debug.routes.js';
import hsmRoutes from './hsm.routes.js';
import comunidadLoversRoutes from './comunidadLovers.routes.js';
import exportContactsRoutes from './exportContacts.routes.js';
// import contactRoutes from './contact.routes.js';
// import conversationRoutes from './conversation.routes.js';
// import dealRoutes from './deal.routes.js';
// import campaignRoutes from './campaign.routes.js';
// import exportRoutes from './export.routes.js';

const router = express.Router();

/**
 * Router principal para API v2
 * 
 * Estructura:
 * /api/v2/webhooks      - Webhooks de plataformas externas
 * /api/v2/contacts      - Gestión de contactos (TODO)
 * /api/v2/conversations - Gestión de conversaciones (TODO)
 * /api/v2/deals         - Gestión de oportunidades (TODO)
 * /api/v2/campaigns     - Campañas y onboarding (TODO)
 * /api/v2/export        - Exportación de datos (TODO)
 */

// Webhooks (sin autenticación de API Key, usan tokens específicos)
router.use('/webhooks', webhookRoutes);

// Debug endpoints (solo para desarrollo/testing)
router.use('/debug', debugRoutes);

// HSM - Campañas de mensajes masivos por WhatsApp (Evolution API)
router.use('/hsm', hsmRoutes);

// Comunidad iChef Lovers - Solicitudes desde el Portal de Recetas
router.use('/comunidad-lovers', comunidadLoversRoutes);

// Exportación de contactos a Excel
router.use('/export/contacts', exportContactsRoutes);

// Rutas de recursos (requieren autenticación de API Key)
// TODO: Descomentar cuando estén implementados
// router.use('/contacts', contactRoutes);
// router.use('/conversations', conversationRoutes);
// router.use('/deals', dealRoutes);
// router.use('/campaigns', campaignRoutes);
// router.use('/export', exportRoutes);

// Health check específico de v2
router.get('/health', (req, res) => {
    res.json({
        success: true,
        version: 'v2',
        status: 'healthy',
        timestamp: new Date().toISOString(),
        features: {
            webhooks: true,
            conversationAnalysis: true,
            contacts: false, // TODO
            conversations: false, // TODO
            deals: false, // TODO
            campaigns: false, // TODO
            export: false // TODO
        }
    });
});

export default router;

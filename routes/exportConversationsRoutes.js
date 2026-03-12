import express from 'express';
import {
    GetOptions,
    GetInboxes,
    GetTeams,
    GetAgents,
    ExportConversations
} from '../controllers/exportConversationsController.js';

const router = express.Router();

// --- Endpoints de descubrimiento (accountId REQUERIDO en todos) ---
// GET /api/export/options?accountId=2   → inboxes + teams + agents en una sola llamada
router.get('/options', GetOptions);

// GET /api/export/inboxes?accountId=2
router.get('/inboxes', GetInboxes);

// GET /api/export/teams?accountId=2
router.get('/teams', GetTeams);

// GET /api/export/agents?accountId=2
router.get('/agents', GetAgents);

// --- Exportación ---
// GET /api/export/conversations?accountId=2&inboxId=14&teamId=4&agentId=5
// Header requerido: x-export-token: <EXPORT_SECRET>
router.get('/conversations', ExportConversations);

export default router;

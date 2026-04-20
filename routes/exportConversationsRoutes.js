import express from 'express';
import {
    GetOptions,
    GetInboxes,
    GetTeams,
    GetAgents,
    StartExport,
    GetExportStatus,
    DownloadExport
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

// --- Exportación asíncrona (patrón polling — no bloquea la conexión) ---
// Paso 1: POST /api/export/conversations?accountId=2&inboxId=14&teamId=4
//         → responde inmediatamente con { jobId, statusUrl, downloadUrl }
router.post('/conversations', StartExport);

// Paso 2: GET /api/export/status/:jobId
//         → { status: 'processing'|'done'|'error', conversacionesProcesadas }
router.get('/status/:jobId', GetExportStatus);

// Paso 3: GET /api/export/download/:jobId
//         → descarga el .xlsx cuando status === 'done'
router.get('/download/:jobId', DownloadExport);

export default router;

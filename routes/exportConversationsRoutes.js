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
import {
    StartPipeline,
    GetPipelineStatus,
    DownloadPipelineResult,
    SetupNotebooks,
    ListDashboards,
    DownloadHistoryReport,
    ExportDashboardExcel,
} from '../controllers/notebooklmController.js';
import { getGenerationLog } from '../src/scheduler/dashboard-scheduler.js';

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

// --- Pipeline NotebookLM: exportar + subir + reporte (asíncrono) ---
// POST /api/export/notebooklm?accountId=2&inboxId=1,12,13...&dateFrom=...&dateTo=...
//         → inicia la pipeline, responde { jobId, statusUrl }
router.post('/notebooklm', StartPipeline);

// GET /api/export/notebooklm/status/:jobId
//         → { status, stage, message, progress, result }
router.get('/notebooklm/status/:jobId', GetPipelineStatus);

// GET /api/export/notebooklm/download/:jobId/xlsx        → descargar el .xlsx
// GET /api/export/notebooklm/download/:jobId/report?team=ventas  → descargar reporte .html
router.get('/notebooklm/download/:jobId/:type', DownloadPipelineResult);
// GET /api/export/notebooklm/export-dashboard/:jobId?team=ventas  → descargar dashboard .xlsx
router.get('/notebooklm/export-dashboard/:jobId', ExportDashboardExcel);

// POST /api/export/notebooklm/setup   → registrar los notebooks de equipo en el MCP server
router.post('/notebooklm/setup', SetupNotebooks);

// GET /api/export/dashboards  → listar dashboards generados (historial)
router.get('/dashboards', ListDashboards);

// GET /api/export/dashboards/download?file=reporte_ventas_2026-06-12.html
router.get('/dashboards/download', DownloadHistoryReport);

// GET /api/export/scheduler-log  → log de generación automática
router.get('/scheduler-log', (req, res) => {
    try {
        res.json(getGenerationLog());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;

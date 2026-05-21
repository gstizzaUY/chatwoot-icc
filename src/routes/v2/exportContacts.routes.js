import express from 'express';
import {
    startExportContacts,
    getExportContactsStatus,
    downloadExportContacts
} from '../../controllers/exportContacts.controller.js';

const router = express.Router();

/**
 * POST /api/v2/export/contacts
 * Inicia la exportación de todos los contactos de Chatwoot a Excel.
 * Responde 202 inmediatamente con un jobId.
 * Header opcional: x-export-token: <EXPORT_SECRET>
 *
 * GET /api/v2/export/contacts/status/:jobId
 * Consulta el progreso del job (% páginas descargadas).
 *
 * GET /api/v2/export/contacts/download/:jobId
 * Descarga el archivo .xlsx una vez que el status sea "done".
 */
router.post('/',                      startExportContacts);
router.get('/status/:jobId',          getExportContactsStatus);
router.get('/download/:jobId',        downloadExportContacts);

export default router;

import axios from 'axios';
import dotenv from 'dotenv';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHATWOOT_URL    = process.env.CHATWOOT_URL    || 'https://contact-center.5vsa59.easypanel.host';
const API_ACCESS_TOKEN = process.env.API_ACCESS_TOKEN;
const ACCOUNT_ID      = process.env.CHATWOOT_ACCOUNT_ID || '2';

// Nº de páginas que se solicitan en paralelo (cada página = 15 contactos)
// Con 1326 páginas y CONCURRENCY=10 se hacen ~133 rondas
const CONCURRENCY = 10;

// ─── Job store en memoria ────────────────────────────────────────────────────
const jobs = new Map();

// Limpiar jobs > 2 horas cada 30 minutos
setInterval(() => {
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    const now = Date.now();
    for (const [jobId, job] of jobs.entries()) {
        if (now - job.createdAt > TWO_HOURS) {
            if (job.filePath && fs.existsSync(job.filePath)) {
                fs.unlink(job.filePath, () => {});
            }
            jobs.delete(jobId);
        }
    }
}, 30 * 60 * 1000);

// ─── Cliente Chatwoot ────────────────────────────────────────────────────────
const chatwoot = axios.create({
    baseURL: `${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}`,
    headers: {
        'Content-Type': 'application/json',
        'api_access_token': API_ACCESS_TOKEN
    },
    timeout: 30000
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Obtiene una página de contactos. Devuelve { contacts, totalCount } */
async function fetchPage(page) {
    const resp = await chatwoot.get('/contacts', { params: { page } });
    return {
        contacts: resp.data.payload || [],
        totalCount: resp.data.meta?.count || 0
    };
}

/** Ejecuta un array de funciones async en lotes de `size` en paralelo */
async function batchedPromises(fns, size) {
    const results = [];
    for (let i = 0; i < fns.length; i += size) {
        const batch = fns.slice(i, i + size);
        const settled = await Promise.allSettled(batch.map(fn => fn()));
        settled.forEach(r => results.push(r.status === 'fulfilled' ? r.value : null));
    }
    return results;
}

/** Formatea un timestamp Unix o ISO a string legible */
function formatDate(value) {
    if (!value) return '';
    const d = new Date(typeof value === 'number' ? value * 1000 : value);
    return isNaN(d) ? String(value) : d.toISOString().replace('T', ' ').slice(0, 19);
}

/** Convierte un objeto de custom_attributes en un map plano de strings */
function flattenCustomAttributes(attrs) {
    if (!attrs || typeof attrs !== 'object') return {};
    const result = {};
    for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined) result[k] = '';
        else if (typeof v === 'object') result[k] = JSON.stringify(v);
        else result[k] = String(v);
    }
    return result;
}

// ─── Job principal ───────────────────────────────────────────────────────────

async function runExportJob(jobId) {
    const job = jobs.get(jobId);
    if (!job) return;

    try {
        // ── Paso 1: obtener primera página para conocer el total ──────────────
        const first = await fetchPage(1);
        const total = first.totalCount;
        const totalPages = Math.ceil(total / 15);

        job.total = total;
        job.totalPages = totalPages;
        job.pagesDone = 1;

        console.log(`[export-contacts][${jobId}] Total: ${total} contactos, ${totalPages} páginas`);

        let allContacts = [...first.contacts];

        // ── Paso 2: descargar el resto en paralelo (lotes de CONCURRENCY) ─────
        if (totalPages > 1) {
            const pageFns = [];
            for (let p = 2; p <= totalPages; p++) {
                const page = p;
                pageFns.push(async () => {
                    const result = await fetchPage(page);
                    job.pagesDone = (job.pagesDone || 1) + 1;
                    return result.contacts;
                });
            }

            const batches = await batchedPromises(pageFns, CONCURRENCY);
            for (const batch of batches) {
                if (batch) allContacts = allContacts.concat(batch);
            }
        }

        console.log(`[export-contacts][${jobId}] Descargados ${allContacts.length} contactos. Generando Excel...`);

        // ── Paso 3: recolectar todas las claves de custom_attributes ──────────
        const customKeys = new Set();
        for (const c of allContacts) {
            const flat = flattenCustomAttributes(c.custom_attributes);
            Object.keys(flat).forEach(k => customKeys.add(k));
        }
        const sortedCustomKeys = [...customKeys].sort();

        // ── Paso 4: generar Excel ─────────────────────────────────────────────
        const workbook  = new ExcelJS.Workbook();
        const sheet     = workbook.addWorksheet('Contactos');

        const fixedCols = [
            { header: 'ID',               key: 'id',            width: 10 },
            { header: 'Nombre',           key: 'name',          width: 30 },
            { header: 'Email',            key: 'email',         width: 35 },
            { header: 'Teléfono',         key: 'phone_number',  width: 18 },
            { header: 'Identifier',       key: 'identifier',    width: 20 },
            { header: 'Ciudad',           key: 'city',          width: 20 },
            { header: 'País',             key: 'country',       width: 15 },
            { header: 'Inboxes',          key: 'inboxes',       width: 35 },
            { header: 'Creado el',        key: 'created_at',    width: 20 },
            { header: 'Última actividad', key: 'last_activity', width: 20 },
        ];

        const customCols = sortedCustomKeys.map(k => ({
            header: `cf_${k}`,
            key:    `cf_${k}`,
            width:  22
        }));

        sheet.columns = [...fixedCols, ...customCols];

        // Cabecera en negrita
        sheet.getRow(1).font = { bold: true };

        for (const c of allContacts) {
            const addAttr = c.additional_attributes || {};
            const flat    = flattenCustomAttributes(c.custom_attributes);

            const inboxNames = (c.contact_inboxes || [])
                .map(ci => ci.inbox?.name || '')
                .filter(Boolean)
                .join(', ');

            const row = {
                id:            c.id,
                name:          c.name          || '',
                email:         c.email         || '',
                phone_number:  c.phone_number  || '',
                identifier:    c.identifier    || '',
                city:          addAttr.city    || '',
                country:       addAttr.country || '',
                inboxes:       inboxNames,
                created_at:    formatDate(c.created_at),
                last_activity: formatDate(c.last_activity_at),
            };

            for (const k of sortedCustomKeys) {
                row[`cf_${k}`] = flat[k] ?? '';
            }

            sheet.addRow(row);
        }

        // ── Paso 5: guardar archivo ───────────────────────────────────────────
        const exportsDir = path.join(__dirname, '..', '..', 'exports');
        if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fileName  = `contactos_chatwoot_${timestamp}.xlsx`;
        const filePath  = path.join(exportsDir, fileName);

        await workbook.xlsx.writeFile(filePath);

        job.status   = 'done';
        job.filePath = filePath;
        job.fileName = fileName;
        job.processed = allContacts.length;

        console.log(`[export-contacts][${jobId}] ✓ Archivo generado: ${fileName} (${allContacts.length} contactos)`);

    } catch (err) {
        console.error(`[export-contacts][${jobId}] ✗ Error:`, err.message);
        job.status = 'error';
        job.error  = err.message;
    }
}

// ─── Handlers HTTP ────────────────────────────────────────────────────────────

function requireToken(req, res) {
    const secret = process.env.EXPORT_SECRET;
    if (secret && req.headers['x-export-token'] !== secret) {
        res.status(401).json({ error: 'Token de exportación inválido o ausente.' });
        return false;
    }
    return true;
}

/**
 * POST /api/v2/export/contacts
 *
 * Inicia la exportación en background.
 * Responde 202 con jobId para consultar el estado.
 *
 * Headers opcionales:
 *   x-export-token: <EXPORT_SECRET>
 */
export const startExportContacts = (req, res) => {
    if (!requireToken(req, res)) return;

    const jobId = crypto.randomUUID();
    jobs.set(jobId, {
        status:     'processing',
        pagesDone:  0,
        totalPages: null,
        total:      null,
        processed:  null,
        filePath:   null,
        fileName:   null,
        error:      null,
        createdAt:  Date.now()
    });

    res.status(202).json({
        jobId,
        status:      'processing',
        statusUrl:   `/api/v2/export/contacts/status/${jobId}`,
        downloadUrl: `/api/v2/export/contacts/download/${jobId}`
    });

    // Ejecutar en background
    setImmediate(() => runExportJob(jobId));
};

/**
 * GET /api/v2/export/contacts/status/:jobId
 */
export const getExportContactsStatus = (req, res) => {
    if (!requireToken(req, res)) return;

    const job = jobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job no encontrado.' });

    const progress = job.totalPages
        ? Math.round((job.pagesDone / job.totalPages) * 100)
        : 0;

    res.json({
        jobId:      req.params.jobId,
        status:     job.status,
        progress:   `${progress}%`,
        pagesDone:  job.pagesDone,
        totalPages: job.totalPages,
        total:      job.total,
        processed:  job.processed,
        error:      job.error || undefined
    });
};

/**
 * GET /api/v2/export/contacts/download/:jobId
 */
export const downloadExportContacts = (req, res) => {
    if (!requireToken(req, res)) return;

    const job = jobs.get(req.params.jobId);
    if (!job)                 return res.status(404).json({ error: 'Job no encontrado.' });
    if (job.status === 'processing') return res.status(202).json({ status: 'processing', message: 'El archivo todavía se está generando.' });
    if (job.status === 'error')      return res.status(500).json({ status: 'error', error: job.error });
    if (!fs.existsSync(job.filePath))return res.status(404).json({ error: 'Archivo no encontrado en el servidor.' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${job.fileName}"`);
    fs.createReadStream(job.filePath).pipe(res);
};

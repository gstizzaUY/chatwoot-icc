import cron from 'node-cron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline } from '../../controllers/notebooklmController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXPORTS_DIR = path.resolve(__dirname, '..', '..', 'exports');
const LOG_FILE = path.join(EXPORTS_DIR, 'generation-log.json');

const TEAMS = [
    { key: 'ventas',    label: 'Ventas iChef',     inboxes: [1, 12, 13, 14, 15, 23, 33, 34, 46, 48] },
    { key: 'preventa',  label: 'Pre-Ventas iChef', inboxes: [20] },
    { key: 'postventa', label: 'Post-Venta iChef', inboxes: [13, 14, 15, 38, 41] },
    { key: 'portal',    label: 'Portal iChef',     inboxes: [13, 14, 15] },
    { key: 'todos',     label: 'Todos los Canales', inboxes: [1, 12, 13, 14, 15, 20, 23, 33, 34, 38, 41, 46, 48] },
];

function loadLog() {
    try {
        if (fs.existsSync(LOG_FILE)) {
            return JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
        }
    } catch { /* ignore */ }
    return [];
}

export function getGenerationLog() {
    return loadLog();
}

function saveLog(entries) {
    if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR, { recursive: true });
    fs.writeFileSync(LOG_FILE, JSON.stringify(entries, null, 2), 'utf-8');
}

function lastWeekRange() {
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    return {
        dateFrom: weekAgo.toISOString().slice(0, 10),
        dateTo: now.toISOString().slice(0, 10),
    };
}

async function generateAllDashboards() {
    const { dateFrom, dateTo } = lastWeekRange();
    const log = loadLog();
    const accountId = parseInt(process.env.CHATWOOT_ACCOUNT_ID || '2');

    console.log(`[Scheduler] ${new Date().toISOString()} — Iniciando generación automática (${TEAMS.length} equipos)`);
    console.log(`[Scheduler] Rango: ${dateFrom} → ${dateTo}`);

    for (const team of TEAMS) {
        const jobId = crypto.randomUUID();
        const entry = {
            team: team.key,
            label: team.label,
            startedAt: new Date().toISOString(),
            completedAt: null,
            status: 'processing',
            jobId,
            dateFrom,
            dateTo,
        };
        log.push(entry);
        saveLog(log);

        console.log(`[Scheduler]   → ${team.label}...`);

        try {
            const result = await runPipeline(
                jobId,
                team.inboxes,
                [],
                [],
                dateFrom,
                dateTo,
                team.key,
                (update) => { /* silent progress */ }
            );

            entry.completedAt = new Date().toISOString();
            entry.status = 'success';
            entry.reports = result.reports?.map(r => ({ team: r.team, label: r.label, fileName: r.fileName })) || [];
            saveLog(log);
            console.log(`[Scheduler]   ✅ ${team.label} — ${result.reports?.length || 0} reporte(s)`);
        } catch (err) {
            entry.completedAt = new Date().toISOString();
            entry.status = 'error';
            entry.error = err.message;
            saveLog(log);
            console.error(`[Scheduler]   ❌ ${team.label} — ${err.message}`);
        }
    }

    console.log(`[Scheduler] ${new Date().toISOString()} — Finalizado. Total: ${log.length} ejecuciones registradas.`);
}

export function startDashboardScheduler() {
    // Lunes a las 8:00 AM hora Uruguay (UTC-3)
    // cron: minuto(0) hora(8) día-de-semana(1=lunes)
    cron.schedule('0 8 * * 1', () => {
        generateAllDashboards();
    }, { timezone: 'America/Montevideo' });

    console.log('[Scheduler] Dashboard automático programado: todos los lunes a las 08:00 (UY)');
    console.log(`[Scheduler] Log: ${LOG_FILE}`);
}

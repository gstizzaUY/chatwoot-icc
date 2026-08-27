/**
 * Sincroniza los dashboards generados en producción hacia el repo local y los commitea.
 *
 * Uso:
 *   node scripts/sync-dashboards.mjs            # descarga + commit (con chequeo de completitud)
 *   node scripts/sync-dashboards.mjs --force    # ignora el chequeo (preservación inicial / manual)
 *   node scripts/sync-dashboards.mjs --push     # además hace git push
 *
 * Variables de entorno: EXPORT_SECRET (obligatorio), BACKEND_URL (opcional).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const EXPORTS_DIR = path.join(REPO_ROOT, 'exports');

// Carga .env manualmente (sin depender de dotenv, que no existe en CI)
function loadEnv() {
    try {
        const content = fs.readFileSync(path.join(REPO_ROOT, '.env'), 'utf-8');
        for (const raw of content.split('\n')) {
            // trim() elimina \r (archivos CRLF en Windows) y espacios
            const line = raw.trim();
            if (!line || line.startsWith('#')) continue;
            const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
            if (m && !(m[1] in process.env)) {
                process.env[m[1]] = m[2].trim();
            }
        }
    } catch { /* sin .env (CI) */ }
}
loadEnv();

// Variable dedicada para la URL de producción (el .env local tiene BACKEND_URL=http://localhost:4002,
// que NO debe usarse aquí: este script siempre sincroniza DESDE producción).
const BACKEND_URL = process.env.DASHBOARDS_BACKEND_URL || 'https://inchat-chatwoot-icc.5vsa59.easypanel.host';
const SECRET = process.env.EXPORT_SECRET;

const FORCE = process.argv.includes('--force');
const PUSH = process.argv.includes('--push');

// Equipos que producen reportes. La semana está completa solo si existen TODOS
// para la fecha de hoy (el scheduler genera lunes 08:00 UY y tarda ~10-15 min).
const REPORT_TEAMS = ['ventas', 'portal', 'todos', 'satisfacción_del_cliente'];

function log(msg) {
    console.log(`[sync-dashboards] ${new Date().toISOString()} — ${msg}`);
}

function dateToday() {
    return new Date().toISOString().slice(0, 10);
}

async function apiGet(url) {
    const resp = await fetch(url, {
        headers: { 'x-export-token': SECRET },
        signal: AbortSignal.timeout(60000)
    });
    if (resp.status === 401) {
        throw new Error(`401 — verificar EXPORT_SECRET (${url})`);
    }
    if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} en ${url}`);
    }
    return resp;
}

/**
 * Chequea que la generación de la semana actual esté completa:
 * deben existir los reportes de todos los equipos con la fecha de hoy.
 * Si la generación sigue en curso o falló, se omite el commit (la próxima corrida lo corrige).
 */
async function isCurrentWeekComplete() {
    const today = dateToday();
    const resp = await apiGet(`${BACKEND_URL}/api/export/dashboards`);
    const dashboards = await resp.json();

    const filesToday = new Set();
    for (const entry of dashboards) {
        if (entry.date !== today) continue;
        for (const f of entry.files || []) {
            filesToday.add(f.file);
        }
    }

    const missing = REPORT_TEAMS.filter(team => {
        const expected = `reporte_${team.replace(/\s+/g, '_')}_${today}.html`;
        return !filesToday.has(expected);
    });

    if (missing.length > 0) {
        log(`Generación de hoy (${today}) incompleta - faltan: ${missing.join(', ')}. Se omite el commit.`);
        return false;
    }
    log(`Generación de hoy (${today}) completa (${REPORT_TEAMS.length} reportes).`);
    return true;
}

async function downloadAllReports() {
    const resp = await apiGet(`${BACKEND_URL}/api/export/dashboards`);
    const dashboards = await resp.json();

    const allFiles = [];
    for (const entry of dashboards) {
        for (const f of entry.files || []) {
            if (!allFiles.includes(f.file)) allFiles.push(f.file);
        }
    }

    if (!fs.existsSync(EXPORTS_DIR)) {
        fs.mkdirSync(EXPORTS_DIR, { recursive: true });
    }

    let downloaded = 0;
    for (const file of allFiles) {
        const target = path.join(EXPORTS_DIR, path.basename(file));
        const fileResp = await apiGet(`${BACKEND_URL}/api/export/dashboards/download?file=${encodeURIComponent(file)}`);
        const content = await fileResp.text();
        fs.writeFileSync(target, content, 'utf-8');
        downloaded++;
        log(`⬇️  ${file} (${content.length} bytes)`);
    }

    const logResp = await apiGet(`${BACKEND_URL}/api/export/scheduler-log`);
    const logContent = await logResp.text();
    fs.writeFileSync(path.join(EXPORTS_DIR, 'generation-log.json'), logContent, 'utf-8');

    log(`Descargados ${downloaded} reportes + generation-log.json`);
}

function gitCommitIfChanged() {
    execSync('git add exports/reporte_*.html exports/generation-log.json', { cwd: REPO_ROOT, stdio: 'inherit' });

    const diff = execSync('git diff --cached --name-only', { cwd: REPO_ROOT, encoding: 'utf-8' }).trim();
    if (!diff) {
        log('Sin cambios nuevos - no hay commit.');
        return false;
    }

    const msg = `chore: dashboards sincronizados ${dateToday()}`;
    execSync(`git commit -m "${msg}"`, { cwd: REPO_ROOT, stdio: 'inherit' });
    log(`Commit creado: ${msg}`);
    return true;
}

async function main() {
    if (!SECRET) {
        throw new Error('EXPORT_SECRET no configurado en .env');
    }

    log(`Backend: ${BACKEND_URL}`);

    if (!FORCE && !(await isCurrentWeekComplete())) {
        log('Ejecución omitida (generación en curso o incompleta).');
        return;
    }

    await downloadAllReports();

    if (gitCommitIfChanged() && PUSH) {
        execSync('git push', { cwd: REPO_ROOT, stdio: 'inherit' });
        log('Push realizado.');
    }
}

main().catch(err => {
    console.error('[sync-dashboards] ❌ Error:', err.message);
    process.exit(1);
});
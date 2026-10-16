import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const RESUMEN_LOG = path.join(LOG_DIR, 'resumen.log');
const PORTAL_LOG = path.join(LOG_DIR, 'portal.log');

/**
 * Escribe una línea en logs/resumen.log para trazabilidad del flujo de cierre.
 * El logging en consola puede perderse si el proceso no captura stdout;
 * este archivo garantiza persistencia local.
 *
 * @param {string} message - Mensaje a registrar
 */
export function logResumen(message) {
    try {
        if (!fs.existsSync(LOG_DIR)) {
            fs.mkdirSync(LOG_DIR, { recursive: true });
        }
        const line = `[${new Date().toISOString()}] ${message}\n`;
        fs.appendFileSync(RESUMEN_LOG, line);
    } catch (err) {
        console.error('No se pudo escribir log de resumen:', err.message);
    }
}

/**
 * Escribe una línea en logs/portal.log para trazabilidad del registro del
 * Portal de Recetas (contacto en Chatwoot + alta de Afiliado Lover).
 * Se usa para fallos que requieren acción manual (ej. existing_user_email).
 *
 * @param {string} message - Mensaje a registrar
 */
export function logPortal(message) {
    try {
        if (!fs.existsSync(LOG_DIR)) {
            fs.mkdirSync(LOG_DIR, { recursive: true });
        }
        const line = `[${new Date().toISOString()}] ${message}\n`;
        fs.appendFileSync(PORTAL_LOG, line);
    } catch (err) {
        console.error('No se pudo escribir log del portal:', err.message);
    }
}

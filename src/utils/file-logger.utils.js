import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const RESUMEN_LOG = path.join(LOG_DIR, 'resumen.log');

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

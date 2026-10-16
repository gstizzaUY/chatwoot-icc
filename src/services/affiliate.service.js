import axios from 'axios';
import dotenv from 'dotenv';
import { isFakeEmail, isValidEmail } from '../utils/email.utils.js';
import { logPortal } from '../utils/file-logger.utils.js';

dotenv.config();

/**
 * Servicio: alta de Afiliado Lover en WordPress (AffiliateWP).
 *
 * Se invoca desde `RegisterContact` (controllers/registerContactController.js)
 * cuando el portal envía un registro nuevo. El alta es idempotente:
 *   1. Busca al afiliado por email (GET /affwp/v1/affiliates?search=)
 *   2. Si no existe, lo crea (POST /affwp/v1/affiliates, grupo 1 = Lovers)
 *
 * Documentación: docs/CONECTOR-PORTAL-AFILIADOS.md
 * Nunca lanza: devuelve un resultado estructurado.
 */

const WP_API_URL = (process.env.WP_API_URL || 'https://ichef.com.uy/wp-json').replace(/\/+$/, '');
const WP_AFFILIATE_PUBLIC_KEY = process.env.WP_AFFILIATE_PUBLIC_KEY;
const WP_AFFILIATE_TOKEN = process.env.WP_AFFILIATE_TOKEN;
const WP_AFFILIATE_GROUP_ID = parseInt(process.env.WP_AFFILIATE_GROUP_ID || '1', 10);
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RETRIES = 1; // reintentos ante 5xx o error de red (timeout incluido)

const isConfigured = () => Boolean(WP_API_URL && WP_AFFILIATE_PUBLIC_KEY && WP_AFFILIATE_TOKEN);

const wpClient = axios.create({
    baseURL: WP_API_URL,
    auth: { username: WP_AFFILIATE_PUBLIC_KEY, password: WP_AFFILIATE_TOKEN },
    timeout: REQUEST_TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
});

/** Reintenta la llamada ante 5xx o error de red (timeout incluido). */
const withRetry = async (fn, retries = MAX_RETRIES) => {
    try {
        return await fn();
    } catch (err) {
        const status = err.response?.status;
        const isRetriable = !status || status >= 500;
        if (isRetriable && retries > 0) {
            console.warn(`[affiliate] Reintentando tras error ${status || err.code || err.message}...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            return withRetry(fn, retries - 1);
        }
        throw err;
    }
};

/**
 * Limpia el username para el link de afiliado: sin acentos, minúsculas,
 * solo [a-z0-9._-], separadores colapsados, máx 50 caracteres.
 */
const sanitizeUsername = (raw) => {
    if (!raw || typeof raw !== 'string') return null;
    const clean = raw
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar acentos
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^[-_.]+|[-_.]+$/g, '')
        .slice(0, 50);
    return clean || null;
};

const usernameFromEmail = (email) => {
    if (!email || !email.includes('@')) return null;
    return sanitizeUsername(email.split('@')[0]);
};

/**
 * Busca un afiliado existente por email (idempotencia).
 * Devuelve el afiliado o null. Lanza si el chequeo falla (para NO crear duplicados).
 */
const findAffiliateByEmail = async (email) => {
    try {
        const resp = await withRetry(() =>
            wpClient.get('/affwp/v1/affiliates', { params: { search: email } })
        );
        const data = resp.data;
        const list = Array.isArray(data)
            ? data
            : (Array.isArray(data?.affiliates) ? data.affiliates : null);

        if (!list) {
            throw new Error(`Respuesta inesperada del listado de afiliados: ${JSON.stringify(data).slice(0, 200)}`);
        }

        return list.find(a => String(a.payment_email || a.email || '').toLowerCase() === email.toLowerCase()) || null;
    } catch (err) {
        if (err.response?.status === 404) return null; // no_affiliates → no es afiliado todavía
        throw err;
    }
};

/** Alta del afiliado Lover (grupo configurable, default 1 = Lovers). */
const createAffiliate = async (email, username) => {
    const resp = await withRetry(() =>
        wpClient.post('/affwp/v1/affiliates', {
            create_user: '1',
            username,
            payment_email: email,
            status: 'active',
            group_id: WP_AFFILIATE_GROUP_ID
        })
    );
    return resp.data;
};

/**
 * Da de alta al usuario del portal como Afiliado Lover (idempotente).
 *
 * @param {Object} params
 * @param {string} params.email - Email del registro (debe ser real, no ficticio)
 * @param {string} [params.username] - Username del portal (se sanitiza; fallback al email)
 * @returns {Promise<{ok: boolean, created: boolean, affiliateId?: number|null, username?: string|null, referralUrl?: string|null, reason?: string, error?: string}>}
 */
export const registerLoverAffiliate = async ({ email, username }) => {
    // Flag de control (permite apagar el alta sin borrar credenciales)
    if (process.env.AFFILIATE_REGISTRATION_ENABLED === 'false') {
        console.log('[affiliate] Alta deshabilitada (AFFILIATE_REGISTRATION_ENABLED=false)');
        return { ok: false, created: false, reason: 'disabled' };
    }
    if (!isConfigured()) {
        console.warn('[affiliate] Credenciales de WordPress no configuradas - alta omitida');
        return { ok: false, created: false, reason: 'not_configured' };
    }
    if (!email || !isValidEmail(email) || isFakeEmail(email)) {
        console.log(`[affiliate] Email ausente, inválido o ficticio (${email || 'vacío'}) - alta omitida`);
        return { ok: false, created: false, reason: 'invalid_email' };
    }

    try {
        // 1. Idempotencia: ¿ya es afiliado?
        const existing = await findAffiliateByEmail(email);
        if (existing) {
            const affiliateId = existing.affiliate_id || existing.id || null;
            const existingUsername = existing.username || null;
            console.log(`[affiliate] ${email} ya es afiliado (ID ${affiliateId}, usuario ${existingUsername})`);
            return {
                ok: true,
                created: false,
                affiliateId,
                username: existingUsername,
                referralUrl: existing.referral_url || null,
                reason: 'existing'
            };
        }

        // 2. Alta con reintento de username ante colisión (existing_user_login)
        const baseUsername = sanitizeUsername(username) || usernameFromEmail(email) || 'lover';
        let lastError = null;

        for (let attempt = 0; attempt <= 3; attempt++) {
            const candidate = attempt === 0 ? baseUsername : `${baseUsername}-${attempt + 1}`;
            try {
                const created = await createAffiliate(email, candidate);
                const affiliateId = created.affiliate_id || created.id || null;
                const finalUsername = created.username || candidate;
                console.log(`[affiliate] ✓ Afiliado Lover creado: ${email} (ID ${affiliateId}, usuario ${finalUsername})`);
                return {
                    ok: true,
                    created: true,
                    affiliateId,
                    username: finalUsername,
                    referralUrl: created.referral_url || null
                };
            } catch (err) {
                const code = err.response?.data?.code;
                if (code === 'existing_user_login' && attempt < 3) {
                    console.log(`[affiliate] Username "${candidate}" ocupado, reintentando con sufijo...`);
                    continue;
                }
                lastError = err;
                break;
            }
        }

        // 3. Error no recuperable
        const code = lastError?.response?.data?.code;
        const message = lastError?.response?.data?.message || lastError?.message;
        console.error(`[affiliate] ✗ Alta fallida (${email}): ${code || lastError?.response?.status || ''} ${message || ''}`);

        if (code === 'existing_user_email') {
            // Usuario de WordPress existente que no es afiliado → resolución manual (Alta simplificada)
            logPortal(`[affiliate] existing_user_email: ${email} requiere alta manual en WordPress (Alta simplificada)`);
            return { ok: false, created: false, reason: 'existing_user_email', error: message };
        }

        logPortal(`[affiliate] Alta fallida: ${email} - ${code || lastError?.response?.status || 'error'}: ${message}`);
        return { ok: false, created: false, reason: code || 'error', error: message };
    } catch (err) {
        // Fallo del chequeo de idempotencia u otro: NO se crea (evitar duplicados)
        const status = err.response?.status;
        const code = err.response?.data?.code;
        console.error(`[affiliate] ✗ Error general (${email}): ${status || ''} ${code || ''} ${err.message}`);
        logPortal(`[affiliate] Error general: ${email} - ${status || ''} ${code || ''} ${err.message}`);
        return { ok: false, created: false, reason: 'check_failed', error: err.message };
    }
};

export default { registerLoverAffiliate };

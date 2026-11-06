import {
    getSellerChatwootAccountConfig,
    getSellerChatwootConfig,
} from './seller-chatwoot.service.js';
import {
    getSellerContactFlags,
    isAccountAllowed,
} from './seller-contact-flags.service.js';

/**
 * Fase 1 — Registro de Sellers conectados.
 *
 * La fuente de verdad es el entorno:
 *
 *   CHATWOOT_SELLER_<AFFILIATE_ID>_URL
 *   CHATWOOT_SELLER_<AFFILIATE_ID>_ACCOUNT_ID
 *   CHATWOOT_SELLER_<AFFILIATE_ID>_TOKEN
 *
 * El registro NUNCA enumera cuentas de Chatwoot. Solo conoce los affiliate_id
 * declarados en el entorno. La allowlist se aplica en las funciones
 * `getAllowed...` / `assert...` para que una cuenta configurada no quede
 * habilitada por accidente.
 */

const SELLER_ENV_PATTERN = /^CHATWOOT_SELLER_(\d+)_/;
const REQUIRED_CONFIG_KEYS = Object.freeze(['URL', 'ACCOUNT_ID', 'TOKEN']);

export class SellerChatwootRegistryError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'SellerChatwootRegistryError';
        this.code = code;
        this.details = details;
        this.status = code === 'SELLER_ACCOUNT_NOT_ALLOWED'
            ? 403
            : code === 'SELLER_ACCOUNT_NOT_CONFIGURED'
                ? 404
                : 409;
    }
}

function asString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
}

function asNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

/**
 * Lista los affiliate_id que tienen al menos una variable CHATWOOT_SELLER_<id>_*.
 * Ignora variables como CHATWOOT_SELLER_OPPORTUNITIES_INBOX_ID.
 */
export function listConfiguredAffiliateIds() {
    const ids = new Set();

    for (const key of Object.keys(process.env)) {
        const match = SELLER_ENV_PATTERN.exec(key);
        if (match) {
            ids.add(Number(match[1]));
        }
    }

    return [...ids].filter((id) => Number.isInteger(id) && id > 0)
        .sort((a, b) => a - b);
}

function missingKeysForAffiliate(affiliateId) {
    const prefix = `CHATWOOT_SELLER_${affiliateId}_`;
    return REQUIRED_CONFIG_KEYS.filter((key) => !asString(process.env[`${prefix}${key}`]));
}

/**
 * Inspección segura para baseline/diagnostics. No devuelve tokens.
 */
export function inspectConfiguredSellers() {
    return listConfiguredAffiliateIds().map((affiliateId) => {
        const config = getSellerChatwootAccountConfig(affiliateId);
        const missing = missingKeysForAffiliate(affiliateId);

        return {
            affiliateId,
            configured: Boolean(config) && missing.length === 0,
            missing,
            config: config ? redactSellerConfig(config) : null,
        };
    });
}

/**
 * Sellers configurados en el entorno. Por defecto no exige INBOX_ID.
 * `requireInbox: true` mantiene el comportamiento histórico de conversaciones.
 */
export function listConfiguredSellers({ requireInbox = false } = {}) {
    return listConfiguredAffiliateIds()
        .map((affiliateId) => (
            requireInbox
                ? getSellerChatwootConfig(affiliateId)
                : getSellerChatwootAccountConfig(affiliateId)
        ))
        .filter(Boolean);
}

/**
 * Sellers configurados Y habilitados explícitamente en la allowlist.
 */
export function listAllowedSellers({ requireInbox = false } = {}) {
    const flags = getSellerContactFlags();
    return listConfiguredSellers({ requireInbox })
        .filter((config) => isAccountAllowed(config.accountId, flags));
}

/**
 * Busca por ACCOUNT_ID. Si hay dos affiliate_id apuntando a la misma cuenta,
 * falla para evitar actualizar la cuenta equivocada.
 */
export function getSellerByAccountId(accountId, { onlyAllowed = true } = {}) {
    const id = asNumber(accountId);
    if (!id) {
        return null;
    }

    const matches = listConfiguredSellers().filter(
        (config) => Number(config.accountId) === id,
    );

    if (matches.length > 1) {
        throw new SellerChatwootRegistryError(
            'DUPLICATE_SELLER_ACCOUNT',
            `Hay más de un Seller configurado para la cuenta ${id}`,
            { accountId: id, affiliateIds: matches.map((config) => config.affiliateId) },
        );
    }

    const config = matches[0] || null;
    if (!config || !onlyAllowed) {
        return config;
    }

    const flags = getSellerContactFlags();
    return isAccountAllowed(id, flags) ? config : null;
}

export function getSellerByAffiliateId(affiliateId, { onlyAllowed = true } = {}) {
    const config = getSellerChatwootAccountConfig(affiliateId);
    if (!config || !onlyAllowed) {
        return config;
    }

    const flags = getSellerContactFlags();
    return isAccountAllowed(config.accountId, flags) ? config : null;
}

/**
 * Valida que la cuenta exista, esté configurada y esté en la allowlist.
 * Devuelve la configuración completa (uso interno; no loguear).
 */
export function assertSellerAccountAllowed({ accountId, affiliateId = null } = {}) {
    const config = getSellerByAccountId(accountId, { onlyAllowed: false });

    if (!config) {
        throw new SellerChatwootRegistryError(
            'SELLER_ACCOUNT_NOT_CONFIGURED',
            `La cuenta de Chatwoot ${accountId || '(vacía)'} no está configurada como Seller`,
            { accountId },
        );
    }

    if (affiliateId !== null && affiliateId !== undefined && affiliateId !== '') {
        if (Number(affiliateId) !== Number(config.affiliateId)) {
            throw new SellerChatwootRegistryError(
                'SELLER_AFFILIATE_MISMATCH',
                `La cuenta ${accountId} no corresponde al Seller ${affiliateId}`,
                { accountId, affiliateId, configuredAffiliateId: config.affiliateId },
            );
        }
    }

    const flags = getSellerContactFlags();
    if (!isAccountAllowed(config.accountId, flags)) {
        throw new SellerChatwootRegistryError(
            'SELLER_ACCOUNT_NOT_ALLOWED',
            `La cuenta de Chatwoot ${accountId} no está en SELLER_CONTACT_ALLOWLIST`,
            { accountId },
        );
    }

    return config;
}

/**
 * Configuración apta para logs. No incluye token ni adminToken.
 */
export function redactSellerConfig(config) {
    if (!config) {
        return null;
    }

    return {
        affiliateId: config.affiliateId,
        accountId: config.accountId,
        url: config.url,
        inboxId: config.inboxId,
        teamId: config.teamId,
        assigneeId: config.assigneeId,
        hasToken: Boolean(config.token),
        hasAdminToken: Boolean(config.adminToken),
        seller: {
            name: config.seller?.name || '',
            username: config.seller?.username || '',
            email: config.seller?.email || '',
            phone: config.seller?.phone || '',
            status: config.seller?.status || '',
            referralUrl: config.seller?.referralUrl || '',
        },
    };
}

export default {
    SellerChatwootRegistryError,
    listConfiguredAffiliateIds,
    inspectConfiguredSellers,
    listConfiguredSellers,
    listAllowedSellers,
    getSellerByAccountId,
    getSellerByAffiliateId,
    assertSellerAccountAllowed,
    redactSellerConfig,
};

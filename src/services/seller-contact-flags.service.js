/**
 * Fase 1 — Flags de contacto de Sellers.
 *
 * Valores seguros por defecto:
 *   - sync off;
 *   - central mirror off;
 *   - inbound off;
 *   - allowlist vacía (ninguna cuenta habilitada).
 *
 * La allowlist contiene ACCOUNT_IDs de Chatwoot, no affiliate_ids. El vínculo
 * affiliate_id <-> account_id se resuelve en seller-chatwoot-registry.service.js.
 */

const SYNC_MODES = Object.freeze(['off', 'seller_only', 'shadow', 'write']);
const MIRROR_MODES = Object.freeze(['off', 'shadow', 'write']);
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'si', 'sí']);

function asString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
}

function parseEnum(value, allowed, fallback) {
    const normalized = asString(value).toLowerCase();
    return allowed.includes(normalized) ? normalized : fallback;
}

function parseBoolean(value, fallback = false) {
    const normalized = asString(value).toLowerCase();
    if (!normalized) {
        return fallback;
    }
    if (TRUE_VALUES.has(normalized)) {
        return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
    }
    return fallback;
}

function parseAllowlist(value) {
    const accountIds = [];
    const invalid = [];

    for (const entry of asString(value).split(/[,\s]+/).filter(Boolean)) {
        const accountId = Number(entry);
        if (Number.isInteger(accountId) && accountId > 0) {
            if (!accountIds.includes(accountId)) {
                accountIds.push(accountId);
            }
        } else {
            invalid.push(entry);
        }
    }

    return { accountIds, invalid };
}

function parseWriteAllowlist(value) {
    return [...new Set(
        asString(value)
            .split(/[,\s;]+/)
            .map((entry) => entry.trim())
            .filter(Boolean),
    )];
}

function digits(value) {
    return asString(value).replace(/\D/g, '');
}

/**
 * Devuelve el estado efectivo de los flags. No lanza: un valor inválido cae al
 * valor seguro (off / false / allowlist vacía).
 */
export function getSellerContactFlags() {
    const allowlist = parseAllowlist(process.env.SELLER_CONTACT_ALLOWLIST);
    const centralWriteAllowlist = parseWriteAllowlist(
        process.env.SELLER_CONTACT_CENTRAL_WRITE_ALLOWLIST,
    );

    return Object.freeze({
        syncMode: parseEnum(process.env.SELLER_CONTACT_SYNC_MODE, SYNC_MODES, 'off'),
        centralMirror: parseEnum(process.env.SELLER_CONTACT_CENTRAL_MIRROR, MIRROR_MODES, 'off'),
        inboundEnabled: parseBoolean(process.env.SELLER_INBOUND_ENABLED, false),
        allowlist: Object.freeze(allowlist.accountIds),
        invalidAllowlistEntries: Object.freeze(allowlist.invalid),
        centralWriteAllowlist: Object.freeze(centralWriteAllowlist),
        contextSecretConfigured: Boolean(asString(process.env.SELLER_CONTEXT_SECRET)),
        webhookSecretConfigured: Boolean(asString(process.env.SELLER_WEBHOOK_SECRET)),
    });
}

export function isAccountAllowed(accountId, flags = getSellerContactFlags()) {
    const id = Number(accountId);
    return Number.isInteger(id) && id > 0 && flags.allowlist.includes(id);
}

/**
 * Indica si el flujo de edición de contacto del Seller puede escribir.
 * `shadow` no escribe: solo calcula y registra.
 */
export function canWriteSellerContact(accountId, flags = getSellerContactFlags()) {
    if (!isAccountAllowed(accountId, flags)) {
        return false;
    }

    return flags.syncMode === 'seller_only' || flags.syncMode === 'write';
}

export function isSellerContactShadow(accountId, flags = getSellerContactFlags()) {
    return isAccountAllowed(accountId, flags) && flags.syncMode === 'shadow';
}

export function canWriteCentralMirror(accountId, flags = getSellerContactFlags()) {
    return isAccountAllowed(accountId, flags) && flags.centralMirror === 'write';
}

export function isCentralMirrorShadow(accountId, flags = getSellerContactFlags()) {
    return isAccountAllowed(accountId, flags) && flags.centralMirror === 'shadow';
}

/**
 * En modo write, la allowlist de contactos es obligatoria. Sin entradas (o sin
 * `*`) no se escribe nada en la cuenta principal. Esto permite probar Fase 8
 * con un único contacto antes de ampliar el alcance.
 */
export function isCentralWriteAllowedForContact({
    email,
    phone,
}, flags = getSellerContactFlags()) {
    if (flags.centralMirror !== 'write') {
        return false;
    }

    const allowlist = flags.centralWriteAllowlist || [];
    if (allowlist.length === 0) {
        return false;
    }

    if (allowlist.includes('*')) {
        return true;
    }

    const normalizedEmail = asString(email).toLowerCase();
    const normalizedPhone = digits(phone);

    return allowlist.some((entry) => {
        const normalizedEntry = asString(entry).toLowerCase();
        if (normalizedEntry.includes('@')) {
            return normalizedEntry === normalizedEmail;
        }
        return digits(normalizedEntry) === normalizedPhone;
    });
}

export function isSellerInboundEnabled(accountId, flags = getSellerContactFlags()) {
    return isAccountAllowed(accountId, flags) && flags.inboundEnabled === true;
}

/**
 * Resumen seguro para logs. No incluye secretos.
 */
export function describeSellerContactFlags(flags = getSellerContactFlags()) {
    return {
        syncMode: flags.syncMode,
        centralMirror: flags.centralMirror,
        inboundEnabled: flags.inboundEnabled,
        allowlist: [...flags.allowlist],
        invalidAllowlistEntries: [...flags.invalidAllowlistEntries],
        centralWriteAllowlist: [...(flags.centralWriteAllowlist || [])],
        contextSecretConfigured: flags.contextSecretConfigured,
        webhookSecretConfigured: flags.webhookSecretConfigured,
    };
}

export default {
    getSellerContactFlags,
    isAccountAllowed,
    canWriteSellerContact,
    isSellerContactShadow,
    canWriteCentralMirror,
    isCentralMirrorShadow,
    isCentralWriteAllowedForContact,
    isSellerInboundEnabled,
    describeSellerContactFlags,
};

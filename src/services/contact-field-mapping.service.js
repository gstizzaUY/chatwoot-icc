/**
 * Mapeo de campos RD Station -> custom_attributes de Chatwoot.
 *
 * No crea definiciones nuevas. Solo usa atributos que ya existen en la cuenta
 * de Chatwoot y reporta los campos que no tienen equivalente.
 */

const DEFINITIONS_TTL_MS = 10 * 60 * 1000;
const definitionsCache = new Map();

const IGNORED_RD_KEYS = new Set([
    'name',
    'email',
    'phone',
    'phone_number',
    'id',
    'uuid',
    'links',
    'convertir_sql',
    'conversationId',
    'seller_account_id',
    'seller_affiliate_id',
    'ctx',
    'contact_id',
    'conversation_id',
]);

const ALIASES = Object.freeze({
    mobile_phone: 'mobile',
    personal_phone: 'phone',
    cf_id_equipo: 'id_robot',
    cf_version_firmware: 'version_del_firmware',
    cf_address1: 'address1',
    cf_address2: 'address2',
    cf_zip: 'zip',
    cf_cedula: 'cedula',
    cf_participo_sdr: 'participo_SDR',
    cf_estado_sdr: 'estado_sdr',
    cf_tiene_ichef: 'tiene_ichef',
    cf_stage: 'stage',
    cf_owner: 'owner',
    cf_language: 'language',
    cf_comments: 'comments',
    cf_client_comments: 'clientComments',
    cf_custom_data: 'customData',
    cf_birthdate: 'birthdate',
    cf_membership: 'membership',
    cf_blacklist: 'blacklist',
});

const PROTECTED_KEYS = new Set(['stage', 'tiene_ichef', 'es_cliente']);

const STAGE_LEVELS = {
    lead: 0,
    marketingqualifiedlead: 1,
    mql: 1,
    salesqualifiedlead: 2,
    sql: 2,
    opportunity: 3,
    oportunidad: 3,
    customer: 4,
    cliente: 4,
};

function asString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
}

function normalizeKey(value) {
    return asString(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isUsableValue(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (typeof value === 'number' || typeof value === 'boolean') return true;
    return false;
}

function definitionKeys(definitions = []) {
    const result = new Map();
    for (const definition of definitions) {
        if (asString(definition.attribute_model) !== 'contact_attribute') {
            continue;
        }
        const key = asString(definition.attribute_key);
        if (key) {
            result.set(normalizeKey(key), key);
        }
    }
    return result;
}

function resolveChatwootKey(rdKey, keys) {
    const direct = keys.get(normalizeKey(rdKey));
    if (direct) {
        return direct;
    }

    const alias = ALIASES[rdKey];
    if (alias && keys.has(normalizeKey(alias))) {
        return keys.get(normalizeKey(alias));
    }

    if (rdKey.startsWith('cf_ls_')) {
        // Mapeo histórico usado por la app de Contacto; el atributo puede no
        // tener definición visible en Chatwoot, pero se conserva.
        return `ls_${rdKey.slice(6)}`;
    }

    // Campos históricos que ya se sincronizaban aunque no tengan definición
    // visible en la cuenta.
    const legacy = {
        cf_rut: 'rut',
        cf_numero_puerta: 'numero_puerta',
    };
    if (legacy[rdKey]) {
        return legacy[rdKey];
    }

    if (rdKey.startsWith('cf_')) {
        const stripped = rdKey.slice(3);
        const byStripped = keys.get(normalizeKey(stripped));
        if (byStripped) {
            return byStripped;
        }
    }

    return null;
}

function isProtectedDowngrade({ key, value, currentAttributes }) {
    const current = asString(currentAttributes?.[key]);

    if (key === 'stage') {
        const oldLevel = STAGE_LEVELS[normalizeKey(current)];
        const newLevel = STAGE_LEVELS[normalizeKey(value)];
        return oldLevel !== undefined && newLevel !== undefined && newLevel < oldLevel;
    }

    if (key === 'tiene_ichef' || key === 'es_cliente') {
        return current.toLowerCase() === 'sí'
            && asString(value).toLowerCase() !== 'sí';
    }

    return false;
}

export async function fetchContactDefinitions({
    baseUrl,
    token,
    accountId,
    fetcher = fetch,
}) {
    const id = Number(accountId);
    if (!baseUrl || !token || !id) {
        throw new Error('Configuración incompleta para obtener atributos de Chatwoot');
    }

    const cacheKey = `${String(baseUrl).replace(/\/+$/, '')}#${id}`;
    const cached = definitionsCache.get(cacheKey);
    if (cached && Date.now() - cached.at < DEFINITIONS_TTL_MS) {
        return cached.definitions;
    }

    let response;
    try {
        response = await fetcher(
            `${String(baseUrl).replace(/\/+$/, '')}/api/v1/accounts/${id}/custom_attribute_definitions?attribute_model=contact_attribute`,
            {
                headers: {
                    Accept: 'application/json',
                    api_access_token: token,
                },
                signal: AbortSignal.timeout(30000),
            },
        );
    } catch (error) {
        throw new Error(`No se pudieron obtener los atributos de Chatwoot: ${error.message}`);
    }

    if (!response.ok) {
        throw new Error(`Chatwoot respondió HTTP ${response.status} al listar atributos`);
    }

    const body = await response.json();
    const definitions = Array.isArray(body) ? body : body?.payload || [];
    definitionsCache.set(cacheKey, { at: Date.now(), definitions });
    return definitions;
}

/**
 * Devuelve `attributes` mapeados, más listas de campos omitidos/protegidos.
 */
export function mapRdFieldsToChatwoot({
    rdData = {},
    definitions = [],
    currentAttributes = {},
    clearFields = [],
} = {}) {
    const keys = definitionKeys(definitions);
    const attributes = {};
    const omitted = [];
    const protectedFields = [];
    const clearSet = new Set(
        (Array.isArray(clearFields) ? clearFields : [])
            .map(asString)
            .filter(Boolean),
    );
    const allKeys = new Set([...Object.keys(rdData), ...clearSet]);

    for (const rdKey of allKeys) {
        if (IGNORED_RD_KEYS.has(rdKey)) {
            continue;
        }

        const shouldClear = clearSet.has(rdKey);
        const value = rdData[rdKey];
        if (!shouldClear && !isUsableValue(value)) {
            continue;
        }

        const targetKey = resolveChatwootKey(rdKey, keys);
        if (!targetKey) {
            omitted.push(rdKey);
            continue;
        }

        if (PROTECTED_KEYS.has(targetKey)) {
            if (shouldClear || isProtectedDowngrade({
                key: targetKey,
                value,
                currentAttributes,
            })) {
                protectedFields.push(targetKey);
                continue;
            }
        }

        attributes[targetKey] = shouldClear ? null : value;
    }

    return {
        attributes,
        omitted,
        protectedFields,
    };
}

export default {
    fetchContactDefinitions,
    mapRdFieldsToChatwoot,
};

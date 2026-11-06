/**
 * Fase 2 — Provisión de campos personalizados para cuentas de Seller.
 *
 * Reglas:
 *   - solo copia definiciones de contacto;
 *   - nunca modifica ni borra definiciones existentes;
 *   - es idempotente por attribute_key + attribute_model;
 *   - omite claves estándar de Chatwoot que no se pueden recrear;
 *   - reporta drift sin corregirlo automáticamente;
 *   - por defecto hace dry-run.
 */

const CONTACT_STANDARD_KEYS = new Set([
    'name',
    'email',
    'phone_number',
    'identifier',
    'country_code',
    'city',
    'company_name',
    'created_at',
    'last_activity_at',
    'referer',
    'blocked',
]);

const ALLOWED_DISPLAY_TYPES = new Set([
    'text',
    'number',
    'currency',
    'percent',
    'link',
    'date',
    'list',
    'checkbox',
]);

const REQUEST_TIMEOUT_MS = 30000;

function asString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
}

function asNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function normalizeUrl(url) {
    return asString(url).replace(/\/+$/, '');
}

function definitionKey(definition) {
    return `${asString(definition?.attribute_model) || 'contact_attribute'}:${asString(definition?.attribute_key)}`;
}

export function isReservedContactAttributeKey(key) {
    return CONTACT_STANDARD_KEYS.has(asString(key));
}

export function buildCustomAttributePayload(definition) {
    if (!definition || !asString(definition.attribute_key)) {
        throw new Error('Definición de atributo inválida: falta attribute_key');
    }

    const displayType = asString(definition.attribute_display_type) || 'text';
    if (!ALLOWED_DISPLAY_TYPES.has(displayType)) {
        throw new Error(`Tipo de atributo no soportado: ${displayType}`);
    }

    return {
        attribute_display_name: asString(definition.attribute_display_name),
        attribute_description: definition.attribute_description ?? null,
        attribute_display_type: displayType,
        attribute_key: asString(definition.attribute_key),
        attribute_model: asString(definition.attribute_model) || 'contact_attribute',
        regex_pattern: definition.regex_pattern ?? null,
        regex_cue: definition.regex_cue ?? null,
        attribute_values: Array.isArray(definition.attribute_values)
            ? definition.attribute_values
            : [],
    };
}

function publicDefinition(definition) {
    return {
        key: definition.attribute_key,
        name: definition.attribute_display_name,
        type: definition.attribute_display_type,
        model: definition.attribute_model,
    };
}

async function apiRequest(baseUrl, token, endpoint, options = {}) {
    const {
        method = 'GET',
        body = null,
        timeout = REQUEST_TIMEOUT_MS,
    } = options;

    let response;
    try {
        response = await fetch(`${normalizeUrl(baseUrl)}${endpoint}`, {
            method,
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                api_access_token: token,
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(timeout),
        });
    } catch (error) {
        return { ok: false, status: null, error: error.message };
    }

    const text = await response.text();
    let payload = null;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch {
        payload = null;
    }

    if (!response.ok) {
        return {
            ok: false,
            status: response.status,
            error: payload?.errors?.join?.('; ')
                || payload?.message
                || text.slice(0, 500)
                || `HTTP ${response.status}`,
            payload,
        };
    }

    return { ok: true, status: response.status, payload };
}

export async function fetchCustomAttributeDefinitions({ baseUrl, token, accountId, fetcher = apiRequest }) {
    const id = asNumber(accountId);
    if (!id) {
        throw new Error('accountId inválido');
    }

    const result = await fetcher(
        baseUrl,
        token,
        `/api/v1/accounts/${id}/custom_attribute_definitions?attribute_model=contact_attribute`,
    );

    if (!result.ok) {
        throw new Error(`No se pudieron leer los atributos de la cuenta ${id}: ${result.error}`);
    }

    const list = Array.isArray(result.payload)
        ? result.payload
        : result.payload?.payload || [];

    return list.filter((definition) => (
        (definition.attribute_model || 'contact_attribute') === 'contact_attribute'
    ));
}

/**
 * Calcula el plan sin escribir.
 */
export function planCustomAttributeCopy(sourceDefinitions, targetDefinitions, { skipReserved = true } = {}) {
    const targetByKey = new Map();
    for (const definition of targetDefinitions) {
        targetByKey.set(definitionKey(definition), definition);
    }

    const missing = [];
    const existing = [];
    const reserved = [];
    const drift = [];
    const invalid = [];

    for (const source of sourceDefinitions) {
        const key = asString(source.attribute_key);
        const model = asString(source.attribute_model) || 'contact_attribute';
        const targetKey = `${model}:${key}`;

        if (!key) {
            invalid.push({ reason: 'missing_attribute_key', source });
            continue;
        }

        if (skipReserved && isReservedContactAttributeKey(key)) {
            reserved.push(publicDefinition(source));
            continue;
        }

        if (!ALLOWED_DISPLAY_TYPES.has(asString(source.attribute_display_type))) {
            invalid.push({ reason: 'unsupported_display_type', definition: publicDefinition(source) });
            continue;
        }

        const target = targetByKey.get(targetKey);
        if (target) {
            existing.push(publicDefinition(source));
            if (
                asString(target.attribute_display_type) !== asString(source.attribute_display_type)
                || JSON.stringify(target.attribute_values || []) !== JSON.stringify(source.attribute_values || [])
            ) {
                drift.push({
                    key,
                    source: publicDefinition(source),
                    target: publicDefinition(target),
                });
            }
            continue;
        }

        missing.push(source);
    }

    return {
        missing,
        existing,
        reserved,
        drift,
        invalid,
        sourceCount: sourceDefinitions.length,
        targetCount: targetDefinitions.length,
    };
}

/**
 * Copia las definiciones. `dryRun` está activado por defecto.
 */
export async function provisionCustomAttributes({
    source,
    target,
    dryRun = true,
    skipReserved = true,
    onlyKeys = [],
    delayMs = 100,
    fetcher = apiRequest,
} = {}) {
    if (!source?.baseUrl || !source?.token || !source?.accountId) {
        throw new Error('Configuración source incompleta');
    }
    if (!target?.baseUrl || !target?.token || !target?.accountId) {
        throw new Error('Configuración target incompleta');
    }

    const sourceId = asNumber(source.accountId);
    const targetId = asNumber(target.accountId);
    if (sourceId === targetId && normalizeUrl(source.baseUrl) === normalizeUrl(target.baseUrl)) {
        throw new Error('Source y target son la misma cuenta; se aborta para no tocar producción');
    }

    const [sourceDefinitions, targetDefinitions] = await Promise.all([
        fetchCustomAttributeDefinitions({ baseUrl: source.baseUrl, token: source.token, accountId: sourceId, fetcher }),
        fetchCustomAttributeDefinitions({ baseUrl: target.baseUrl, token: target.token, accountId: targetId, fetcher }),
    ]);

    const allowedOnlyKeys = new Set(
        (Array.isArray(onlyKeys) ? onlyKeys : [])
            .map(asString)
            .filter(Boolean),
    );

    const scopedSource = allowedOnlyKeys.size > 0
        ? sourceDefinitions.filter((definition) => allowedOnlyKeys.has(asString(definition.attribute_key)))
        : sourceDefinitions;

    const plan = planCustomAttributeCopy(scopedSource, targetDefinitions, { skipReserved });
    const created = [];
    const failed = [];

    if (!dryRun) {
        for (const definition of plan.missing) {
            const payload = buildCustomAttributePayload(definition);
            const result = await fetcher(
                target.baseUrl,
                target.token,
                `/api/v1/accounts/${targetId}/custom_attribute_definitions`,
                {
                    method: 'POST',
                    body: { custom_attribute_definition: payload },
                },
            );

            if (result.ok) {
                created.push(publicDefinition(definition));
            } else {
                failed.push({
                    definition: publicDefinition(definition),
                    status: result.status,
                    error: result.error,
                });

                // Un token inválido no se soluciona reintentando 130 veces.
                if (result.status === 401 || result.status === 403) {
                    break;
                }
            }

            if (delayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
    }

    let targetAfter = targetDefinitions;
    if (!dryRun) {
        targetAfter = await fetchCustomAttributeDefinitions({
            baseUrl: target.baseUrl,
            token: target.token,
            accountId: targetId,
            fetcher,
        });
    }

    return {
        dryRun,
        sourceAccountId: sourceId,
        targetAccountId: targetId,
        sourceCount: sourceDefinitions.length,
        scopedSourceCount: scopedSource.length,
        targetCountBefore: targetDefinitions.length,
        targetCountAfter: targetAfter.length,
        plan: {
            missing: plan.missing.map(publicDefinition),
            existing: plan.existing,
            reserved: plan.reserved,
            drift: plan.drift,
            invalid: plan.invalid,
        },
        created,
        failed,
    };
}

export default {
    isReservedContactAttributeKey,
    buildCustomAttributePayload,
    fetchCustomAttributeDefinitions,
    planCustomAttributeCopy,
    provisionCustomAttributes,
};

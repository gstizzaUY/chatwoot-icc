import {
    buildCustomAttributePayload,
    fetchCustomAttributeDefinitions,
    planCustomAttributeCopy,
} from './seller-chatwoot-provisioning.service.js';
import { LS_ATTRIBUTE_DEFINITIONS } from '../constants/ls-attributes.constants.js';

/**
 * Crea las definiciones `ls_*` en una cuenta Chatwoot.
 * Es aditivo e idempotente: no modifica ni borra definiciones existentes.
 */

function asNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

async function postDefinition({ target, definition, fetcher = fetch }) {
    const accountId = asNumber(target.accountId);
    const baseUrl = String(target.baseUrl || '').replace(/\/+$/, '');
    const payload = buildCustomAttributePayload(definition);

    const response = await fetcher(
        `${baseUrl}/api/v1/accounts/${accountId}/custom_attribute_definitions`,
        {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                api_access_token: target.token,
            },
            body: JSON.stringify({ custom_attribute_definition: payload }),
            signal: AbortSignal.timeout(30000),
        },
    );

    const text = await response.text();
    let body = null;
    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        body = null;
    }

    if (!response.ok) {
        return {
            ok: false,
            status: response.status,
            error: body?.errors?.join?.('; ') || body?.message || text.slice(0, 500),
        };
    }

    return { ok: true, status: response.status, body };
}

export async function provisionLsAttributes({
    target,
    definitions = LS_ATTRIBUTE_DEFINITIONS,
    dryRun = true,
    fetcher = fetch,
} = {}) {
    if (!target?.baseUrl || !target?.token || !target?.accountId) {
        throw new Error('Target de Chatwoot incompleto');
    }

    const accountId = asNumber(target.accountId);
    const existing = await fetchCustomAttributeDefinitions({
        baseUrl: target.baseUrl,
        token: target.token,
        accountId,
        fetcher: async (baseUrl, token, endpoint) => {
            const response = await fetcher(`${String(baseUrl).replace(/\/+$/, '')}${endpoint}`, {
                headers: {
                    Accept: 'application/json',
                    api_access_token: token,
                },
                signal: AbortSignal.timeout(30000),
            });
            const text = await response.text();
            let payload = null;
            try {
                payload = text ? JSON.parse(text) : null;
            } catch {
                payload = null;
            }
            return {
                ok: response.ok,
                status: response.status,
                error: response.ok ? null : text.slice(0, 500),
                payload,
            };
        },
    });

    const plan = planCustomAttributeCopy(definitions, existing, { skipReserved: false });
    const created = [];
    const failed = [];

    if (!dryRun) {
        for (const definition of plan.missing) {
            const result = await postDefinition({ target, definition, fetcher });
            if (result.ok) {
                created.push({
                    key: definition.attribute_key,
                    name: definition.attribute_display_name,
                    type: definition.attribute_display_type,
                });
            } else {
                failed.push({
                    key: definition.attribute_key,
                    status: result.status,
                    error: result.error,
                });
                if (result.status === 401 || result.status === 403) {
                    break;
                }
            }
        }
    }

    const after = dryRun
        ? existing
        : await fetchCustomAttributeDefinitions({
            baseUrl: target.baseUrl,
            token: target.token,
            accountId,
            fetcher: async (baseUrl, token, endpoint) => {
                const response = await fetcher(`${String(baseUrl).replace(/\/+$/, '')}${endpoint}`, {
                    headers: {
                        Accept: 'application/json',
                        api_access_token: token,
                    },
                    signal: AbortSignal.timeout(30000),
                });
                const text = await response.text();
                let payload = null;
                try {
                    payload = text ? JSON.parse(text) : null;
                } catch {
                    payload = null;
                }
                return {
                    ok: response.ok,
                    status: response.status,
                    error: response.ok ? null : text.slice(0, 500),
                    payload,
                };
            },
        });

    const keysAfter = new Set(after.map((definition) => definition.attribute_key));
    const missingAfter = definitions
        .map((definition) => definition.attribute_key)
        .filter((key) => !keysAfter.has(key));

    return {
        dryRun,
        accountId,
        sourceCount: definitions.length,
        existingCount: existing.filter((definition) => (
            definitions.some((source) => source.attribute_key === definition.attribute_key)
        )).length,
        missing: plan.missing.map((definition) => definition.attribute_key),
        existing: plan.existing.map((definition) => definition.key),
        drift: plan.drift,
        created,
        failed,
        missingAfter,
        verified: missingAfter.length === 0,
    };
}

export default {
    provisionLsAttributes,
};

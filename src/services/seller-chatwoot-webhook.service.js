/**
 * Fase 6 — Webhook inbound de Chatwoot Seller.
 *
 * Crea/actualiza el webhook de la cuenta del Seller apuntando al hub.
 * El secreto viaja en el query string de la URL y nunca se escribe en los
 * reportes públicos.
 */

const WEBHOOK_PATH = '/api/v2/webhooks/chatwoot/seller-inbound';
const DEFAULT_SUBSCRIPTIONS = Object.freeze(['conversation_created']);
const REQUEST_TIMEOUT_MS = 30000;

export class SellerWebhookError extends Error {
    constructor(code, message, status = 400, details = null) {
        super(message);
        this.name = 'SellerWebhookError';
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

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

export function buildSellerInboundWebhookUrl({
    backendBaseUrl,
    secret,
} = {}) {
    const base = normalizeUrl(backendBaseUrl);
    const token = asString(secret);
    if (!base || !token) {
        throw new SellerWebhookError(
            'SELLER_WEBHOOK_CONFIG_MISSING',
            'backendBaseUrl y secret son obligatorios',
            400,
        );
    }

    const params = new URLSearchParams({ token });
    return `${base}${WEBHOOK_PATH}?${params.toString()}`;
}

export function publicWebhookUrl(url) {
    try {
        const parsed = new URL(url);
        parsed.searchParams.delete('token');
        return parsed.toString();
    } catch {
        return asString(url).replace(/([?&])token=[^&]+(&)?/, '$1').replace(/[?&]$/, '');
    }
}

export function publicWebhook(webhook) {
    return {
        id: webhook?.id ?? null,
        url: publicWebhookUrl(webhook?.url),
        subscriptions: webhook?.subscriptions || [],
    };
}

function sameSubscriptions(left, right) {
    const a = [...(left || [])].sort();
    const b = [...(right || [])].sort();
    return JSON.stringify(a) === JSON.stringify(b);
}

export async function fetchWebhooks({ baseUrl, token, accountId, fetcher = apiRequest }) {
    const id = asNumber(accountId);
    if (!id) {
        throw new SellerWebhookError('INVALID_ACCOUNT', 'accountId inválido', 400);
    }

    const result = await fetcher(
        baseUrl,
        token,
        `/api/v1/accounts/${id}/webhooks`,
    );
    if (!result.ok) {
        throw new SellerWebhookError(
            'SELLER_WEBHOOK_READ_FAILED',
            `No se pudieron leer los webhooks: ${result.error}`,
            502,
            { status: result.status },
        );
    }

    return result.payload?.payload?.webhooks
        || result.payload?.webhooks
        || [];
}

function urlPath(url) {
    try {
        return new URL(url).pathname;
    } catch {
        return '';
    }
}

export function planSellerWebhook({
    webhooks,
    url,
    subscriptions = DEFAULT_SUBSCRIPTIONS,
}) {
    const path = urlPath(url);
    const existing = webhooks.find((webhook) => urlPath(webhook.url) === path) || null;

    if (!existing) {
        return { action: 'create', webhook: null, url, subscriptions };
    }

    if (existing.url === url && sameSubscriptions(existing.subscriptions, subscriptions)) {
        return { action: 'none', webhook: existing, url, subscriptions };
    }

    return { action: 'update', webhook: existing, url, subscriptions };
}

export async function provisionSellerInboundWebhook({
    target,
    url,
    subscriptions = DEFAULT_SUBSCRIPTIONS,
    dryRun = true,
    fetcher = apiRequest,
} = {}) {
    if (!target?.baseUrl || !target?.token || !target?.accountId) {
        throw new SellerWebhookError('TARGET_INCOMPLETE', 'Configuración target incompleta', 400);
    }
    if (!url) {
        throw new SellerWebhookError('SELLER_WEBHOOK_URL_MISSING', 'Falta la URL del webhook', 400);
    }

    const accountId = asNumber(target.accountId);
    const webhooks = await fetchWebhooks({
        baseUrl: target.baseUrl,
        token: target.token,
        accountId,
        fetcher,
    });
    const plan = planSellerWebhook({ webhooks, url, subscriptions });

    if (!dryRun && plan.action !== 'none') {
        const endpoint = plan.action === 'create'
            ? `/api/v1/accounts/${accountId}/webhooks`
            : `/api/v1/accounts/${accountId}/webhooks/${plan.webhook.id}`;
        const method = plan.action === 'create' ? 'POST' : 'PATCH';
        const result = await fetcher(
            target.baseUrl,
            target.token,
            endpoint,
            {
                method,
                body: {
                    webhook: {
                        url,
                        subscriptions,
                    },
                },
            },
        );

        if (!result.ok) {
            throw new SellerWebhookError(
                'SELLER_WEBHOOK_WRITE_FAILED',
                `No se pudo ${plan.action === 'create' ? 'crear' : 'actualizar'} el webhook: ${result.error}`,
                502,
                { status: result.status },
            );
        }
    }

    const after = dryRun
        ? webhooks
        : await fetchWebhooks({
            baseUrl: target.baseUrl,
            token: target.token,
            accountId,
            fetcher,
        });
    const afterPlan = planSellerWebhook({ webhooks: after, url, subscriptions });

    return {
        dryRun,
        accountId,
        action: plan.action,
        actionApplied: !dryRun && plan.action !== 'none',
        beforeCount: webhooks.length,
        afterCount: after.length,
        verified: afterPlan.action === 'none',
        url: publicWebhookUrl(url),
        webhook: publicWebhook(plan.webhook),
        afterAction: afterPlan.action,
    };
}

export default {
    SellerWebhookError,
    buildSellerInboundWebhookUrl,
    publicWebhookUrl,
    publicWebhook,
    fetchWebhooks,
    planSellerWebhook,
    provisionSellerInboundWebhook,
};

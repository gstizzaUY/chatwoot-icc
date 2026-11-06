import { signSellerContext } from './seller-context.service.js';

/**
 * Fase 5 — Dashboard app "RD STATION" para Sellers.
 *
 * No toca la cuenta principal. Solo administra la app de la cuenta del Seller.
 * Por defecto trabaja en dry-run: para escribir hay que pasar dryRun=false
 * desde el CLI con --apply.
 */

const DEFAULT_TITLE = 'RD STATION';
const CONTACT_PATH = '/v2/update-contact';
const REQUEST_TIMEOUT_MS = 30000;

export class SellerDashboardError extends Error {
    constructor(code, message, status = 400, details = null) {
        super(message);
        this.name = 'SellerDashboardError';
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

export function buildDashboardAppUrl({
    frontendBaseUrl,
    accountId,
    affiliateId,
    contextSecret,
} = {}) {
    const base = normalizeUrl(frontendBaseUrl);
    const sellerAccountId = asNumber(accountId);
    const sellerAffiliateId = asNumber(affiliateId);

    if (!base) {
        throw new SellerDashboardError('FRONTEND_URL_MISSING', 'frontendBaseUrl es obligatorio', 400);
    }
    if (!sellerAccountId || !sellerAffiliateId) {
        throw new SellerDashboardError(
            'SELLER_CONTEXT_INVALID',
            'accountId y affiliateId deben ser numéricos',
            400,
        );
    }

    const ctx = signSellerContext(
        { accountId: sellerAccountId, affiliateId: sellerAffiliateId },
        { secret: contextSecret },
    );
    const params = new URLSearchParams({
        mode: 'seller',
        seller_account_id: String(sellerAccountId),
        seller_affiliate_id: String(sellerAffiliateId),
        ctx,
    });

    return `${base}${CONTACT_PATH}?${params.toString()}`;
}

/**
 * URL apta para reportes/logs: elimina el token ctx.
 */
export function publicDashboardAppUrl(url) {
    try {
        const parsed = new URL(url);
        parsed.searchParams.delete('ctx');
        return parsed.toString();
    } catch {
        return asString(url).replace(/([?&])ctx=[^&]+(&)?/, '$1').replace(/[?&]$/, '');
    }
}

export function publicDashboardApp(app) {
    return {
        id: app?.id ?? null,
        title: app?.title || null,
        content: (app?.content || []).map((item) => ({
            type: item.type,
            url: publicDashboardAppUrl(item.url),
        })),
    };
}

export async function fetchDashboardApps({ baseUrl, token, accountId, fetcher = apiRequest }) {
    const id = asNumber(accountId);
    if (!id) {
        throw new SellerDashboardError('INVALID_ACCOUNT', 'accountId inválido', 400);
    }

    const result = await fetcher(
        baseUrl,
        token,
        `/api/v1/accounts/${id}/dashboard_apps`,
    );
    if (!result.ok) {
        throw new SellerDashboardError(
            'DASHBOARD_APPS_READ_FAILED',
            `No se pudieron leer las dashboard apps: ${result.error}`,
            502,
            { status: result.status },
        );
    }

    return Array.isArray(result.payload) ? result.payload : result.payload?.payload || [];
}

export async function fetchDashboardIntegrationStatus({ baseUrl, token, accountId, fetcher = apiRequest }) {
    const id = asNumber(accountId);
    const result = await fetcher(
        baseUrl,
        token,
        `/api/v1/accounts/${id}/integrations/apps`,
    );
    if (!result.ok) {
        return { enabled: null, error: result.error, status: result.status };
    }

    const apps = Array.isArray(result.payload) ? result.payload : result.payload?.payload || [];
    const app = apps.find((item) => item.id === 'dashboard_apps');
    return {
        enabled: app ? Boolean(app.enabled) : null,
        hookCount: app?.hooks?.length || 0,
    };
}

export function planDashboardApp({
    apps,
    title = DEFAULT_TITLE,
    url,
    legacyTitles = [],
} = {}) {
    const aliases = [title, ...legacyTitles].filter(Boolean);
    const existing = apps.find((app) => aliases.includes(app.title)) || null;

    if (!existing) {
        return {
            action: 'create',
            app: null,
            url,
        };
    }

    const currentUrls = (existing.content || []).map((item) => item.url);
    if (currentUrls.includes(url)) {
        return {
            action: 'none',
            app: existing,
            url,
        };
    }

    return {
        action: 'update',
        app: existing,
        url,
    };
}

/**
 * Crea o actualiza la app. `dryRun` es true por defecto.
 */
export async function provisionDashboardApp({
    target,
    title = DEFAULT_TITLE,
    url,
    legacyTitles = [],
    dryRun = true,
    requireIntegrationEnabled = true,
    fetcher = apiRequest,
} = {}) {
    if (!target?.baseUrl || !target?.token || !target?.accountId) {
        throw new SellerDashboardError('TARGET_INCOMPLETE', 'Configuración target incompleta', 400);
    }
    if (!url) {
        throw new SellerDashboardError('DASHBOARD_URL_MISSING', 'Falta la URL del dashboard', 400);
    }

    const accountId = asNumber(target.accountId);
    const [apps, integration] = await Promise.all([
        fetchDashboardApps({
            baseUrl: target.baseUrl,
            token: target.token,
            accountId,
            fetcher,
        }),
        fetchDashboardIntegrationStatus({
            baseUrl: target.baseUrl,
            token: target.token,
            accountId,
            fetcher,
        }),
    ]);

    const plan = planDashboardApp({ apps, title, url, legacyTitles });
    // En Chatwoot, `dashboard_apps.enabled` se deriva de que exista al menos
    // una dashboard app. Es false antes de crear la primera, así que no debe
    // bloquear el create. Solo bloquea una actualización sobre una integración
    // que se reporta inactiva.
    if (!dryRun && requireIntegrationEnabled && integration.enabled === false && plan.action !== 'create') {
        throw new SellerDashboardError(
            'DASHBOARD_APPS_DISABLED',
            'La integración dashboard_apps está deshabilitada en la cuenta del Seller',
            409,
            { accountId },
        );
    }

    let actionResult = null;
    if (!dryRun && plan.action !== 'none') {
        const endpoint = plan.action === 'create'
            ? `/api/v1/accounts/${accountId}/dashboard_apps`
            : `/api/v1/accounts/${accountId}/dashboard_apps/${plan.app.id}`;
        const method = plan.action === 'create' ? 'POST' : 'PATCH';
        const body = {
            dashboard_app: {
                title,
                content: [{ url, type: 'frame' }],
            },
        };

        actionResult = await fetcher(
            target.baseUrl,
            target.token,
            endpoint,
            { method, body },
        );

        if (!actionResult.ok) {
            throw new SellerDashboardError(
                'DASHBOARD_APP_WRITE_FAILED',
                `No se pudo ${plan.action === 'create' ? 'crear' : 'actualizar'} la dashboard app: ${actionResult.error}`,
                502,
                { status: actionResult.status },
            );
        }
    }

    const after = dryRun
        ? apps
        : await fetchDashboardApps({
            baseUrl: target.baseUrl,
            token: target.token,
            accountId,
            fetcher,
        });

    const afterPlan = planDashboardApp({ apps: after, title, url, legacyTitles });

    return {
        dryRun,
        accountId,
        title,
        action: plan.action,
        actionApplied: !dryRun && plan.action !== 'none',
        integrationEnabled: integration.enabled,
        beforeCount: apps.length,
        afterCount: after.length,
        url: publicDashboardAppUrl(url),
        app: publicDashboardApp(plan.app),
        afterAction: afterPlan.action,
        verified: afterPlan.action === 'none',
    };
}

export default {
    SellerDashboardError,
    buildDashboardAppUrl,
    publicDashboardAppUrl,
    publicDashboardApp,
    fetchDashboardApps,
    fetchDashboardIntegrationStatus,
    planDashboardApp,
    provisionDashboardApp,
};

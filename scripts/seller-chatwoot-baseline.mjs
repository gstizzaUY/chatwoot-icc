/**
 * Fase 0 — Baseline read-only de Chatwoot principal + Sellers conectados.
 *
 * No escribe en Chatwoot. Solo lee definiciones, apps, webhooks,
 * automatizaciones, integraciones e inboxes, y guarda un JSON sin secretos.
 *
 * Uso:
 *   node scripts/seller-chatwoot-baseline.mjs
 *   node scripts/seller-chatwoot-baseline.mjs --output=data/baseline.json
 *
 * Para incluir una cuenta que todavía no está en el .env del backend:
 *   node scripts/seller-chatwoot-baseline.mjs \
 *     --seller-url=https://chatwoot-seller.example.com \
 *     --seller-account-id=3 \
 *     --seller-token-env=SELLER_BASELINE_TOKEN
 *
 * El token se lee de la variable de entorno indicada y NUNCA se escribe en el
 * snapshot. El script no hace POST/PUT/PATCH/DELETE.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import {
    inspectConfiguredSellers,
    listConfiguredSellers,
} from '../src/services/seller-chatwoot-registry.service.js';
import {
    describeSellerContactFlags,
    getSellerContactFlags,
} from '../src/services/seller-contact-flags.service.js';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const REQUEST_TIMEOUT_MS = 30000;

function argValue(name) {
    const prefix = `--${name}=`;
    const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
    return found ? found.slice(prefix.length) : null;
}

function hasFlag(name) {
    return process.argv.slice(2).includes(`--${name}`);
}

function normalizeUrl(url) {
    return String(url || '').trim().replace(/\/+$/, '');
}

function dateStamp() {
    return new Date().toISOString().slice(0, 10);
}

function asString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
}

async function requestJson(baseUrl, token, endpoint) {
    const url = `${normalizeUrl(baseUrl)}${endpoint}`;

    let response;
    try {
        response = await fetch(url, {
            headers: {
                Accept: 'application/json',
                api_access_token: token,
            },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (error) {
        return { ok: false, status: null, error: error.message };
    }

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
            error: body?.errors?.join?.('; ') || text.slice(0, 300) || `HTTP ${response.status}`,
        };
    }

    return { ok: true, status: response.status, body };
}

function sanitizeAccount(body) {
    const account = body?.payload || body || {};
    return {
        id: account.id ?? null,
        name: account.name ?? null,
        locale: account.locale ?? null,
        status: account.status ?? null,
        latestChatwootVersion: account.latest_chatwoot_version ?? null,
    };
}

function sanitizeCustomAttributes(body) {
    const list = Array.isArray(body) ? body : body?.payload || [];
    return list.map((attribute) => ({
        id: attribute.id,
        key: attribute.attribute_key,
        name: attribute.attribute_display_name,
        type: attribute.attribute_display_type,
        model: attribute.attribute_model,
        values: attribute.attribute_values || [],
        defaultValue: attribute.default_value ?? null,
    }));
}

function sanitizeDashboardApps(body) {
    const list = Array.isArray(body) ? body : body?.payload || [];
    return list.map((app) => ({
        id: app.id,
        title: app.title,
        content: (app.content || []).map((item) => ({
            type: item.type,
            url: item.url,
        })),
    }));
}

function sanitizeWebhooks(body) {
    const list = body?.payload?.webhooks || body?.payload || [];
    return list.map((hook) => ({
        id: hook.id,
        name: hook.name || null,
        url: hook.url,
        subscriptions: hook.subscriptions || [],
        // El secret del webhook se omite deliberadamente.
    }));
}

function sanitizeAutomations(body) {
    const list = body?.payload || [];
    return list.map((rule) => ({
        id: rule.id,
        name: rule.name,
        eventName: rule.event_name,
        active: Boolean(rule.active),
    }));
}

function sanitizeIntegrations(body) {
    const list = body?.payload || [];
    return list
        .filter((app) => ['dashboard_apps', 'webhook'].includes(app.id))
        .map((app) => ({
            id: app.id,
            name: app.name,
            enabled: Boolean(app.enabled),
            hookCount: Array.isArray(app.hooks) ? app.hooks.length : 0,
        }));
}

function sanitizeInboxes(body) {
    const list = body?.payload || [];
    return list.map((inbox) => ({
        id: inbox.id,
        name: inbox.name,
        channelType: inbox.channel_type,
    }));
}

async function snapshotAccount({ role, baseUrl, token, accountId, affiliateId = null, source = 'env' }) {
    const accountPath = `/api/v1/accounts/${accountId}`;
    const [account, attributes, dashboardApps, webhooks, automations, integrations, inboxes] = await Promise.all([
        requestJson(baseUrl, token, accountPath),
        requestJson(baseUrl, token, `${accountPath}/custom_attribute_definitions`),
        requestJson(baseUrl, token, `${accountPath}/dashboard_apps`),
        requestJson(baseUrl, token, `${accountPath}/webhooks`),
        requestJson(baseUrl, token, `${accountPath}/automation_rules`),
        requestJson(baseUrl, token, `${accountPath}/integrations/apps`),
        requestJson(baseUrl, token, `${accountPath}/inboxes`),
    ]);

    const result = {
        role,
        source,
        affiliateId,
        accountId: Number(accountId),
        baseUrl: normalizeUrl(baseUrl),
        readAt: new Date().toISOString(),
        account: account.ok ? sanitizeAccount(account.body) : { error: account.error, status: account.status },
        customAttributes: attributes.ok
            ? sanitizeCustomAttributes(attributes.body)
            : { error: attributes.error, status: attributes.status },
        dashboardApps: dashboardApps.ok
            ? sanitizeDashboardApps(dashboardApps.body)
            : { error: dashboardApps.error, status: dashboardApps.status },
        webhooks: webhooks.ok
            ? sanitizeWebhooks(webhooks.body)
            : { error: webhooks.error, status: webhooks.status },
        automations: automations.ok
            ? sanitizeAutomations(automations.body)
            : { error: automations.error, status: automations.status },
        integrations: integrations.ok
            ? sanitizeIntegrations(integrations.body)
            : { error: integrations.error, status: integrations.status },
        inboxes: inboxes.ok
            ? sanitizeInboxes(inboxes.body)
            : { error: inboxes.error, status: inboxes.status },
    };

    return result;
}

function directSellerTarget() {
    const accountId = argValue('seller-account-id');
    const url = argValue('seller-url');
    const tokenEnv = argValue('seller-token-env') || 'SELLER_BASELINE_TOKEN';

    if (!accountId && !url && !argValue('seller-token-env')) {
        return null;
    }

    if (!accountId || !url || !process.env[tokenEnv]) {
        throw new Error(
            'Para un Seller directo se requieren --seller-url, --seller-account-id '
            + `y la variable de entorno ${tokenEnv}`,
        );
    }

    return {
        affiliateId: argValue('seller-affiliate-id') ? Number(argValue('seller-affiliate-id')) : null,
        accountId: Number(accountId),
        url: normalizeUrl(url),
        token: process.env[tokenEnv],
        source: 'cli',
    };
}

function summarize(account) {
    const count = (value) => (Array.isArray(value) ? value.length : null);
    return {
        role: account.role,
        accountId: account.accountId,
        accountName: account.account?.name || null,
        fields: count(account.customAttributes),
        dashboardApps: count(account.dashboardApps),
        webhooks: count(account.webhooks),
        automations: count(account.automations),
        inboxes: count(account.inboxes),
        integrations: Array.isArray(account.integrations)
            ? Object.fromEntries(account.integrations.map((app) => [app.id, app.enabled]))
            : account.integrations,
        errors: ['account', 'customAttributes', 'dashboardApps', 'webhooks', 'automations', 'integrations', 'inboxes']
            .filter((key) => !Array.isArray(account[key]) && account[key]?.error)
            .map((key) => ({ section: key, error: account[key].error, status: account[key].status })),
    };
}

async function main() {
    if (hasFlag('help')) {
        console.log('Uso: node scripts/seller-chatwoot-baseline.mjs [--output=...] '
            + '[--seller-url=... --seller-account-id=... --seller-token-env=...]');
        return;
    }

    const baseUrl = process.env.CHATWOOT_URL;
    const token = process.env.API_ACCESS_TOKEN;
    const mainAccountId = Number(process.env.CHATWOOT_ACCOUNT_ID || 2);

    if (!baseUrl || !token) {
        throw new Error('Faltan CHATWOOT_URL o API_ACCESS_TOKEN en el entorno/.env');
    }

    const flags = getSellerContactFlags();
    const outputPath = path.resolve(
        ROOT,
        argValue('output') || path.join('data', `seller-chatwoot-baseline-${dateStamp()}.json`),
    );

    const directTarget = directSellerTarget();
    const configured = directTarget ? [] : listConfiguredSellers({ requireInbox: false });
    const inspected = directTarget ? [] : inspectConfiguredSellers();

    const mainSnapshot = await snapshotAccount({
        role: 'main',
        source: 'env',
        baseUrl,
        token,
        accountId: mainAccountId,
    });

    const sellerTargets = directTarget
        ? [directTarget]
        : configured.map((config) => ({
            affiliateId: config.affiliateId,
            accountId: Number(config.accountId),
            url: config.url,
            token: config.token,
            source: 'env',
        }));

    const sellerSnapshots = [];
    for (const target of sellerTargets) {
        // Secuencial a propósito: son pocas cuentas y evita ráfagas de API.
        sellerSnapshots.push(await snapshotAccount({
            role: 'seller',
            source: target.source,
            baseUrl: target.url,
            token: target.token,
            accountId: target.accountId,
            affiliateId: target.affiliateId,
        }));
    }

    const snapshot = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        readOnly: true,
        flags: describeSellerContactFlags(flags),
        main: mainSnapshot,
        sellers: sellerSnapshots,
        configuredSellers: inspected,
        allowedSellerAccountIds: [...flags.allowlist],
    };

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

    console.log(`[baseline] Snapshot read-only escrito en ${outputPath}`);
    for (const account of [mainSnapshot, ...sellerSnapshots]) {
        const summary = summarize(account);
        console.log(
            `[baseline] ${summary.role} ${summary.accountId} (${summary.accountName || 'sin nombre'}): `
            + `${summary.fields ?? '?'} campos, ${summary.dashboardApps ?? '?'} apps, `
            + `${summary.webhooks ?? '?'} webhooks, ${summary.automations ?? '?'} automatizaciones, `
            + `${summary.inboxes ?? '?'} inboxes, `
            + `integraciones=${JSON.stringify(summary.integrations)}`,
        );
        if (summary.errors.length > 0) {
            console.warn(`[baseline] ${summary.role} ${summary.accountId} con errores:`, summary.errors);
        }
    }
    if (configured.length === 0 && !directTarget) {
        console.warn('[baseline] No hay Sellers configurados en CHATWOOT_SELLER_<id>_*; solo se snapshotó la cuenta principal.');
    }
}

main().catch((error) => {
    console.error('[baseline] Error:', error.message);
    process.exit(1);
});

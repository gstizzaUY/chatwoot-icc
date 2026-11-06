/**
 * Fase 9 — Provisión completa e idempotente de un Seller.
 *
 * Hace, en orden:
 *   1. copia de campos personalizados;
 *   2. dashboard app "DATOS CONTACTO";
 *   3. webhook inbound conversation_created.
 *
 * Por defecto hace dry-run. Solo escribe con --apply.
 *
 * Uso:
 *   node scripts/provision-seller-full.mjs --affiliate-id=1795
 *   node scripts/provision-seller-full.mjs --affiliate-id=1795 --apply
 *
 * Requisitos:
 *   - Seller presente en CHATWOOT_SELLER_<id>_*;
 *   - cuenta incluida en SELLER_CONTACT_ALLOWLIST;
 *   - SELLER_CONTEXT_SECRET y SELLER_WEBHOOK_SECRET configurados.
 *
 * No toca la cuenta principal. No borra apps, campos ni webhooks.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import {
    getSellerByAffiliateId,
    redactSellerConfig,
} from '../src/services/seller-chatwoot-registry.service.js';
import {
    provisionCustomAttributes,
} from '../src/services/seller-chatwoot-provisioning.service.js';
import {
    buildDashboardAppUrl,
    provisionDashboardApp,
} from '../src/services/seller-chatwoot-dashboard.service.js';
import {
    buildSellerInboundWebhookUrl,
    provisionSellerInboundWebhook,
} from '../src/services/seller-chatwoot-webhook.service.js';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const DEFAULT_FRONTEND_URL = 'https://inchat-app.5vsa59.easypanel.host';
const DEFAULT_BACKEND_URL = 'https://inchat-chatwoot-icc.5vsa59.easypanel.host';

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

function asNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function publicTarget(config) {
    return redactSellerConfig(config);
}

function summarizeFields(result) {
    return {
        dryRun: result.dryRun,
        sourceCount: result.sourceCount,
        targetCountBefore: result.targetCountBefore,
        targetCountAfter: result.targetCountAfter,
        missing: result.plan?.missing?.length || 0,
        existing: result.plan?.existing?.length || 0,
        reserved: result.plan?.reserved?.length || 0,
        drift: result.plan?.drift?.length || 0,
        invalid: result.plan?.invalid?.length || 0,
        created: result.created?.length || 0,
        failed: result.failed?.map((item) => ({
            key: item.definition?.key,
            status: item.status,
            error: item.error,
        })) || [],
    };
}

async function main() {
    if (hasFlag('help')) {
        console.log(
            'Uso: node scripts/provision-seller-full.mjs --affiliate-id=... [--apply] '
            + '[--frontend-url=...] [--backend-url=...] [--title="DATOS CONTACTO"] '
            + '[--skip-fields] [--skip-dashboard] [--skip-webhook]',
        );
        return;
    }

    const affiliateId = asNumber(argValue('affiliate-id'));
    if (!affiliateId) {
        throw new Error('Falta --affiliate-id');
    }

    const config = getSellerByAffiliateId(affiliateId, { onlyAllowed: true });
    if (!config) {
        throw new Error(
            `El Seller ${affiliateId} no está configurado o no está en SELLER_CONTACT_ALLOWLIST`,
        );
    }

    const source = {
        baseUrl: process.env.CHATWOOT_URL,
        token: process.env.API_ACCESS_TOKEN,
        accountId: asNumber(process.env.CHATWOOT_ACCOUNT_ID || 2),
    };
    if (!source.baseUrl || !source.token) {
        throw new Error('Faltan CHATWOOT_URL o API_ACCESS_TOKEN');
    }

    const target = {
        affiliateId: config.affiliateId,
        accountId: asNumber(config.accountId),
        baseUrl: config.url,
        token: config.adminToken || config.token,
    };

    const contextSecret = process.env.SELLER_CONTEXT_SECRET;
    const webhookSecret = process.env.SELLER_WEBHOOK_SECRET;
    if (!contextSecret) {
        throw new Error('SELLER_CONTEXT_SECRET no está configurado');
    }
    if (!webhookSecret) {
        throw new Error('SELLER_WEBHOOK_SECRET no está configurado');
    }

    const dryRun = !hasFlag('apply');
    const frontendUrl = normalizeUrl(argValue('frontend-url') || DEFAULT_FRONTEND_URL);
    const backendUrl = normalizeUrl(argValue('backend-url') || DEFAULT_BACKEND_URL);
    const title = argValue('title') || 'DATOS CONTACTO';
    const legacyTitles = ['RD STATION'];

    const report = {
        generatedAt: new Date().toISOString(),
        mode: dryRun ? 'dry-run' : 'apply',
        target: publicTarget(config),
        title,
        steps: {},
    };

    if (!hasFlag('skip-fields')) {
        const fields = await provisionCustomAttributes({
            source,
            target,
            dryRun,
        });
        report.steps.fields = summarizeFields(fields);
    }

    if (!hasFlag('skip-dashboard')) {
        const dashboardUrl = buildDashboardAppUrl({
            frontendBaseUrl: frontendUrl,
            accountId: target.accountId,
            affiliateId: target.affiliateId,
            contextSecret,
        });
        const dashboard = await provisionDashboardApp({
            target,
            title,
            url: dashboardUrl,
            legacyTitles,
            dryRun,
        });
        report.steps.dashboard = {
            action: dashboard.action,
            actionApplied: dashboard.actionApplied,
            beforeCount: dashboard.beforeCount,
            afterCount: dashboard.afterCount,
            verified: dashboard.verified,
            url: dashboard.url,
            integrationEnabled: dashboard.integrationEnabled,
        };
    }

    if (!hasFlag('skip-webhook')) {
        const webhookUrl = buildSellerInboundWebhookUrl({
            backendBaseUrl: backendUrl,
            secret: webhookSecret,
        });
        const webhook = await provisionSellerInboundWebhook({
            target,
            url: webhookUrl,
            subscriptions: ['conversation_created'],
            dryRun,
        });
        report.steps.webhook = {
            action: webhook.action,
            actionApplied: webhook.actionApplied,
            beforeCount: webhook.beforeCount,
            afterCount: webhook.afterCount,
            verified: webhook.verified,
            url: webhook.url,
        };
    }

    const outputPath = path.resolve(
        ROOT,
        argValue('output') || path.join(
            'data',
            `seller-full-provisioning-${dateStamp()}-affiliate-${affiliateId}.json`,
        ),
    );
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    console.log(`[seller-full] ${dryRun ? 'DRY-RUN' : 'APPLY'} affiliate=${affiliateId} account=${target.accountId}`);
    for (const [step, value] of Object.entries(report.steps)) {
        console.log(`[seller-full] ${step}: ${JSON.stringify(value)}`);
        if (value.failed?.length > 0) {
            process.exitCode = 2;
        }
        if (!dryRun && value.verified === false) {
            process.exitCode = 2;
        }
    }
    console.log(`[seller-full] reporte=${outputPath}`);
}

main().catch((error) => {
    console.error('[seller-full] Error:', error.message);
    process.exit(1);
});

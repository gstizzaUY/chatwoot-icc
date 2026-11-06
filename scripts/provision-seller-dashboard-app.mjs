/**
 * Fase 5 — Provisión de la dashboard app "RD STATION" para un Seller.
 *
 * Por defecto hace dry-run. Solo escribe con --apply.
 *
 * Uso directo:
 *   node scripts/provision-seller-dashboard-app.mjs \
 *     --target-url=https://chatwoot-seller.example.com \
 *     --target-account-id=3 \
 *     --target-affiliate-id=1795 \
 *     --target-token-env=SELLER_TARGET_TOKEN \
 *     --frontend-url=https://inchat-app.example.com
 *
 * El contexto `ctx` se firma con SELLER_CONTEXT_SECRET y no se imprime.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import {
    getSellerByAffiliateId,
} from '../src/services/seller-chatwoot-registry.service.js';
import {
    buildDashboardAppUrl,
    provisionDashboardApp,
    publicDashboardAppUrl,
} from '../src/services/seller-chatwoot-dashboard.service.js';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
dotenv.config({ path: path.join(ROOT, '.env') });

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

function targetFromArgs() {
    const accountId = argValue('target-account-id');
    const url = argValue('target-url');
    const tokenEnv = argValue('target-token-env');
    const affiliateId = argValue('target-affiliate-id');

    // --target-affiliate-id solo no implica target directo: permite resolver
    // el Seller desde el registro/allowlist. El target directo se activa
    // únicamente si se pasó URL, account-id o token-env.
    const hasDirectTarget = Boolean(accountId || url || tokenEnv);
    if (!hasDirectTarget) {
        return null;
    }
    if (!accountId || !url || !tokenEnv || !affiliateId) {
        throw new Error(
            'Para target directo se requieren --target-url, --target-account-id, '
            + '--target-affiliate-id y --target-token-env',
        );
    }

    const token = process.env[tokenEnv];
    if (!token) {
        throw new Error(`La variable ${tokenEnv} no está definida`);
    }

    return {
        affiliateId: asNumber(affiliateId),
        accountId: asNumber(accountId),
        baseUrl: normalizeUrl(url),
        token,
        source: 'cli',
    };
}

function targetFromRegistry() {
    const affiliateId = argValue('target-affiliate-id');
    if (!affiliateId) {
        throw new Error('Indicá --target-affiliate-id o usá los argumentos --target-*');
    }

    const config = getSellerByAffiliateId(affiliateId, { onlyAllowed: true });
    if (!config) {
        throw new Error(
            `El Seller ${affiliateId} no está configurado o no está en SELLER_CONTACT_ALLOWLIST`,
        );
    }

    return {
        affiliateId: config.affiliateId,
        accountId: asNumber(config.accountId),
        baseUrl: config.url,
        token: config.adminToken || config.token,
        source: 'registry',
    };
}

function publicTarget(target) {
    return {
        affiliateId: target.affiliateId,
        accountId: target.accountId,
        baseUrl: target.baseUrl,
        source: target.source,
    };
}

async function main() {
    if (hasFlag('help')) {
        console.log(
            'Uso: node scripts/provision-seller-dashboard-app.mjs '
            + '(--target-url=... --target-account-id=... --target-affiliate-id=... '
            + '--target-token-env=... | --target-affiliate-id=...) '
            + '[--frontend-url=...] [--title="DATOS CONTACTO"] '
            + '[--rename-from="RD STATION"] [--apply]',
        );
        return;
    }

    const target = targetFromArgs() || targetFromRegistry();
    const frontendUrl = normalizeUrl(
        argValue('frontend-url') || 'https://inchat-app.5vsa59.easypanel.host',
    );
    const title = argValue('title') || 'RD STATION';
    const legacyTitles = (argValue('rename-from') || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    const secret = process.env.SELLER_CONTEXT_SECRET;

    if (!secret) {
        throw new Error('SELLER_CONTEXT_SECRET no está configurado');
    }

    const url = buildDashboardAppUrl({
        frontendBaseUrl: frontendUrl,
        accountId: target.accountId,
        affiliateId: target.affiliateId,
        contextSecret: secret,
    });

    const report = await provisionDashboardApp({
        target,
        title,
        url,
        legacyTitles,
        dryRun: !hasFlag('apply'),
    });

    const outputPath = path.resolve(
        ROOT,
        argValue('output') || path.join(
            'data',
            `seller-chatwoot-dashboard-${dateStamp()}-account-${target.accountId}.json`,
        ),
    );
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(
        outputPath,
        `${JSON.stringify({
            generatedAt: new Date().toISOString(),
            mode: report.dryRun ? 'dry-run' : 'apply',
            target: publicTarget(target),
            title,
            publicUrl: report.url,
            publicAppUrl: publicDashboardAppUrl(url),
            integrationEnabled: report.integrationEnabled,
            action: report.action,
            actionApplied: report.actionApplied,
            beforeCount: report.beforeCount,
            afterCount: report.afterCount,
            afterAction: report.afterAction,
            verified: report.verified,
            app: report.app,
        }, null, 2)}\n`,
        'utf8',
    );

    console.log(`[dashboard-app] ${report.dryRun ? 'DRY-RUN' : 'APPLY'} target=${target.accountId}`);
    console.log(`[dashboard-app] title="${title}" action=${report.action} applied=${report.actionApplied}`);
    console.log(`[dashboard-app] integration.dashboard_apps=${report.integrationEnabled}`);
    console.log(`[dashboard-app] before=${report.beforeCount} after=${report.afterCount} verified=${report.verified}`);
    console.log(`[dashboard-app] url=${report.url}`);
    console.log(`[dashboard-app] reporte=${outputPath}`);

    if (!report.dryRun && !report.verified) {
        process.exitCode = 2;
    }
}

main().catch((error) => {
    console.error('[dashboard-app] Error:', error.message);
    process.exit(1);
});

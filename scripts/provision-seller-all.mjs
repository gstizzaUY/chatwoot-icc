/**
 * Fase 9 — Provisión completa de todos los Sellers CONECTADOS.
 *
 * Importante: NO enumera cuentas de Chatwoot. Sólo procesa Sellers declarados
 * en CHATWOOT_SELLER_<id>_* y presentes en SELLER_CONTACT_ALLOWLIST.
 *
 * Uso:
 *   node scripts/provision-seller-all.mjs
 *   node scripts/provision-seller-all.mjs --apply
 *   node scripts/provision-seller-all.mjs --affiliate-id=1795 --apply
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import {
    listAllowedSellers,
} from '../src/services/seller-chatwoot-registry.service.js';
import {
    provisionSellerFull,
} from '../src/services/seller-full-provisioning.service.js';

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

async function main() {
    if (hasFlag('help')) {
        console.log(
            'Uso: node scripts/provision-seller-all.mjs [--apply] '
            + '[--affiliate-id=...] [--frontend-url=...] [--backend-url=...] '
            + '[--skip-fields] [--skip-dashboard] [--skip-webhook] '
            + '[--continue-on-error]',
        );
        return;
    }

    const onlyAffiliateId = argValue('affiliate-id')
        ? asNumber(argValue('affiliate-id'))
        : null;
    const allowed = listAllowedSellers()
        .filter((config) => !onlyAffiliateId || Number(config.affiliateId) === onlyAffiliateId);

    if (allowed.length === 0) {
        throw new Error(
            'No hay Sellers configurados en CHATWOOT_SELLER_* y presentes en '
            + 'SELLER_CONTACT_ALLOWLIST. No se enumeran cuentas de Chatwoot.',
        );
    }

    const dryRun = !hasFlag('apply');
    const continueOnError = hasFlag('continue-on-error');
    const source = {
        baseUrl: process.env.CHATWOOT_URL,
        token: process.env.API_ACCESS_TOKEN,
        accountId: asNumber(process.env.CHATWOOT_ACCOUNT_ID || 2),
    };
    const common = {
        source,
        frontendUrl: normalizeUrl(argValue('frontend-url') || DEFAULT_FRONTEND_URL),
        backendUrl: normalizeUrl(argValue('backend-url') || DEFAULT_BACKEND_URL),
        title: argValue('title') || 'DATOS CONTACTO',
        contextSecret: process.env.SELLER_CONTEXT_SECRET,
        webhookSecret: process.env.SELLER_WEBHOOK_SECRET,
        dryRun,
        skipFields: hasFlag('skip-fields'),
        skipDashboard: hasFlag('skip-dashboard'),
        skipWebhook: hasFlag('skip-webhook'),
    };

    console.log(
        `[seller-all] ${dryRun ? 'DRY-RUN' : 'APPLY'} sellers=${allowed.length}: `
        + allowed.map((config) => `${config.affiliateId}->${config.accountId}`).join(', '),
    );

    const results = [];
    for (const config of allowed) {
        try {
            const report = await provisionSellerFull({
                ...common,
                affiliateId: config.affiliateId,
            });
            results.push({ affiliateId: config.affiliateId, accountId: config.accountId, report });
            console.log(
                `[seller-all] ${config.affiliateId}->${config.accountId}: ${JSON.stringify(report.steps)}`,
            );
        } catch (error) {
            results.push({
                affiliateId: config.affiliateId,
                accountId: config.accountId,
                error: error.message,
            });
            console.error(
                `[seller-all] ${config.affiliateId}->${config.accountId}: ${error.message}`,
            );
            if (!continueOnError) {
                break;
            }
        }
    }

    const outputPath = path.resolve(
        ROOT,
        argValue('output') || path.join(
            'data',
            `seller-full-provisioning-all-${dateStamp()}.json`,
        ),
    );
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(
        outputPath,
        `${JSON.stringify({
            generatedAt: new Date().toISOString(),
            mode: dryRun ? 'dry-run' : 'apply',
            sellers: results,
        }, null, 2)}\n`,
        'utf8',
    );

    const failed = results.filter((item) => (
        item.error
        || item.report?.steps?.fields?.failed?.length > 0
        || (!dryRun && Object.values(item.report?.steps || {}).some((step) => step.verified === false))
    ));
    console.log(`[seller-all] reporte=${outputPath}`);
    if (failed.length > 0) {
        console.error(`[seller-all] Sellers con errores: ${failed.length}`);
        process.exitCode = 2;
    }
}

main().catch((error) => {
    console.error('[seller-all] Error:', error.message);
    process.exit(1);
});

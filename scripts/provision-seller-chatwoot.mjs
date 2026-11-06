/**
 * Fase 2 — CLI de provisión de campos personalizados.
 *
 * Por defecto hace dry-run. Para escribir hay que pasar --apply.
 *
 * Uso con una cuenta directa (sin depender de CHATWOOT_SELLER_*):
 *   node scripts/provision-seller-chatwoot.mjs \
 *     --target-url=https://chatwoot-seller.example.com \
 *     --target-account-id=3 \
 *     --target-token-env=SELLER_TARGET_TOKEN \
 *     --dry-run
 *
 * Uso con la allowlist del registro:
 *   node scripts/provision-seller-chatwoot.mjs --target-affiliate-id=34 --apply
 *
 * El token se lee de una variable de entorno y nunca se imprime.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import {
    listAllowedSellers,
    getSellerByAffiliateId,
} from '../src/services/seller-chatwoot-registry.service.js';
import {
    provisionCustomAttributes,
} from '../src/services/seller-chatwoot-provisioning.service.js';

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
    const targetAccountId = argValue('target-account-id');
    const targetUrl = argValue('target-url');
    const targetTokenEnv = argValue('target-token-env');

    if (!targetAccountId && !targetUrl && !targetTokenEnv) {
        return null;
    }
    if (!targetAccountId || !targetUrl || !targetTokenEnv) {
        throw new Error('Para target directo se requieren --target-url, --target-account-id y --target-token-env');
    }

    const token = process.env[targetTokenEnv];
    if (!token) {
        throw new Error(`La variable ${targetTokenEnv} no está definida`);
    }

    return {
        affiliateId: argValue('target-affiliate-id') ? asNumber(argValue('target-affiliate-id')) : null,
        accountId: asNumber(targetAccountId),
        baseUrl: normalizeUrl(targetUrl),
        token,
        source: 'cli',
    };
}

function targetFromRegistry() {
    const affiliateId = argValue('target-affiliate-id');

    if (affiliateId) {
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

    const allowed = listAllowedSellers();
    if (allowed.length === 0) {
        throw new Error(
            'No hay Sellers en la allowlist. Usá --target-* para una cuenta directa '
            + 'o configurá SELLER_CONTACT_ALLOWLIST.',
        );
    }
    if (allowed.length > 1) {
        throw new Error(
            'Hay más de un Seller en la allowlist. Indicá --target-affiliate-id para elegir uno.',
        );
    }

    const config = allowed[0];
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

function publicReport(report, target) {
    return {
        generatedAt: new Date().toISOString(),
        mode: report.dryRun ? 'dry-run' : 'apply',
        sourceAccountId: report.sourceAccountId,
        target: publicTarget(target),
        sourceCount: report.sourceCount,
        scopedSourceCount: report.scopedSourceCount,
        targetCountBefore: report.targetCountBefore,
        targetCountAfter: report.targetCountAfter,
        missing: report.plan.missing,
        existing: report.plan.existing,
        reserved: report.plan.reserved,
        drift: report.plan.drift,
        invalid: report.plan.invalid,
        created: report.created,
        failed: report.failed,
    };
}

async function main() {
    if (hasFlag('help')) {
        console.log(
            'Uso: node scripts/provision-seller-chatwoot.mjs '
            + '[--target-url=... --target-account-id=... --target-token-env=...] '
            + '[--target-affiliate-id=...] [--only-key=tiene_ichef] [--apply]',
        );
        return;
    }

    const source = {
        baseUrl: process.env.CHATWOOT_URL,
        token: process.env.API_ACCESS_TOKEN,
        accountId: asNumber(process.env.CHATWOOT_ACCOUNT_ID || 2),
    };

    if (!source.baseUrl || !source.token) {
        throw new Error('Faltan CHATWOOT_URL o API_ACCESS_TOKEN en el entorno/.env');
    }

    const target = targetFromArgs() || targetFromRegistry();
    const dryRun = !hasFlag('apply');
    const onlyKeys = argValue('only-key')
        ? [argValue('only-key')]
        : [];
    const delayMs = hasFlag('apply')
        ? Math.max(0, asNumber(argValue('delay-ms'), 100))
        : 0;

    const report = await provisionCustomAttributes({
        source,
        target,
        dryRun,
        onlyKeys,
        delayMs,
    });

    const outputPath = path.resolve(
        ROOT,
        argValue('output') || path.join(
            'data',
            `seller-chatwoot-provisioning-${dateStamp()}-account-${target.accountId}.json`,
        ),
    );
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(
        outputPath,
        `${JSON.stringify(publicReport(report, target), null, 2)}\n`,
        'utf8',
    );

    const mode = report.dryRun ? 'DRY-RUN' : 'APPLY';
    console.log(`[provision] ${mode} source=${report.sourceAccountId} target=${target.accountId}`);
    console.log(
        `[provision] source=${report.sourceCount}, target-before=${report.targetCountBefore}, `
        + `missing=${report.plan.missing.length}, existing=${report.plan.existing.length}, `
        + `reserved=${report.plan.reserved.length}, drift=${report.plan.drift.length}, `
        + `invalid=${report.plan.invalid.length}`,
    );
    if (report.created.length > 0) {
        console.log(`[provision] creados=${report.created.length}`);
    }
    if (report.failed.length > 0) {
        console.warn(`[provision] fallidos=${report.failed.length}`);
        for (const failure of report.failed) {
            console.warn(
                `[provision]   ${failure.definition.key}: HTTP ${failure.status || '?'} ${failure.error}`,
            );
        }
    }
    console.log(`[provision] target-after=${report.targetCountAfter}`);
    console.log(`[provision] reporte=${outputPath}`);

    if (report.failed.length > 0) {
        process.exitCode = 2;
    }
}

main().catch((error) => {
    console.error('[provision] Error:', error.message);
    process.exit(1);
});

/**
 * Crea las definiciones LS en la cuenta central y en los Sellers permitidos.
 *
 * Por defecto hace dry-run. Para escribir: --apply.
 *
 * Uso:
 *   node scripts/provision-ls-attributes.mjs
 *   node scripts/provision-ls-attributes.mjs --apply
 *   node scripts/provision-ls-attributes.mjs --sellers-only --apply
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import {
    listAllowedSellers,
    redactSellerConfig,
} from '../src/services/seller-chatwoot-registry.service.js';
import {
    provisionLsAttributes,
} from '../src/services/ls-attributes-provisioning.service.js';

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

function asNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function dateStamp() {
    return new Date().toISOString().slice(0, 10);
}

async function main() {
    if (hasFlag('help')) {
        console.log(
            'Uso: node scripts/provision-ls-attributes.mjs [--apply] '
            + '[--central-only | --sellers-only] [--affiliate-id=...]',
        );
        return;
    }

    const dryRun = !hasFlag('apply');
    const centralOnly = hasFlag('central-only');
    const sellersOnly = hasFlag('sellers-only');
    const onlyAffiliateId = argValue('affiliate-id')
        ? asNumber(argValue('affiliate-id'))
        : null;

    const targets = [];

    if (!sellersOnly) {
        const baseUrl = process.env.CHATWOOT_URL;
        const token = process.env.API_ACCESS_TOKEN;
        const accountId = asNumber(process.env.CHATWOOT_ACCOUNT_ID || 2);
        if (!baseUrl || !token) {
            throw new Error('Faltan CHATWOOT_URL o API_ACCESS_TOKEN');
        }
        targets.push({
            label: 'central',
            target: { baseUrl, token, accountId },
            public: { accountId, role: 'central' },
        });
    }

    if (!centralOnly) {
        const sellers = listAllowedSellers()
            .filter((config) => !onlyAffiliateId || Number(config.affiliateId) === onlyAffiliateId);
        for (const config of sellers) {
            targets.push({
                label: `seller-${config.affiliateId}`,
                target: {
                    baseUrl: config.url,
                    token: config.adminToken || config.token,
                    accountId: config.accountId,
                },
                public: redactSellerConfig(config),
            });
        }
    }

    if (targets.length === 0) {
        throw new Error('No hay targets para provisionar');
    }

    const reports = [];
    for (const entry of targets) {
        try {
            const report = await provisionLsAttributes({
                target: entry.target,
                dryRun,
            });
            reports.push({ label: entry.label, target: entry.public, report });
            console.log(
                `[ls-attributes] ${entry.label} account=${entry.target.accountId} `
                + `missing=${report.missing.length} created=${report.created.length} `
                + `verified=${report.verified}`,
            );
            if (report.failed.length > 0) {
                console.error(
                    `[ls-attributes] ${entry.label} fallidos=${JSON.stringify(report.failed)}`,
                );
            }
        } catch (error) {
            reports.push({ label: entry.label, target: entry.public, error: error.message });
            console.error(`[ls-attributes] ${entry.label} Error: ${error.message}`);
            if (!hasFlag('continue-on-error')) {
                break;
            }
        }
    }

    const outputPath = path.resolve(
        ROOT,
        argValue('output') || path.join(
            'data',
            `ls-attributes-provisioning-${dateStamp()}.json`,
        ),
    );
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(
        outputPath,
        `${JSON.stringify({
            generatedAt: new Date().toISOString(),
            mode: dryRun ? 'dry-run' : 'apply',
            reports,
        }, null, 2)}\n`,
        'utf8',
    );
    console.log(`[ls-attributes] reporte=${outputPath}`);

    if (reports.some((item) => item.error || item.report?.failed?.length > 0)) {
        process.exitCode = 2;
    }
}

main().catch((error) => {
    console.error('[ls-attributes] Error:', error.message);
    process.exit(1);
});

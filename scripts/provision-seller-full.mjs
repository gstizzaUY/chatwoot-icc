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

    const source = {
        baseUrl: process.env.CHATWOOT_URL,
        token: process.env.API_ACCESS_TOKEN,
        accountId: asNumber(process.env.CHATWOOT_ACCOUNT_ID || 2),
    };

    const report = await provisionSellerFull({
        affiliateId,
        source,
        frontendUrl: normalizeUrl(argValue('frontend-url') || DEFAULT_FRONTEND_URL),
        backendUrl: normalizeUrl(argValue('backend-url') || DEFAULT_BACKEND_URL),
        title: argValue('title') || 'DATOS CONTACTO',
        contextSecret: process.env.SELLER_CONTEXT_SECRET,
        webhookSecret: process.env.SELLER_WEBHOOK_SECRET,
        dryRun: !hasFlag('apply'),
        skipFields: hasFlag('skip-fields'),
        skipDashboard: hasFlag('skip-dashboard'),
        skipWebhook: hasFlag('skip-webhook'),
    });

    const outputPath = path.resolve(
        ROOT,
        argValue('output') || path.join(
            'data',
            `seller-full-provisioning-${dateStamp()}-affiliate-${affiliateId}.json`,
        ),
    );
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    console.log(`[seller-full] ${report.mode.toUpperCase()} affiliate=${affiliateId} account=${report.target.accountId}`);
    for (const [step, value] of Object.entries(report.steps)) {
        console.log(`[seller-full] ${step}: ${JSON.stringify(value)}`);
        if (value.failed?.length > 0) {
            process.exitCode = 2;
        }
        if (report.mode === 'apply' && value.verified === false) {
            process.exitCode = 2;
        }
    }
    console.log(`[seller-full] reporte=${outputPath}`);
}

main().catch((error) => {
    console.error('[seller-full] Error:', error.message);
    process.exit(1);
});

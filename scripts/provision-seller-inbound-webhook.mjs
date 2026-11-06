/**
 * Fase 6 — Provisión del webhook inbound de un Seller.
 *
 * Por defecto hace dry-run. Solo escribe con --apply.
 *
 * Uso:
 *   node scripts/provision-seller-inbound-webhook.mjs --target-affiliate-id=1795
 *   node scripts/provision-seller-inbound-webhook.mjs --target-affiliate-id=1795 --apply
 *
 * El secreto se toma de SELLER_WEBHOOK_SECRET y no se imprime.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import {
    getSellerByAffiliateId,
    listAllowedSellers,
} from '../src/services/seller-chatwoot-registry.service.js';
import {
    buildSellerInboundWebhookUrl,
    provisionSellerInboundWebhook,
} from '../src/services/seller-chatwoot-webhook.service.js';

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

function parseSubscriptions(value) {
    const parsed = String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    return parsed.length > 0 ? parsed : ['conversation_created'];
}

function targetFromArgs() {
    const accountId = argValue('target-account-id');
    const url = argValue('target-url');
    const tokenEnv = argValue('target-token-env');
    const affiliateId = argValue('target-affiliate-id');
    const hasDirectTarget = Boolean(accountId || url || tokenEnv);

    if (hasDirectTarget) {
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
        throw new Error('No hay Sellers en la allowlist');
    }
    if (allowed.length > 1) {
        throw new Error('Hay más de un Seller en la allowlist; indicá --target-affiliate-id');
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

async function main() {
    if (hasFlag('help')) {
        console.log(
            'Uso: node scripts/provision-seller-inbound-webhook.mjs '
            + '[--target-affiliate-id=1795] '
            + '[--target-url=... --target-account-id=... --target-token-env=...] '
            + '[--backend-url=...] [--subscriptions=conversation_created] [--apply]',
        );
        return;
    }

    const secret = process.env.SELLER_WEBHOOK_SECRET;
    if (!secret) {
        throw new Error('SELLER_WEBHOOK_SECRET no está configurado');
    }

    const target = targetFromArgs();
    const backendUrl = normalizeUrl(
        argValue('backend-url') || 'https://inchat-chatwoot-icc.5vsa59.easypanel.host',
    );
    const subscriptions = parseSubscriptions(argValue('subscriptions'));
    const webhookUrl = buildSellerInboundWebhookUrl({
        backendBaseUrl: backendUrl,
        secret,
    });

    const report = await provisionSellerInboundWebhook({
        target,
        url: webhookUrl,
        subscriptions,
        dryRun: !hasFlag('apply'),
    });

    const outputPath = path.resolve(
        ROOT,
        argValue('output') || path.join(
            'data',
            `seller-inbound-webhook-${dateStamp()}-account-${target.accountId}.json`,
        ),
    );
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(
        outputPath,
        `${JSON.stringify({
            generatedAt: new Date().toISOString(),
            mode: report.dryRun ? 'dry-run' : 'apply',
            target: publicTarget(target),
            action: report.action,
            actionApplied: report.actionApplied,
            beforeCount: report.beforeCount,
            afterCount: report.afterCount,
            verified: report.verified,
            url: report.url,
            webhook: report.webhook,
            afterAction: report.afterAction,
            subscriptions,
        }, null, 2)}\n`,
        'utf8',
    );

    console.log(`[seller-webhook] ${report.dryRun ? 'DRY-RUN' : 'APPLY'} target=${target.accountId}`);
    console.log(`[seller-webhook] action=${report.action} applied=${report.actionApplied}`);
    console.log(`[seller-webhook] subscriptions=${subscriptions.join(',')}`);
    console.log(`[seller-webhook] before=${report.beforeCount} after=${report.afterCount} verified=${report.verified}`);
    console.log(`[seller-webhook] url=${report.url}`);
    console.log(`[seller-webhook] reporte=${outputPath}`);

    if (!report.dryRun && !report.verified) {
        process.exitCode = 2;
    }
}

main().catch((error) => {
    console.error('[seller-webhook] Error:', error.message);
    process.exit(1);
});

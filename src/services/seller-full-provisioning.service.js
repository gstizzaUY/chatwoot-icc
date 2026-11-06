import {
    getSellerByAffiliateId,
    redactSellerConfig,
} from './seller-chatwoot-registry.service.js';
import {
    provisionCustomAttributes,
} from './seller-chatwoot-provisioning.service.js';
import {
    buildDashboardAppUrl,
    provisionDashboardApp,
} from './seller-chatwoot-dashboard.service.js';
import {
    buildSellerInboundWebhookUrl,
    provisionSellerInboundWebhook,
} from './seller-chatwoot-webhook.service.js';

/**
 * Orquestador de provisión completa de un Seller.
 *
 * Sólo acepta Sellers configurados en el entorno Y presentes en
 * SELLER_CONTACT_ALLOWLIST. Nunca enumera cuentas de Chatwoot.
 */

export function summarizeFields(result) {
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

function asNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

export async function provisionSellerFull({
    affiliateId,
    source,
    frontendUrl,
    backendUrl,
    title = 'DATOS CONTACTO',
    legacyTitles = ['RD STATION'],
    contextSecret,
    webhookSecret,
    dryRun = true,
    skipFields = false,
    skipDashboard = false,
    skipWebhook = false,
} = {}) {
    const id = asNumber(affiliateId);
    if (!id) {
        throw new Error('Falta affiliateId');
    }

    const config = getSellerByAffiliateId(id, { onlyAllowed: true });
    if (!config) {
        throw new Error(
            `El Seller ${id} no está configurado o no está en SELLER_CONTACT_ALLOWLIST`,
        );
    }

    if (!source?.baseUrl || !source?.token) {
        throw new Error('Faltan CHATWOOT_URL o API_ACCESS_TOKEN');
    }
    if (!contextSecret) {
        throw new Error('SELLER_CONTEXT_SECRET no está configurado');
    }
    if (!webhookSecret) {
        throw new Error('SELLER_WEBHOOK_SECRET no está configurado');
    }

    const target = {
        affiliateId: config.affiliateId,
        accountId: asNumber(config.accountId),
        baseUrl: config.url,
        token: config.adminToken || config.token,
    };

    const report = {
        generatedAt: new Date().toISOString(),
        mode: dryRun ? 'dry-run' : 'apply',
        target: redactSellerConfig(config),
        title,
        steps: {},
    };

    if (!skipFields) {
        const fields = await provisionCustomAttributes({
            source,
            target,
            dryRun,
        });
        report.steps.fields = summarizeFields(fields);
    }

    if (!skipDashboard) {
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

    if (!skipWebhook) {
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

    return report;
}

export default {
    summarizeFields,
    provisionSellerFull,
};

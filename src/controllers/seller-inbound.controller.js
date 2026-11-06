import {
    SellerChatwootRegistryError,
    assertSellerAccountAllowed,
} from '../services/seller-chatwoot-registry.service.js';
import {
    isSellerInboundEnabled,
} from '../services/seller-contact-flags.service.js';
import {
    extractInboundAccountId,
    processSellerInbound,
    secureCompare,
} from '../services/seller-inbound.service.js';

/**
 * POST /api/v2/webhooks/chatwoot/seller-inbound?token=...
 *
 * Webhook account-aware para conversaciones entrantes de un Seller.
 * El token del query se configura en la URL del webhook de Chatwoot.
 */

function expectedToken() {
    return process.env.SELLER_WEBHOOK_SECRET || '';
}

function respondError(res, status, code, message) {
    return res.status(status).json({
        success: false,
        error: { code, message },
    });
}

export async function sellerInbound(req, res) {
    const expected = expectedToken();
    if (!expected) {
        return respondError(
            res,
            503,
            'SELLER_WEBHOOK_SECRET_MISSING',
            'El webhook de Seller no está configurado',
        );
    }

    const provided = req.query?.token || req.headers['x-seller-webhook-token'];
    if (!secureCompare(provided, expected)) {
        return respondError(res, 401, 'INVALID_SELLER_WEBHOOK_TOKEN', 'Token de webhook inválido');
    }

    const payload = req.body || {};
    if (payload.event !== 'conversation_created') {
        return res.status(202).json({
            success: true,
            ignored: 'unsupported_event',
        });
    }

    const accountId = extractInboundAccountId(payload);
    if (!accountId) {
        return res.status(202).json({
            success: true,
            ignored: 'account_missing',
        });
    }

    if (!isSellerInboundEnabled(accountId)) {
        return res.status(202).json({
            success: true,
            ignored: 'seller_inbound_disabled',
        });
    }

    let config;
    try {
        config = assertSellerAccountAllowed({ accountId });
    } catch (error) {
        if (error instanceof SellerChatwootRegistryError) {
            return respondError(res, error.status || 403, error.code, error.message);
        }
        throw error;
    }

    // Responder rápido a Chatwoot y procesar RD en background. El procesamiento
    // es idempotente por email/teléfono, así que un reintento no duplica.
    res.status(202).json({
        success: true,
        accepted: true,
    });

    setImmediate(async () => {
        try {
            const result = await processSellerInbound({ payload, config });
            const safeResult = { ...result };
            delete safeResult.email;
            console.log('[seller-inbound]', JSON.stringify({
                accountId,
                affiliateId: config.affiliateId,
                ...safeResult,
            }));
        } catch (error) {
            console.error(
                `[seller-inbound] Error procesando cuenta ${accountId}:`,
                error.message,
            );
        }
    });
}

export default {
    sellerInbound,
};

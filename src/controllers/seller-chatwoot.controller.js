import {
    SellerContextError,
    assertSellerContextFor,
} from '../services/seller-context.service.js';
import {
    SellerContactError,
    updateSellerContact,
} from '../services/seller-contact.service.js';
import {
    SellerChatwootRegistryError,
} from '../services/seller-chatwoot-registry.service.js';

/**
 * POST /api/v2/seller-chatwoot/contact
 *
 * Endpoint aislado para la pestaña Contacto de un Seller. No reemplaza el
 * endpoint histórico /api/conversations/update-contact de iChef central.
 */

const CONTEXT_FIELDS = new Set([
    'seller_account_id',
    'seller_affiliate_id',
    'ctx',
    'contact_id',
    'conversation_id',
]);

function asNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function publishError(res, error) {
    if (
        error instanceof SellerContextError
        || error instanceof SellerContactError
        || error instanceof SellerChatwootRegistryError
    ) {
        return res.status(error.status || 400).json({
            success: false,
            error: {
                code: error.code,
                message: error.message,
                ...(error.details ? { details: error.details } : {}),
            },
        });
    }

    console.error('[seller-chatwoot] Error inesperado:', error.message);
    return res.status(500).json({
        success: false,
        error: {
            code: 'SELLER_CONTACT_INTERNAL_ERROR',
            message: 'Error interno actualizando el contacto del Seller',
        },
    });
}

export async function updateSellerContactController(req, res) {
    try {
        const body = req.body || {};
        const accountId = asNumber(body.seller_account_id);
        const affiliateId = asNumber(body.seller_affiliate_id);

        if (!accountId || !affiliateId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'MISSING_SELLER_CONTEXT',
                    message: 'seller_account_id y seller_affiliate_id son obligatorios',
                },
            });
        }

        assertSellerContextFor({
            token: body.ctx,
            accountId,
            affiliateId,
        });

        const contactData = Object.fromEntries(
            Object.entries(body).filter(([key]) => !CONTEXT_FIELDS.has(key)),
        );

        const result = await updateSellerContact({
            accountId,
            affiliateId,
            contactId: body.contact_id,
            contactData,
        });

        return res.status(200).json({
            success: true,
            sellerAccountId: result.sellerAccountId,
            sellerAffiliateId: result.sellerAffiliateId,
            contactId: result.contactId,
            rdUpdated: result.rdUpdated,
            chatwootUpdated: result.chatwootUpdated,
            updatedFields: result.updatedFields,
        });
    } catch (error) {
        return publishError(res, error);
    }
}

export default {
    updateSellerContactController,
};

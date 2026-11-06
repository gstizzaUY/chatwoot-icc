import crypto from 'node:crypto';

/**
 * Contexto firmado para el dashboard app del Seller.
 *
 * El iframe no debe poder cambiar `seller_account_id` y actualizar otra cuenta.
 * El token es estático (vive en la URL del dashboard app), pero está acotado a
 * una cuenta/afiliado y firmado con SELLER_CONTEXT_SECRET.
 *
 * Formato:
 *   v1.<payload-base64url>.<hmac-base64url>
 */

const VERSION = 'v1';
const MAX_TOKEN_LENGTH = 4096;

export class SellerContextError extends Error {
    constructor(code, message, status = 401) {
        super(message);
        this.name = 'SellerContextError';
        this.code = code;
        this.status = status;
    }
}

function asNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function asString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
}

function secretOrDefault(secret) {
    const value = asString(secret || process.env.SELLER_CONTEXT_SECRET);
    if (!value) {
        throw new SellerContextError(
            'SELLER_CONTEXT_SECRET_MISSING',
            'SELLER_CONTEXT_SECRET no está configurado',
            503,
        );
    }
    return value;
}

function signatureFor(secret, encodedPayload) {
    return crypto
        .createHmac('sha256', secret)
        .update(`${VERSION}.${encodedPayload}`)
        .digest('base64url');
}

function payloadFor({ accountId, affiliateId }) {
    return {
        v: 1,
        accountId: asNumber(accountId),
        affiliateId: asNumber(affiliateId),
        iat: Math.floor(Date.now() / 1000),
    };
}

export function signSellerContext({ accountId, affiliateId }, { secret } = {}) {
    const id = asNumber(accountId);
    const sellerId = asNumber(affiliateId);
    if (!id || !sellerId) {
        throw new SellerContextError(
            'INVALID_SELLER_CONTEXT',
            'accountId y affiliateId deben ser numéricos',
            400,
        );
    }

    const encodedPayload = Buffer
        .from(JSON.stringify(payloadFor({ accountId: id, affiliateId: sellerId })))
        .toString('base64url');
    const signature = signatureFor(secretOrDefault(secret), encodedPayload);

    return `${VERSION}.${encodedPayload}.${signature}`;
}

export function verifySellerContext(token, { secret, maxAgeSeconds = null, now = Date.now() } = {}) {
    const rawToken = asString(token);
    if (!rawToken || rawToken.length > MAX_TOKEN_LENGTH) {
        throw new SellerContextError('INVALID_SELLER_CONTEXT', 'Contexto de Seller inválido');
    }

    const parts = rawToken.split('.');
    if (parts.length !== 3 || parts[0] !== VERSION) {
        throw new SellerContextError('INVALID_SELLER_CONTEXT', 'Formato de contexto inválido');
    }

    const [, encodedPayload, providedSignature] = parts;
    const expectedSignature = signatureFor(secretOrDefault(secret), encodedPayload);
    const providedBuffer = Buffer.from(providedSignature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (
        providedBuffer.length !== expectedBuffer.length
        || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
        throw new SellerContextError('INVALID_SELLER_CONTEXT', 'Firma de contexto inválida');
    }

    let payload;
    try {
        payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    } catch {
        throw new SellerContextError('INVALID_SELLER_CONTEXT', 'Payload de contexto inválido');
    }

    const accountId = asNumber(payload?.accountId);
    const affiliateId = asNumber(payload?.affiliateId);
    const issuedAt = asNumber(payload?.iat);

    if (!accountId || !affiliateId) {
        throw new SellerContextError('INVALID_SELLER_CONTEXT', 'Contexto sin cuenta o afiliado');
    }

    if (maxAgeSeconds && issuedAt) {
        const ageSeconds = (Number(now) - issuedAt * 1000) / 1000;
        if (ageSeconds > maxAgeSeconds) {
            throw new SellerContextError('EXPIRED_SELLER_CONTEXT', 'Contexto de Seller expirado');
        }
    }

    return {
        accountId,
        affiliateId,
        issuedAt: issuedAt || null,
    };
}

export function assertSellerContextFor({ token, accountId, affiliateId, secret, maxAgeSeconds } = {}) {
    const context = verifySellerContext(token, { secret, maxAgeSeconds });

    if (Number(context.accountId) !== Number(accountId)) {
        throw new SellerContextError(
            'SELLER_ACCOUNT_MISMATCH',
            'El contexto no corresponde a seller_account_id',
            403,
        );
    }

    if (Number(context.affiliateId) !== Number(affiliateId)) {
        throw new SellerContextError(
            'SELLER_AFFILIATE_MISMATCH',
            'El contexto no corresponde a seller_affiliate_id',
            403,
        );
    }

    return context;
}

export default {
    SellerContextError,
    signSellerContext,
    verifySellerContext,
    assertSellerContextFor,
};

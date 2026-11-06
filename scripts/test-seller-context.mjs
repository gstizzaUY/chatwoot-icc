import assert from 'node:assert/strict';

import {
    SellerContextError,
    assertSellerContextFor,
    signSellerContext,
    verifySellerContext,
} from '../src/services/seller-context.service.js';

const secret = 'test-seller-context-secret';
const token = signSellerContext({ accountId: 3, affiliateId: 34 }, { secret });

const parsed = verifySellerContext(token, { secret });
assert.equal(parsed.accountId, 3);
assert.equal(parsed.affiliateId, 34);

assert.doesNotThrow(() => assertSellerContextFor({
    token,
    accountId: 3,
    affiliateId: 34,
    secret,
}));

assert.throws(
    () => assertSellerContextFor({ token, accountId: 4, affiliateId: 34, secret }),
    (error) => error instanceof SellerContextError && error.code === 'SELLER_ACCOUNT_MISMATCH',
);
assert.throws(
    () => assertSellerContextFor({ token, accountId: 3, affiliateId: 35, secret }),
    (error) => error instanceof SellerContextError && error.code === 'SELLER_AFFILIATE_MISMATCH',
);

const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
assert.throws(
    () => verifySellerContext(tampered, { secret }),
    (error) => error instanceof SellerContextError && error.code === 'INVALID_SELLER_CONTEXT',
);

assert.throws(
    () => verifySellerContext(token, { secret: 'wrong-secret' }),
    (error) => error instanceof SellerContextError && error.code === 'INVALID_SELLER_CONTEXT',
);

assert.throws(
    () => signSellerContext({ accountId: 3, affiliateId: 34 }, { secret: '' }),
    (error) => error instanceof SellerContextError && error.code === 'SELLER_CONTEXT_SECRET_MISSING',
);

const expired = signSellerContext(
    { accountId: 3, affiliateId: 34 },
    { secret },
);
assert.throws(
    () => verifySellerContext(expired, {
        secret,
        maxAgeSeconds: 1,
        now: Date.now() + 5000,
    }),
    (error) => error instanceof SellerContextError && error.code === 'EXPIRED_SELLER_CONTEXT',
);

console.log('Seller context tests: OK');

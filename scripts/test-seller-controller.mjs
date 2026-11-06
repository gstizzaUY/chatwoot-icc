import assert from 'node:assert/strict';

process.env.SELLER_CONTEXT_SECRET = 'test-controller-context-secret';
process.env.SELLER_CONTACT_ALLOWLIST = '';
process.env.SELLER_CONTACT_SYNC_MODE = 'off';
process.env.SELLER_INBOUND_ENABLED = 'false';

const { signSellerContext } = await import('../src/services/seller-context.service.js');
const { updateSellerContactController } = await import('../src/controllers/seller-chatwoot.controller.js');

function response() {
    return {
        statusCode: null,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
    };
}

async function call(body) {
    const res = response();
    await updateSellerContactController({ body }, res);
    return res;
}

const token = signSellerContext({ accountId: 3, affiliateId: 34 });

let res = await call({
    seller_account_id: 3,
    seller_affiliate_id: 34,
    ctx: token,
    email: 'cliente@example.test',
});
assert.equal(res.statusCode, 403);
assert.equal(res.body.success, false);
assert.equal(res.body.error.code, 'SELLER_CONTACT_SYNC_DISABLED');
assert.equal(res.body.error.details, undefined);

res = await call({
    seller_account_id: 3,
    seller_affiliate_id: 34,
    ctx: 'token-invalido',
    email: 'cliente@example.test',
});
assert.equal(res.statusCode, 401);
assert.equal(res.body.error.code, 'INVALID_SELLER_CONTEXT');

res = await call({
    seller_account_id: 3,
    seller_affiliate_id: 34,
    ctx: token,
});
assert.equal(res.statusCode, 403);
assert.equal(res.body.error.code, 'SELLER_CONTACT_SYNC_DISABLED');

res = await call({
    seller_account_id: 3,
    ctx: token,
    email: 'cliente@example.test',
});
assert.equal(res.statusCode, 400);
assert.equal(res.body.error.code, 'MISSING_SELLER_CONTEXT');

// Con flags habilitados pero sin configuración de Seller, debe fallar cerrado
// antes de tocar cualquier API externa.
process.env.SELLER_CONTACT_ALLOWLIST = '3';
process.env.SELLER_CONTACT_SYNC_MODE = 'seller_only';
res = await call({
    seller_account_id: 3,
    seller_affiliate_id: 34,
    ctx: token,
    email: 'cliente@example.test',
});
assert.equal(res.statusCode, 404);
assert.equal(res.body.error.code, 'SELLER_ACCOUNT_NOT_CONFIGURED');

console.log('Seller controller tests: OK');

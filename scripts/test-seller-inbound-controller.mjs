import assert from 'node:assert/strict';

process.env.SELLER_WEBHOOK_SECRET = 'test-webhook-controller-secret';
process.env.SELLER_INBOUND_ENABLED = 'false';
process.env.SELLER_CONTACT_ALLOWLIST = '3';

const { sellerInbound } = await import('../src/controllers/seller-inbound.controller.js');

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

async function call({ token, payload }) {
    const res = response();
    await sellerInbound({
        query: token === undefined ? {} : { token },
        headers: {},
        body: payload,
    }, res);
    return res;
}

let res = await call({
    token: 'wrong',
    payload: { event: 'conversation_created', account: { id: 3 } },
});
assert.equal(res.statusCode, 401);
assert.equal(res.body.error.code, 'INVALID_SELLER_WEBHOOK_TOKEN');

res = await call({
    token: process.env.SELLER_WEBHOOK_SECRET,
    payload: { event: 'message_created', account: { id: 3 } },
});
assert.equal(res.statusCode, 202);
assert.equal(res.body.ignored, 'unsupported_event');

res = await call({
    token: process.env.SELLER_WEBHOOK_SECRET,
    payload: { event: 'conversation_created', account: { id: 3 } },
});
assert.equal(res.statusCode, 202);
assert.equal(res.body.ignored, 'seller_inbound_disabled');

console.log('Seller inbound controller tests: OK');

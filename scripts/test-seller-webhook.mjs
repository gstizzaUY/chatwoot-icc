import assert from 'node:assert/strict';

import {
    buildSellerInboundWebhookUrl,
    planSellerWebhook,
    provisionSellerInboundWebhook,
    publicWebhookUrl,
} from '../src/services/seller-chatwoot-webhook.service.js';

const secret = 'test-webhook-secret';
const url = buildSellerInboundWebhookUrl({
    backendBaseUrl: 'https://hub.example.test/',
    secret,
});
const parsed = new URL(url);
assert.equal(parsed.origin, 'https://hub.example.test');
assert.equal(parsed.pathname, '/api/v2/webhooks/chatwoot/seller-inbound');
assert.equal(parsed.searchParams.get('token'), secret);
assert.equal(publicWebhookUrl(url).includes('token='), false);

assert.deepEqual(
    planSellerWebhook({ webhooks: [], url }),
    { action: 'create', webhook: null, url, subscriptions: ['conversation_created'] },
);
assert.equal(
    planSellerWebhook({
        webhooks: [{ id: 1, url, subscriptions: ['conversation_created'] }],
        url,
    }).action,
    'none',
);
assert.equal(
    planSellerWebhook({
        webhooks: [{ id: 1, url: 'https://hub.example.test/api/v2/webhooks/chatwoot/seller-inbound?token=old', subscriptions: ['conversation_created'] }],
        url,
    }).action,
    'update',
);

const calls = [];
let applied = false;
const fetcher = async (baseUrl, token, endpoint, options = {}) => {
    const method = options.method || 'GET';
    calls.push({ method, endpoint, body: options.body });

    if (method === 'POST' || method === 'PATCH') {
        applied = true;
        return { ok: true, status: 200, payload: { id: 1 } };
    }

    return {
        ok: true,
        status: 200,
        payload: {
            payload: {
                webhooks: applied
                    ? [{ id: 1, url, subscriptions: ['conversation_created'] }]
                    : [],
            },
        },
    };
};

const target = {
    baseUrl: 'https://chatwoot-seller.example.test',
    token: 'seller-token',
    accountId: 3,
};

const dryRun = await provisionSellerInboundWebhook({
    target,
    url,
    dryRun: true,
    fetcher,
});
assert.equal(dryRun.action, 'create');
assert.equal(dryRun.actionApplied, false);
assert.equal(dryRun.verified, false);
assert.equal(calls.filter((call) => call.method === 'POST').length, 0);

calls.length = 0;
applied = false;
const appliedReport = await provisionSellerInboundWebhook({
    target,
    url,
    dryRun: false,
    fetcher,
});
assert.equal(appliedReport.action, 'create');
assert.equal(appliedReport.actionApplied, true);
assert.equal(appliedReport.verified, true);
assert.equal(calls.filter((call) => call.method === 'POST').length, 1);

console.log('Seller webhook tests: OK');

import assert from 'node:assert/strict';

import {
    SellerDashboardError,
    buildDashboardAppUrl,
    planDashboardApp,
    provisionDashboardApp,
    publicDashboardAppUrl,
} from '../src/services/seller-chatwoot-dashboard.service.js';

const secret = 'test-dashboard-secret';
const url = buildDashboardAppUrl({
    frontendBaseUrl: 'https://inchat.example.test/',
    accountId: 3,
    affiliateId: 1795,
    contextSecret: secret,
});
const parsed = new URL(url);
assert.equal(parsed.origin, 'https://inchat.example.test');
assert.equal(parsed.pathname, '/v2/update-contact');
assert.equal(parsed.searchParams.get('mode'), 'seller');
assert.equal(parsed.searchParams.get('seller_account_id'), '3');
assert.equal(parsed.searchParams.get('seller_affiliate_id'), '1795');
assert.ok(parsed.searchParams.get('ctx'));
assert.equal(publicDashboardAppUrl(url).includes('ctx='), false);

assert.deepEqual(
    planDashboardApp({ apps: [], url }),
    { action: 'create', app: null, url },
);
assert.equal(
    planDashboardApp({
        apps: [{ id: 5, title: 'RD STATION', content: [{ type: 'frame', url }] }],
        url,
    }).action,
    'none',
);
assert.equal(
    planDashboardApp({
        apps: [{ id: 5, title: 'RD STATION', content: [{ type: 'frame', url: 'https://old' }] }],
        url,
    }).action,
    'update',
);

const calls = [];
let applied = false;

function fakeFetcher(baseUrl, token, endpoint, options = {}) {
    const method = options.method || 'GET';
    calls.push({ baseUrl, token, endpoint, method, body: options.body });

    if (method === 'POST') {
        applied = true;
        return Promise.resolve({ ok: true, status: 200, payload: { id: 5 } });
    }

    if (endpoint.endsWith('/integrations/apps')) {
        return Promise.resolve({
            ok: true,
            status: 200,
            payload: [{ id: 'dashboard_apps', enabled: true, hooks: [] }],
        });
    }

    if (endpoint.endsWith('/dashboard_apps')) {
        return Promise.resolve({
            ok: true,
            status: 200,
            payload: applied
                ? [{ id: 5, title: 'RD STATION', content: [{ type: 'frame', url }] }]
                : [],
        });
    }

    return Promise.resolve({ ok: false, status: 500, error: 'unexpected' });
}

const target = {
    baseUrl: 'https://chatwoot-seller.example.test',
    token: 'seller-token',
    accountId: 3,
};

const dryRun = await provisionDashboardApp({
    target,
    url,
    dryRun: true,
    fetcher: fakeFetcher,
});
assert.equal(dryRun.action, 'create');
assert.equal(dryRun.actionApplied, false);
assert.equal(dryRun.integrationEnabled, true);
assert.equal(dryRun.verified, false);
assert.equal(calls.filter((call) => call.method === 'POST').length, 0);

calls.length = 0;
applied = false;
const appliedReport = await provisionDashboardApp({
    target,
    url,
    dryRun: false,
    fetcher: fakeFetcher,
});
assert.equal(appliedReport.action, 'create');
assert.equal(appliedReport.actionApplied, true);
assert.equal(appliedReport.verified, true);
assert.equal(calls.filter((call) => call.method === 'POST').length, 1);

await assert.rejects(
    provisionDashboardApp({
        target,
        url,
        dryRun: false,
        fetcher: async (baseUrl, token, endpoint) => {
            if (endpoint.endsWith('/integrations/apps')) {
                return { ok: true, status: 200, payload: [{ id: 'dashboard_apps', enabled: false }] };
            }
            return {
                ok: true,
                status: 200,
                payload: [{ id: 5, title: 'RD STATION', content: [{ type: 'frame', url: 'https://old' }] }],
            };
        },
    }),
    (error) => error instanceof SellerDashboardError && error.code === 'DASHBOARD_APPS_DISABLED',
);

console.log('Seller dashboard tests: OK');

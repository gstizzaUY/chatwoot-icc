import assert from 'node:assert/strict';

import {
    buildCustomAttributePayload,
    isReservedContactAttributeKey,
    planCustomAttributeCopy,
    provisionCustomAttributes,
} from '../src/services/seller-chatwoot-provisioning.service.js';

const sourceDefinitions = [
    {
        id: 1,
        attribute_key: 'tiene_ichef',
        attribute_display_name: 'Tiene Ichef',
        attribute_description: 'Campo de negocio',
        attribute_display_type: 'text',
        attribute_model: 'contact_attribute',
        attribute_values: [],
        regex_pattern: null,
        regex_cue: null,
    },
    {
        id: 2,
        attribute_key: 'estado_sdr',
        attribute_display_name: 'Estado SDR',
        attribute_description: null,
        attribute_display_type: 'list',
        attribute_model: 'contact_attribute',
        attribute_values: ['Sin Interés', 'Demo agendada'],
    },
    {
        id: 3,
        attribute_key: 'email',
        attribute_display_name: 'Email',
        attribute_display_type: 'text',
        attribute_model: 'contact_attribute',
        attribute_values: [],
    },
    {
        id: 4,
        attribute_key: 'blocked',
        attribute_display_name: 'Bloqueado',
        attribute_display_type: 'checkbox',
        attribute_model: 'contact_attribute',
        attribute_values: [],
    },
    {
        id: 5,
        attribute_key: 'drift_field',
        attribute_display_name: 'Drift',
        attribute_display_type: 'text',
        attribute_model: 'contact_attribute',
        attribute_values: [],
    },
];

const targetDefinitions = [
    {
        id: 9,
        attribute_key: 'tiene_ichef',
        attribute_display_name: 'Tiene Ichef',
        attribute_display_type: 'text',
        attribute_model: 'contact_attribute',
        attribute_values: [],
    },
    {
        id: 10,
        attribute_key: 'drift_field',
        attribute_display_name: 'Drift',
        attribute_display_type: 'number',
        attribute_model: 'contact_attribute',
        attribute_values: [],
    },
];

assert.equal(isReservedContactAttributeKey('email'), true);
assert.equal(isReservedContactAttributeKey('blocked'), true);
assert.equal(isReservedContactAttributeKey('tiene_ichef'), false);
assert.equal(isReservedContactAttributeKey('id'), false);

const payload = buildCustomAttributePayload(sourceDefinitions[1]);
assert.deepEqual(payload, {
    attribute_display_name: 'Estado SDR',
    attribute_description: null,
    attribute_display_type: 'list',
    attribute_key: 'estado_sdr',
    attribute_model: 'contact_attribute',
    regex_pattern: null,
    regex_cue: null,
    attribute_values: ['Sin Interés', 'Demo agendada'],
});
assert.equal(Object.hasOwn(payload, 'id'), false);

const plan = planCustomAttributeCopy(sourceDefinitions, targetDefinitions);
assert.deepEqual(plan.missing.map((item) => item.attribute_key), ['estado_sdr']);
assert.deepEqual(plan.reserved.map((item) => item.key), ['email', 'blocked']);
assert.deepEqual(plan.existing.map((item) => item.key), ['tiene_ichef', 'drift_field']);
assert.equal(plan.drift.length, 1);
assert.equal(plan.drift[0].key, 'drift_field');
assert.equal(plan.sourceCount, 5);
assert.equal(plan.targetCount, 2);

const posted = [];
const fetcher = async (baseUrl, token, endpoint, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'GET' && endpoint.includes('/custom_attribute_definitions')) {
        if (baseUrl.includes('target')) {
            return {
                ok: true,
                status: 200,
                payload: posted.length === 0 ? targetDefinitions : [...targetDefinitions, {
                    attribute_key: 'estado_sdr',
                    attribute_display_name: 'Estado SDR',
                    attribute_display_type: 'list',
                    attribute_model: 'contact_attribute',
                    attribute_values: ['Sin Interés', 'Demo agendada'],
                }],
            };
        }
        return { ok: true, status: 200, payload: sourceDefinitions };
    }
    if (method === 'POST') {
        posted.push({ endpoint, body: options.body });
        return { ok: true, status: 200, payload: { id: 100 } };
    }
    return { ok: false, status: 500, error: 'unexpected' };
};

// Dry-run: no POST.
const dryRun = await provisionCustomAttributes({
    source: { baseUrl: 'https://source.test', token: 'source-token', accountId: 2 },
    target: { baseUrl: 'https://target.test', token: 'target-token', accountId: 3 },
    dryRun: true,
    fetcher,
});
assert.equal(dryRun.dryRun, true);
assert.equal(dryRun.plan.missing.length, 1);
assert.equal(posted.length, 0);

// Apply: un POST para estado_sdr y verificación posterior.
const applied = await provisionCustomAttributes({
    source: { baseUrl: 'https://source.test', token: 'source-token', accountId: 2 },
    target: { baseUrl: 'https://target.test', token: 'target-token', accountId: 3 },
    dryRun: false,
    delayMs: 0,
    fetcher,
});
assert.equal(applied.dryRun, false);
assert.equal(applied.created.length, 1);
assert.equal(applied.created[0].key, 'estado_sdr');
assert.equal(applied.failed.length, 0);
assert.equal(applied.targetCountAfter, 3);
assert.equal(posted.length, 1);
assert.equal(posted[0].body.custom_attribute_definition.attribute_key, 'estado_sdr');

console.log('Seller provisioning tests: OK');

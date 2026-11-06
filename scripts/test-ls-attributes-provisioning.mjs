import assert from 'node:assert/strict';

import {
    provisionLsAttributes,
} from '../src/services/ls-attributes-provisioning.service.js';

const target = {
    baseUrl: 'https://chatwoot.example.test',
    token: 'test-token',
    accountId: 3,
};

let definitions = [];

function response(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => (body === null ? '' : JSON.stringify(body)),
    };
}

const fetcher = async (url, options = {}) => {
    if (options.method === 'POST') {
        const body = JSON.parse(options.body);
        const definition = {
            id: definitions.length + 1,
            ...body.custom_attribute_definition,
        };
        definitions.push(definition);
        return response(200, definition);
    }

    return response(200, definitions);
};

const dryRun = await provisionLsAttributes({ target, dryRun: true, fetcher });
assert.equal(dryRun.missing.length, 7);
assert.equal(dryRun.created.length, 0);
assert.equal(dryRun.verified, false);

const applied = await provisionLsAttributes({ target, dryRun: false, fetcher });
assert.equal(applied.created.length, 7);
assert.equal(applied.failed.length, 0);
assert.equal(applied.missingAfter.length, 0);
assert.equal(applied.verified, true);
assert.equal(definitions.length, 7);
assert.equal(definitions[0].attribute_display_type, 'list');
assert.ok(definitions[0].attribute_values.length > 0);

const idempotent = await provisionLsAttributes({ target, dryRun: false, fetcher });
assert.equal(idempotent.created.length, 0);
assert.equal(idempotent.missing.length, 0);
assert.equal(definitions.length, 7);

console.log('LS attributes provisioning tests: OK');

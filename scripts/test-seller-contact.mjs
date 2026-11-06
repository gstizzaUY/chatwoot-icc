import assert from 'node:assert/strict';

import {
    SellerContactError,
    updateSellerContact,
} from '../src/services/seller-contact.service.js';

const sellerConfig = {
    affiliateId: 34,
    accountId: '3',
    url: 'https://seller.example.test',
    token: 'seller-runtime-token',
};

const flags = {
    allowlist: [3],
    syncMode: 'seller_only',
};

function makeDeps(overrides = {}) {
    const calls = {
        rd: [],
        puts: [],
        clients: [],
        finds: [],
    };

    const client = {
        async put(path, body) {
            calls.puts.push({ path, body });
            return { data: { ok: true } };
        },
    };

    return {
        calls,
        deps: {
            getFlags: () => flags,
            resolveSeller: () => sellerConfig,
            definitions: [],
            createClient: (config) => {
                calls.clients.push(config);
                return client;
            },
            findContact: async (args) => {
                calls.finds.push(args);
                return {
                    id: 55,
                    email: 'cliente@example.test',
                    phone_number: '+59899123456',
                    custom_attributes: { stage: 'lead' },
                };
            },
            sanitizeContactPayload: async (data) => ({
                ...data,
                cf_tiene_ichef: 'Sí',
            }),
            updateRdContact: async (email, data) => {
                calls.rd.push({ email, data });
                return { email, updated: true };
            },
            buildChatwootUpdatePayload: (rdData, contact) => ({
                custom_attributes: {
                    ...(contact.custom_attributes || {}),
                    tiene_ichef: rdData.cf_tiene_ichef,
                },
            }),
            ...overrides,
        },
    };
}

const { calls, deps } = makeDeps();
const result = await updateSellerContact({
    accountId: 3,
    affiliateId: 34,
    contactId: 55,
    contactData: {
        email: 'cliente@example.test',
        mobile_phone: '59899123456',
        cf_tiene_ichef: 'Sí',
    },
    deps,
});

assert.equal(result.ok, true);
assert.equal(result.sellerAccountId, 3);
assert.equal(result.sellerAffiliateId, 34);
assert.equal(result.contactId, 55);
assert.equal(result.rdUpdated, true);
assert.equal(result.chatwootUpdated, true);
assert.equal(calls.clients[0].accountId, '3');
assert.equal(calls.clients[0].url, 'https://seller.example.test');
assert.equal(calls.rd[0].email, 'cliente@example.test');
assert.equal(calls.rd[0].data.cf_tiene_ichef, 'Sí');
assert.equal(calls.puts[0].path, '/contacts/55');
assert.equal(calls.puts[0].body.custom_attributes.tiene_ichef, 'Sí');

const mirror = makeDeps();
let mirrorArgs = null;
mirror.deps.getFlags = () => ({ ...flags, centralMirror: 'shadow' });
mirror.deps.observeCentralMirror = async (args) => {
    mirrorArgs = args;
    return { ok: true };
};
await updateSellerContact({
    accountId: 3,
    affiliateId: 34,
    contactId: 55,
    contactData: {
        email: 'cliente@example.test',
        mobile_phone: '59899123456',
        cf_tiene_ichef: 'Sí',
    },
    deps: mirror.deps,
});
assert.equal(mirrorArgs.source, 'seller_edit');
assert.equal(mirrorArgs.accountId, 3);
assert.equal(mirrorArgs.affiliateId, 34);

const mapped = makeDeps({
    definitions: [
        { attribute_key: 'bio', attribute_model: 'contact_attribute' },
    ],
});
const mappedResult = await updateSellerContact({
    accountId: 3,
    affiliateId: 34,
    contactId: 55,
    contactData: {
        email: 'cliente@example.test',
        mobile_phone: '59899123456',
        cf_bio: 'Texto de biografía',
    },
    deps: mapped.deps,
});
assert.equal(mappedResult.fieldSync.mappedFields.includes('bio'), true);
assert.equal(mapped.calls.puts[0].body.custom_attributes.bio, 'Texto de biografía');

await assert.rejects(
    updateSellerContact({
        accountId: 3,
        affiliateId: 34,
        contactId: 55,
        contactData: { email: 'cliente@example.test' },
        deps: {
            ...makeDeps().deps,
            getFlags: () => ({ allowlist: [3], syncMode: 'off' }),
        },
    }),
    (error) => error instanceof SellerContactError && error.code === 'SELLER_CONTACT_SYNC_DISABLED',
);

await assert.rejects(
    updateSellerContact({
        accountId: 3,
        affiliateId: 34,
        contactId: 55,
        contactData: { email: 'cliente@example.test' },
        deps: {
            ...makeDeps().deps,
            updateRdContact: async () => {
                const error = new Error('RD caído');
                error.code = 'RD_UPDATE_ERROR';
                throw error;
            },
        },
    }),
    (error) => error instanceof SellerContactError && error.code === 'RD_UPDATE_FAILED',
);

await assert.rejects(
    updateSellerContact({
        accountId: 3,
        affiliateId: 34,
        contactId: 55,
        contactData: { email: 'cliente@example.test' },
        deps: {
            ...makeDeps().deps,
            findContact: async () => null,
        },
    }),
    (error) => error instanceof SellerContactError && error.code === 'SELLER_CONTACT_NOT_FOUND',
);

console.log('Seller contact tests: OK');

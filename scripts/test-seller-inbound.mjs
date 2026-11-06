import assert from 'node:assert/strict';

import {
    buildInboundContactPayload,
    extractInboundAccountId,
    extractInboundContact,
    isInboundConversation,
    processSellerInbound,
    secureCompare,
} from '../src/services/seller-inbound.service.js';

const config = {
    affiliateId: 1795,
    accountId: '3',
    seller: {
        name: 'Victoria Montero',
        email: 'victoriamonteroseller@gmail.com',
        phone: '099 844 141',
        referralUrl: 'https://ichef.com.uy/ref/victoriamonteroseller/',
    },
};

const payload = {
    event: 'conversation_created',
    account: { id: 3, name: 'Victoria Seller' },
    messages: [{ message_type: 0, incoming: true }],
    meta: {
        sender: {
            id: 55,
            name: 'Cliente de Prueba',
            email: 'cliente@example.test',
            phone_number: '+598 99 123 456',
        },
    },
};

assert.equal(extractInboundAccountId(payload), 3);
assert.equal(extractInboundContact(payload).email, 'cliente@example.test');
assert.equal(isInboundConversation(payload), true);
assert.equal(isInboundConversation({ messages: [{ message_type: 'outgoing' }] }), false);
assert.equal(secureCompare('abc', 'abc'), true);
assert.equal(secureCompare('abc', 'abd'), false);
assert.equal(secureCompare('abc', 'abcd'), false);

const contactPayload = buildInboundContactPayload({
    contact: payload.meta.sender,
    config,
});
assert.equal(contactPayload.name, 'Cliente de Prueba');
assert.equal(contactPayload.email, 'cliente@example.test');
assert.ok(contactPayload.personal_phone.startsWith('+598'));
assert.equal(contactPayload.cf_seller_affiliate_id, '1795');
assert.equal(contactPayload.cf_seller_username, 'victoriamonteroseller');
assert.equal(contactPayload.cf_seller_referral_url, 'https://ichef.com.uy/ref/victoriamonteroseller/');
assert.equal(contactPayload.cf_referido_por, 'Victoria Montero (099 844 141)');
assert.equal(Object.hasOwn(contactPayload, 'cf_seller_name'), false);
assert.equal(Object.hasOwn(contactPayload, 'cf_seller_email'), false);
assert.equal(Object.hasOwn(contactPayload, 'cf_seller_phone'), false);

const phoneOnlyContact = buildInboundContactPayload({
    contact: { name: 'Solo Teléfono', phone_number: '+598 99 555 444' },
    config,
});
assert.equal(phoneOnlyContact.email, '59899555444@email.com');

const fakeEmailContact = buildInboundContactPayload({
    contact: { name: 'Fake', email: '59899111222@email.com', phone_number: '+598 99 111 222' },
    config,
});
assert.equal(fakeEmailContact.email, '59899111222@email.com');

const calls = [];
const result = await processSellerInbound({
    payload,
    config,
    deps: {
        upsertContact: async (data) => {
            calls.push(data);
            return {
                contact: { uuid: 'rd-uuid-1' },
                created: true,
            };
        },
    },
});
assert.equal(result.ok, true);
assert.equal(result.created, true);
assert.equal(result.contactUuid, 'rd-uuid-1');
assert.equal(calls.length, 1);
assert.equal(calls[0].cf_seller_affiliate_id, '1795');

const skipped = await processSellerInbound({
    payload: { ...payload, messages: [{ message_type: 'outgoing' }] },
    config,
    deps: { upsertContact: async () => { throw new Error('no debería llamarse'); } },
});
assert.equal(skipped.ok, false);
assert.equal(skipped.skipped, 'not_inbound');

const noContact = await processSellerInbound({
    payload: { ...payload, meta: { sender: null } },
    config,
    deps: { upsertContact: async () => { throw new Error('no debería llamarse'); } },
});
assert.equal(noContact.ok, false);
assert.equal(noContact.skipped, 'contact_missing');

console.log('Seller inbound tests: OK');

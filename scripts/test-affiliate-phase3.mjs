import assert from 'node:assert/strict';
import {
    buildLeadContactPayload,
    buildLoverReferralsPayload,
    buildSellerContactPayload,
    syncLeadCreatedEvent,
    syncSellerEvent,
} from '../src/services/affiliate-program.service.js';

const sellerEvent = {
    event_id: 'seller.created:test',
    event_name: 'seller.created',
    seller: {
        affiliate_id: 7,
        user_id: 70,
        username: 'seller-demo',
        email: 'seller@example.com',
        name: 'Seller Demo',
        status: 'active',
        referral_url: 'https://example.com/?ref=seller-demo',
    },
    lover: {
        affiliate_id: 2,
        username: 'lover-demo',
        email: 'lover@example.com',
        name: 'Lover Demo',
    },
};

const sellerPayload = buildSellerContactPayload(sellerEvent);
assert.equal(sellerPayload.cf_tipo_afiliado, 'Seller');
assert.equal(sellerPayload.cf_seller_affiliate_id, '7');
assert.equal(sellerPayload.cf_seller_username, 'seller-demo');
assert.equal(sellerPayload.cf_lover_affiliate_id, '2');
assert.equal(sellerPayload.cf_lover_email, 'lover@example.com');

const leadEvent = {
    event_id: 'lead.created:123',
    event_name: 'lead.created',
    lead: {
        id: 123,
        first_name: 'Ana',
        last_name: 'Pérez',
        name: '',
        email: '',
        phone: '099 123 456',
        status: 'new',
    },
    lover: {
        affiliate_id: 2,
        username: 'lover-demo',
        email: 'lover@example.com',
        name: 'Lover Demo',
    },
    seller: {
        affiliate_id: 7,
        username: 'seller-demo',
        email: 'seller@example.com',
    },
};

const leadPayload = buildLeadContactPayload(leadEvent, {
    name: 'Lover Demo',
    personal_phone: '+598 99 000 111',
});
assert.equal(leadPayload.name, 'Ana Pérez');
assert.equal(leadPayload.email, '59899123456@email.com');
assert.equal(leadPayload.personal_phone, '+59899123456');
assert.equal(leadPayload.cf_referido_por, 'Lover Demo (+598 99 000 111)');

const loverPayload = buildLoverReferralsPayload(
    { email: 'lover@example.com', name: 'Lover Demo' },
    {
        name: 'Lover Demo',
        cf_referidos: JSON.stringify([
            { name: 'Otro', phone: '099 123 456', type: 'referido' },
        ]),
    },
    leadEvent.lead,
);
const referrals = JSON.parse(loverPayload.cf_referidos);
assert.equal(referrals.length, 1);
assert.equal(referrals[0].name, 'Ana Pérez');
assert.equal(referrals[0].type, 'referido');

const missingSellerEmail = await syncSellerEvent({
    seller: { affiliate_id: 9, email: '' },
});
assert.equal(missingSellerEmail.ok, false);
assert.equal(missingSellerEmail.reason, 'seller_email_missing');

const missingLeadContact = await syncLeadCreatedEvent({
    lead: { id: 9, name: 'Sin datos', email: '', phone: '' },
});
assert.equal(missingLeadContact.ok, false);
assert.equal(missingLeadContact.reason, 'lead_without_email_or_phone');

console.log('Phase 3 pure tests: OK');

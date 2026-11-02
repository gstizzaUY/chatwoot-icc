/**
 * Prueba controlada de Fase 3 contra las APIs configuradas en .env.
 *
 * Crea contactos de prueba (no WordPress) y verifica:
 *   - Seller en RD Marketing
 *   - Lover en RD Marketing
 *   - Lead/C en RD Marketing
 *   - C en Chatwoot cuenta 2, sin conversación
 *   - cf_referido_por y cf_referidos
 *
 * No crea deals ni conversaciones.
 *
 * Uso:
 *   node scripts/test-affiliate-phase3-live.mjs
 *
 * Los datos creados se imprimen al final para poder borrarlos.
 */

import assert from 'node:assert/strict';
import {
    findMarketingContact,
    upsertMarketingContact,
} from '../src/services/rd-affiliate.service.js';
import {
    syncLeadCreatedEvent,
    syncSellerEvent,
} from '../src/services/affiliate-program.service.js';
import chatwootClient from '../src/clients/chatwoot.client.js';

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const suffix = `${stamp}${Math.floor(Math.random() * 1000)}`;

const sellerEmail = `test.seller.phase3.${suffix}@example.com`;
const loverEmail = `test.lover.phase3.${suffix}@example.com`;
const leadEmail = `test.lead.phase3.${suffix}@example.com`;
const leadPhone = `+598 99 ${String(Math.floor(Math.random() * 900) + 100)} ${String(Math.floor(Math.random() * 9000) + 1000)}`;
const loverPhone = '+598 99 000 111';

const sellerAffiliateId = 990001;
const loverAffiliateId = 990002;
const leadId = 990003;

const sellerEvent = {
    event_id: `seller.created:live:${suffix}`,
    event_name: 'seller.created',
    source: 'live-test',
    seller: {
        affiliate_id: sellerAffiliateId,
        user_id: 990001,
        username: `test-seller-${suffix}`,
        email: sellerEmail,
        name: 'TEST Seller Fase 3',
        status: 'active',
        referral_url: 'https://example.com/test-seller',
    },
    lover: {
        affiliate_id: loverAffiliateId,
        username: `test-lover-${suffix}`,
        email: loverEmail,
        name: 'TEST Lover Fase 3',
    },
};

const leadEvent = {
    event_id: `lead.created:live:${suffix}`,
    event_name: 'lead.created',
    source: 'live-test',
    lead: {
        id: leadId,
        first_name: 'TEST',
        last_name: 'Lead Fase 3',
        name: 'TEST Lead Fase 3',
        email: leadEmail,
        phone: leadPhone,
        status: 'new',
        campaign: '',
        order_id: 0,
        referral_id: 0,
        lover_affiliate_id: loverAffiliateId,
        partner_affiliate_id: sellerAffiliateId,
    },
    lover: {
        affiliate_id: loverAffiliateId,
        username: `test-lover-${suffix}`,
        email: loverEmail,
        name: 'TEST Lover Fase 3',
    },
    seller: {
        affiliate_id: sellerAffiliateId,
        username: `test-seller-${suffix}`,
        email: sellerEmail,
        name: 'TEST Seller Fase 3',
    },
};

function print(value) {
    console.log(JSON.stringify(value, null, 2));
}

console.log('=== Datos de prueba ===');
print({
    suffix,
    seller: { affiliate_id: sellerAffiliateId, email: sellerEmail },
    lover: { affiliate_id: loverAffiliateId, email: loverEmail, phone: loverPhone },
    lead: { id: leadId, email: leadEmail, phone: leadPhone },
});

console.log('\n=== 1. Seller ===');
const sellerResult = await syncSellerEvent(sellerEvent);
print(sellerResult);
assert.equal(sellerResult.ok, true);
assert.equal(sellerResult.patch.seller_affiliate_id, sellerAffiliateId);

const sellerContact = await findMarketingContact(sellerEmail);
assert.ok(sellerContact, 'No se creó el contacto del Seller en RD Marketing');
assert.equal(sellerContact.cf_tipo_afiliado, 'Seller');
assert.equal(String(sellerContact.cf_seller_affiliate_id), String(sellerAffiliateId));
assert.equal(sellerContact.cf_lover_affiliate_id, String(loverAffiliateId));

console.log('Seller en RD Marketing: OK');

console.log('\n=== 2. Lover de prueba ===');
const loverResult = await upsertMarketingContact({
    name: 'TEST Lover Fase 3',
    email: loverEmail,
    personal_phone: loverPhone,
    cf_tipo_afiliado: 'Lover',
    cf_lover_affiliate_id: String(loverAffiliateId),
});
print(loverResult);
const loverContact = await findMarketingContact(loverEmail);
assert.ok(loverContact, 'No se creó el contacto del Lover en RD Marketing');

console.log('Lover en RD Marketing: OK');

console.log('\n=== 3. Lead/C ===');
const leadResult = await syncLeadCreatedEvent(leadEvent);
print(leadResult);
assert.equal(leadResult.ok, true);
assert.ok(leadResult.patch.rd_contact_uuid, 'El lead no devolvió rd_contact_uuid');
assert.ok(leadResult.patch.chatwoot_center_contact_id, 'El lead no devolvió chatwoot_center_contact_id');

const leadContact = await findMarketingContact(leadEmail);
assert.ok(leadContact, 'No se creó el contacto C en RD Marketing');
assert.ok(String(leadContact.cf_referido_por || '').includes('TEST Lover Fase 3'), 'cf_referido_por no se actualizó');
console.log('C en RD Marketing: OK');

const loverAfter = await findMarketingContact(loverEmail);
const referrals = JSON.parse(loverAfter?.cf_referidos || '[]');
assert.ok(
    Array.isArray(referrals) && referrals.some((item) => item.phone === leadPhone),
    'cf_referidos del Lover no contiene el lead de prueba',
);
console.log('cf_referidos del Lover: OK');

const centerContact = await chatwootClient.findContact({ email: leadEmail });
assert.ok(centerContact, 'No se creó el contacto C en Chatwoot');
const conversations = await chatwootClient.getConversationsByContact(centerContact.id);
assert.equal(conversations.length, 0, 'Se creó una conversación en Chatwoot; Fase 3 no debe hacerlo');
console.log('C en Chatwoot cuenta 2 sin conversación: OK');

console.log('\n=== RESULTADO ===');
print({
    ok: true,
    created: {
        seller: { affiliate_id: sellerAffiliateId, email: sellerEmail, rd_uuid: sellerContact.uuid || null },
        lover: { affiliate_id: loverAffiliateId, email: loverEmail, rd_uuid: loverContact.uuid || null },
        lead: {
            id: leadId,
            email: leadEmail,
            phone: leadPhone,
            rd_uuid: leadContact.uuid || null,
            chatwoot_contact_id: centerContact.id,
        },
    },
    expected: {
        seller_contact: true,
        lover_contact: true,
        lead_contact: true,
        chatwoot_contact: true,
        chatwoot_conversations: 0,
        deal_created: false,
    },
    cleanup: [
        `Borrar contacto RD Marketing: ${sellerEmail}`,
        `Borrar contacto RD Marketing: ${loverEmail}`,
        `Borrar contacto RD Marketing: ${leadEmail}`,
        `Borrar contacto Chatwoot cuenta 2: ${leadEmail} (ID ${centerContact.id})`,
        `Revisar/eliminar evento referido-portal del contacto ${leadEmail} si se creó`,
    ],
});

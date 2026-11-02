/**
 * Prueba controlada de Fase 4 — estrategia B.
 *
 * Reutiliza el contacto/deal de prueba de la Fase 3 y simula una confirmación
 * de Seller. No crea un deal nuevo.
 */

import assert from 'node:assert/strict';
import axios from 'axios';
import chatwootClient from '../src/clients/chatwoot.client.js';
import {
    findExistingDealForEvent,
    buildDealFieldValues,
    syncAssignmentEvent,
} from '../src/services/affiliate-opportunity.service.js';

const leadEmail = 'test.lead.phase3.20261102170143243@example.com';
const sellerEmail = 'test.seller.phase3.20261102170143243@example.com';
const loverEmail = 'test.lover.phase3.20261102170143243@example.com';
const leadId = 990003;
const sellerAffiliateId = 990001;
const loverAffiliateId = 990002;

const event = {
    event_id: 'lead.seller_confirmed:live:990003:990001',
    event_name: 'lead.seller_confirmed',
    source: 'wordpress_admin',
    lead: {
        id: leadId,
        first_name: 'TEST',
        last_name: 'Lead Fase 3',
        name: 'TEST Lead Fase 3',
        email: leadEmail,
        phone: '+598 99 656 4691',
        status: 'confirmed',
        partner_affiliate_id: sellerAffiliateId,
        lover_affiliate_id: loverAffiliateId,
    },
    lover: {
        affiliate_id: loverAffiliateId,
        username: 'test-lover-phase3',
        email: loverEmail,
        name: 'TEST Lover Fase 3',
    },
    seller: {
        affiliate_id: sellerAffiliateId,
        username: 'test-seller-phase3',
        email: sellerEmail,
        name: 'TEST Seller Fase 3',
        status: 'active',
        referral_url: 'https://example.com/test-seller',
    },
    assignment: {
        context: 'confirmed',
        previous_seller_affiliate_id: 0,
    },
};

console.log('=== 1. Buscar deal existente ===');
const existing = await findExistingDealForEvent(event);
assert.ok(existing.contact, 'No se encontró el contacto CRM de prueba');
assert.ok(existing.deal, 'No se encontró el deal existente de prueba');
console.log(JSON.stringify({ contact_id: existing.contact.id, deal_id: existing.deal.id, pipeline: existing.deal.deal_pipeline?.name, stage: existing.deal.deal_stage?.name }, null, 2));

console.log('\n=== 2. Campos que se van a escribir ===');
console.log(JSON.stringify(buildDealFieldValues(event), null, 2));

console.log('\n=== 3. Procesar asignación (sin crear deal) ===');
const result = await syncAssignmentEvent(event);
console.log(JSON.stringify(result, null, 2));
assert.equal(result.ok, true);
assert.equal(result.patch.rd_deal_id, existing.deal.id);

const crm = axios.create({
    baseURL: process.env.RDSTATION_CRM_URL,
    params: { token: process.env.RDSTATION_USER_TOKEN },
    headers: { 'Content-Type': 'application/json' },
});
const dealResponse = await crm.get(`/api/v1/deals/${existing.deal.id}`);
const deal = dealResponse.data;
const fieldMap = Object.fromEntries((deal.deal_custom_fields || []).map((field) => [field.custom_field?.label, field.value]));
console.log('\n=== 4. Deal actualizado ===');
console.log(JSON.stringify({
    deal_id: deal.id,
    campaign: deal.campaign?.name,
    pipeline: deal.deal_pipeline?.name,
    stage: deal.deal_stage?.name,
    custom_fields: fieldMap,
}, null, 2));

assert.equal(fieldMap['Seller Affiliate ID'], String(sellerAffiliateId));
assert.equal(fieldMap['Lover Affiliate ID'], String(loverAffiliateId));
assert.equal(fieldMap['Lead ID'], String(leadId));
assert.equal(fieldMap['Referral Status'], 'confirmed');

const contact = await chatwootClient.findContact({ email: leadEmail });
assert.ok(contact, 'No se encontró C en Chatwoot');
const conversations = await chatwootClient.getConversationsByContact(contact.id);
const supervision = conversations.find((item) => Number(item.inbox_id) === Number(process.env.CHATWOOT_SELLER_OPPORTUNITIES_INBOX_ID || 68));
console.log('\n=== 5. Conversación de supervisión ===');
console.log(JSON.stringify({ contact_id: contact.id, conversations: conversations.map((item) => ({ id: item.id, inbox_id: item.inbox_id, status: item.status, labels: item.labels })) }, null, 2));
assert.ok(supervision, 'No se creó/reutilizó la conversación de supervisión');

console.log('\n=== RESULTADO ===');
console.log(JSON.stringify({
    ok: true,
    reused_deal: deal.id,
    did_not_create_duplicate: true,
    supervision_conversation_id: supervision.id,
    rd_note_created: result.patch.rd_note_created,
}, null, 2));

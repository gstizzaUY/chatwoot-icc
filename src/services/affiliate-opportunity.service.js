import chatwootClient from '../clients/chatwoot.client.js';
import {
    createCrmDealNote,
    findCrmContactByEmail,
    findCrmContactByPhone,
    findOpenCrmDealForContact,
    getAffiliateResources,
    mapDealCustomFields,
    sendMarketingConversionEvent,
    updateCrmDeal,
} from './rd-affiliate.service.js';
import {
    ensureCenterChatwootContact,
    leadEmail,
    leadName,
    leadPhone,
} from './affiliate-program.service.js';
import { STAGE_LABELS } from '../utils/stage-labels.utils.js';
import {
    notifyPreviousSellerConversation,
    syncSellerConversation,
} from './seller-chatwoot.service.js';

/**
 * Fase 4 — Oportunidad de referidos.
 *
 * Estrategia B: la automatización de RD crea el deal; este servicio lo
 * reutiliza y lo actualiza. NO crea un segundo deal.
 *
 * Hace:
 *   - busca el contacto C y su deal abierto en RD CRM;
 *   - actualiza los custom fields del deal;
 *   - envía seller-asignado a C y referido-asignado al Seller;
 *   - agrega nota en RD CRM si RD_CRM_NOTE_USER_ID está configurado;
 *   - asegura la conversación de supervisión en Chatwoot cuenta 2, inbox 68;
 *   - NO crea deals si no existe uno (Fase 5 puede agregar fallback).
 */

const OPPORTUNITY_PIPELINE = 'Agendamiento demo';
const SUPERVISION_INBOX_ID = Number(
    process.env.CHATWOOT_SELLER_OPPORTUNITIES_INBOX_ID || 68,
);

function asString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
}

function asNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function eventContext(event) {
    return asString(event?.assignment?.context)
        || asString(event?.event_name).split('.').pop()
        || 'assigned';
}

function sellerLabel(seller) {
    return asString(seller?.name)
        || asString(seller?.username)
        || asString(seller?.email)
        || 'Seller';
}

function loverLabel(lover) {
    return asString(lover?.name)
        || asString(lover?.username)
        || asString(lover?.email)
        || 'Lover';
}

/**
 * Busca el contacto C y el deal abierto que ya creó la automatización de RD.
 */
export async function findExistingDealForEvent(event) {
    const lead = event?.lead || {};
    const email = leadEmail(lead) || asString(lead.email);
    const phone = leadPhone(lead) || asString(lead.phone);

    let contact = null;
    if (email) {
        contact = await findCrmContactByEmail(email);
    }
    if (!contact && phone) {
        contact = await findCrmContactByPhone(phone);
    }
    if (!contact) {
        return { contact: null, deal: null };
    }

    let deal = await findOpenCrmDealForContact(contact, OPPORTUNITY_PIPELINE);
    if (!deal) {
        // Si la automatización cambió de pipeline, no crear un deal nuevo:
        // reutilizar cualquier oportunidad abierta del contacto.
        deal = await findOpenCrmDealForContact(contact, '');
    }

    return { contact, deal };
}

/**
 * Valores de los custom fields del deal.
 */
export function buildDealFieldValues(event) {
    const lead = event?.lead || {};
    const seller = event?.seller || {};
    const lover = event?.lover || {};
    const context = eventContext(event);

    return {
        seller_affiliate_id: asString(seller.affiliate_id),
        seller_username: asString(seller.username),
        seller_name: asString(seller.name),
        seller_email: asString(seller.email),
        seller_status: asString(seller.status),
        seller_referral_url: asString(seller.referral_url),
        lover_affiliate_id: asString(lover.affiliate_id),
        lover_username: asString(lover.username),
        lover_email: asString(lover.email),
        lover_name: asString(lover.name),
        lead_id: asString(lead.id),
        referral_status: context,
    };
}

function buildNoteText(event, deal) {
    const lead = event?.lead || {};
    const seller = event?.seller || {};
    const lover = event?.lover || {};
    const context = eventContext(event);
    const previousSeller = asString(event?.assignment?.previous_seller_affiliate_id);

    if (context === 'reassigned') {
        return [
            'Reasignación de Seller',
            `Lead: ${asNumber(lead.id)}`,
            `Seller anterior: ${previousSeller || 'sin dato'}`,
            `Seller nuevo: ${sellerLabel(seller)} (${asNumber(seller.affiliate_id)})`,
            `Lover: ${loverLabel(lover)} (${asNumber(lover.affiliate_id)})`,
            `Deal: ${deal?.id || ''}`,
            `Fecha: ${new Date().toISOString()}`,
            'Contexto: reasignación desde WordPress',
        ].join('\n');
    }

    return [
        'Oportunidad asignada a Seller',
        `Lead: ${asNumber(lead.id)}`,
        `Seller: ${sellerLabel(seller)} (${asNumber(seller.affiliate_id)})`,
        `Lover: ${loverLabel(lover)} (${asNumber(lover.affiliate_id)})`,
        `Deal: ${deal?.id || ''}`,
        `Fecha: ${new Date().toISOString()}`,
        `Contexto: ${context}`,
    ].join('\n');
}

async function updateDealFields(event, deal) {
    const resources = await getAffiliateResources();
    const fields = mapDealCustomFields(resources, buildDealFieldValues(event));

    if (fields.length === 0) {
        throw new Error('No hay custom fields configurados para actualizar el deal');
    }

    await updateCrmDeal(deal.id, {
        deal: {
            deal_custom_fields: fields,
        },
    });

    return fields;
}

async function addRdNote(event, deal) {
    const userId = asString(process.env.RD_CRM_NOTE_USER_ID)
        || asString(deal?.user?.id);
    if (!userId) {
        console.warn('[affiliate-opportunity] Sin usuario para nota RD; se omite nota');
        return false;
    }

    await createCrmDealNote({
        dealId: deal.id,
        userId,
        text: buildNoteText(event, deal),
    });

    return true;
}

async function sendAssignmentEvents(event) {
    const lead = event?.lead || {};
    const seller = event?.seller || {};
    const lover = event?.lover || {};
    const email = leadEmail(lead) || asString(lead.email);
    const sellerEmail = asString(seller.email);
    const context = eventContext(event);

    const payload = {
        lead_id: String(asNumber(lead.id) || ''),
        lead_name: leadName(lead),
        lead_email: email,
        lead_phone: leadPhone(lead),
        seller_affiliate_id: String(asNumber(seller.affiliate_id) || ''),
        seller_name: sellerLabel(seller),
        lover_affiliate_id: String(asNumber(lover.affiliate_id) || ''),
        lover_name: loverLabel(lover),
        referral_status: context,
    };

    if (email) {
        await sendMarketingConversionEvent(email, 'seller-asignado', payload);
    }

    if (sellerEmail) {
        await sendMarketingConversionEvent(sellerEmail, 'referido-asignado', payload);
    }
}

async function ensureSupervisionConversation(event, deal) {
    const lead = event?.lead || {};
    const email = leadEmail(lead) || asString(lead.email);
    const phone = leadPhone(lead) || asString(lead.phone);

    const contact = await ensureCenterChatwootContact({
        name: leadName(lead),
        email,
        phone,
    });

    if (!contact?.id) {
        throw new Error('No se pudo obtener el contacto C en Chatwoot');
    }

    const conversations = await chatwootClient.getConversationsByContact(contact.id);
    let conversation = conversations.find(
        (item) => Number(item.inbox_id) === SUPERVISION_INBOX_ID,
    );

    if (!conversation) {
        conversation = await chatwootClient.createConversation({
            inbox_id: SUPERVISION_INBOX_ID,
            contact_id: contact.id,
            status: 'open',
        });
    }

    const conversationId = conversation?.id || conversation?.payload?.id;
    if (!conversationId) {
        throw new Error('No se pudo crear/reutilizar la conversación de supervisión');
    }

    await chatwootClient.sendMessage(conversationId, {
        content: buildNoteText(event, deal),
        message_type: 'outgoing',
        private: true,
    });

    const current = await chatwootClient.getConversation(conversationId);
    const labels = (current?.labels || []).filter((label) => !STAGE_LABELS.includes(label));
    labels.push('oportunidad');
    await chatwootClient.setLabels(conversationId, [...new Set(labels)]);

    return {
        contactId: contact.id,
        conversationId,
    };
}

async function syncSellerConversationSafe({ sellerId, lead, note }) {
    try {
        return await syncSellerConversation({ sellerId, lead, note });
    } catch (error) {
        console.warn(`[affiliate-opportunity] Error en Chatwoot Seller ${sellerId}: ${error.message}`);
        return {
            ok: false,
            skipped: 'seller_chatwoot_error',
            error: error.message,
        };
    }
}

async function notifyPreviousSellerSafe({ sellerId, lead, note }) {
    try {
        return await notifyPreviousSellerConversation({ sellerId, lead, note });
    } catch (error) {
        console.warn(`[affiliate-opportunity] Error en Chatwoot Seller anterior ${sellerId}: ${error.message}`);
        return {
            ok: false,
            skipped: 'previous_seller_chatwoot_error',
            error: error.message,
        };
    }
}

/**
 * Procesa lead.seller_assigned, lead.seller_confirmed y
 * lead.seller_reassigned reutilizando el deal existente.
 */
export async function syncAssignmentEvent(event) {
    const { contact, deal } = await findExistingDealForEvent(event);

    if (!contact) {
        return {
            ok: false,
            reason: 'crm_contact_not_found',
        };
    }

    if (!deal) {
        return {
            ok: false,
            reason: 'existing_deal_not_found',
        };
    }

    await updateDealFields(event, deal);
    await sendAssignmentEvents(event);
    const noteCreated = await addRdNote(event, deal);
    const conversation = await ensureSupervisionConversation(event, deal);
    const noteText = buildNoteText(event, deal);
    const sellerConversation = await syncSellerConversationSafe({
        sellerId: event?.seller?.affiliate_id,
        lead: event?.lead,
        note: noteText,
    });
    const previousSellerConversation = eventContext(event) === 'reassigned'
        ? await notifyPreviousSellerSafe({
            sellerId: event?.assignment?.previous_seller_affiliate_id,
            lead: event?.lead,
            note: noteText,
        })
        : { ok: true, skipped: 'not_reassignment' };

    return {
        ok: true,
        patch: {
            rd_contact_uuid: asString(contact.id),
            rd_deal_id: asString(deal.id),
            seller_affiliate_id: asNumber(event?.seller?.affiliate_id),
            chatwoot_center_contact_id: asNumber(conversation.contactId),
            chatwoot_center_conversation_id: asNumber(conversation.conversationId),
            chatwoot_seller_conversation_id: asNumber(sellerConversation.conversationId),
            chatwoot_previous_seller_conversation_id: asNumber(previousSellerConversation.conversationId),
            seller_chatwoot_skipped: sellerConversation.skipped || '',
            previous_seller_chatwoot_skipped: previousSellerConversation.skipped || '',
            rd_note_created: noteCreated,
            referral_status: eventContext(event),
        },
    };
}

export default {
    findExistingDealForEvent,
    buildDealFieldValues,
    syncAssignmentEvent,
};

import crypto from 'node:crypto';

import rdStationClient from '../clients/rdstation.client.js';
import {
    generateEmailFromPhone,
    isFakeEmail,
    isValidEmail,
    normalizeEmail,
} from '../utils/email.utils.js';
import { normalizePhone } from '../utils/phone.utils.js';
import { getSellerContactFlags } from './seller-contact-flags.service.js';
import {
    observeCentralMirror,
    writeCentralMirror,
} from './seller-central-mirror.service.js';

/**
 * Fase 6 — Inbound de Contactos de Sellers.
 *
 * Crea/actualiza un contacto en RD Station Marketing cuando llega una
 * conversación entrante a la cuenta Chatwoot de un Seller.
 *
 * No crea contactos ni conversaciones en la cuenta principal de iChef.
 */

function asString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
}

function asNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

export function secureCompare(provided, expected) {
    const left = Buffer.from(asString(provided));
    const right = Buffer.from(asString(expected));
    if (!left.length || left.length !== right.length) {
        return false;
    }
    return crypto.timingSafeEqual(left, right);
}

export function extractInboundAccountId(payload = {}) {
    return asNumber(
        payload.account?.id
        || payload.account_id
        || payload.conversation?.account_id
        || payload.meta?.account?.id
        || 0,
    );
}

export function extractInboundContact(payload = {}) {
    return payload.meta?.sender
        || payload.sender
        || payload.contact
        || payload.conversation?.meta?.sender
        || null;
}

export function isInboundConversation(payload = {}) {
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    if (messages.length === 0) {
        return true;
    }

    return messages.some((message) => (
        message?.incoming === true
        || message?.message_type === 0
        || message?.message_type === '0'
        || message?.message_type === 'incoming'
    ));
}

function sellerUsername(config) {
    const explicit = asString(config?.seller?.username);
    if (explicit) {
        return explicit;
    }

    const referralMatch = asString(config?.seller?.referralUrl).match(/\/ref\/([^/?#]+)/i);
    if (referralMatch) {
        return referralMatch[1];
    }

    const email = asString(config?.seller?.email);
    return email.includes('@') ? email.split('@')[0] : '';
}

export function buildInboundContactPayload({ contact, config }) {
    const seller = config?.seller || {};
    const sourceName = asString(contact?.name) || 'Contacto sin nombre';
    const rawEmail = normalizeEmail(contact?.email);
    const phone = normalizePhone(asString(contact?.phone_number || contact?.phone), 'UY')
        || asString(contact?.phone_number || contact?.phone);

    let email = rawEmail;
    if (!email || !isValidEmail(email) || isFakeEmail(email)) {
        email = generateEmailFromPhone(phone) || (isValidEmail(email) ? email : '');
    }

    if (!email) {
        return null;
    }

    const payload = {
        name: sourceName,
        email,
        ...(phone ? { personal_phone: phone, mobile_phone: phone } : {}),
    };

    // Solo usar campos que existen en la cuenta RD. Los campos de nombre,
    // email y teléfono del Seller no existen como cf_seller_*; el vínculo se
    // guarda con affiliate_id/username/referral_url y cf_referido_por.
    const sellerLabel = asString(seller.name)
        || asString(seller.email)
        || sellerUsername(config);
    const sellerWithPhone = sellerLabel && asString(seller.phone)
        ? `${sellerLabel} (${asString(seller.phone)})`
        : sellerLabel;

    const sellerFields = {
        cf_seller_affiliate_id: asString(config?.affiliateId),
        cf_seller_username: sellerUsername(config),
        cf_seller_status: asString(seller.status),
        cf_seller_referral_url: asString(seller.referralUrl),
        cf_referido_por: sellerWithPhone,
    };

    for (const [key, value] of Object.entries(sellerFields)) {
        if (value) {
            payload[key] = value;
        }
    }

    return payload;
}

function extractUpsertedContact(result) {
    return result?.contact || result?.payload?.contact || result?.payload || result || null;
}

export async function processSellerInbound({
    payload,
    config,
    deps = {},
} = {}) {
    const contact = extractInboundContact(payload);
    if (!contact) {
        return { ok: false, skipped: 'contact_missing' };
    }

    if (!isInboundConversation(payload)) {
        return { ok: false, skipped: 'not_inbound' };
    }

    const contactPayload = buildInboundContactPayload({ contact, config });
    if (!contactPayload) {
        return { ok: false, skipped: 'contact_without_email_or_phone' };
    }

    const upsert = deps.upsertContact || rdStationClient.upsertContact.bind(rdStationClient);
    const result = await upsert(contactPayload);
    const registered = extractUpsertedContact(result);

    const flags = deps.getFlags ? deps.getFlags() : getSellerContactFlags();
    const mirrorContact = {
        name: contactPayload.name,
        email: contactPayload.email,
        phone_number: contactPayload.personal_phone || contactPayload.mobile_phone,
    };
    let centralMirror = null;
    if (flags.centralMirror === 'shadow') {
        const observeMirror = deps.observeCentralMirror || observeCentralMirror;
        try {
            centralMirror = await observeMirror({
                accountId: config?.accountId,
                affiliateId: config?.affiliateId,
                source: 'seller_inbound',
                contact: mirrorContact,
                contactData: contactPayload,
                deps: deps.mirrorDeps || {},
            });
        } catch (error) {
            console.warn('[seller-inbound] No se pudo observar el espejo central:', error.message);
        }
    } else if (flags.centralMirror === 'write') {
        const writeMirror = deps.writeCentralMirror || writeCentralMirror;
        try {
            centralMirror = await writeMirror({
                accountId: config?.accountId,
                affiliateId: config?.affiliateId,
                source: 'seller_inbound',
                contact: mirrorContact,
                contactData: contactPayload,
                deps: deps.mirrorDeps || {},
            });
        } catch (error) {
            console.warn('[seller-inbound] No se pudo escribir el espejo central:', error.message);
        }
    }

    return {
        ok: true,
        email: contactPayload.email,
        created: Boolean(result?.created),
        contactUuid: asString(registered?.uuid) || null,
        sellerAffiliateId: asNumber(config?.affiliateId),
        sellerAccountId: asNumber(config?.accountId),
        centralMirror,
    };
}

export default {
    secureCompare,
    extractInboundAccountId,
    extractInboundContact,
    isInboundConversation,
    buildInboundContactPayload,
    processSellerInbound,
};

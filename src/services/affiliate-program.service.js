import chatwootClient from '../clients/chatwoot.client.js';
import {
    findMarketingContact,
    sendMarketingConversionEvent,
    upsertMarketingContact,
} from './rd-affiliate.service.js';
import { generateEmailFromPhone, isFakeEmail, isValidEmail } from '../utils/email.utils.js';
import { normalizePhone } from '../utils/phone.utils.js';

/**
 * Fase 3 — Sellers y leads del programa de afiliados.
 *
 * Reglas:
 *   - Seller: upsert en RD Marketing y guarda la asociación con su Lover.
 *   - Lead: upsert de C en RD y Chatwoot cuenta 2, sin conversación.
 *   - Actualiza cf_referido_por en C y cf_referidos en el Lover.
 *   - Envía el evento de conversión referido-portal.
 *   - NO crea deals ni conversaciones. Eso corresponde a Fase 4.
 */

const REFERRAL_EVENT = 'referido-portal';
const CENTER_ACCOUNT_ID = Number(process.env.CHATWOOT_ACCOUNT_ID || 2);

function asString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
}

function asNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

export function leadName(lead) {
    const full = asString(lead?.name);
    if (full) {
        return full;
    }

    const composed = [lead?.first_name, lead?.last_name]
        .map(asString)
        .filter(Boolean)
        .join(' ')
        .trim();

    return composed || 'Contacto sin nombre';
}

export function leadPhone(lead) {
    const raw = asString(lead?.phone);
    if (!raw) {
        return '';
    }

    return normalizePhone(raw, 'UY') || raw.replace(/\D/g, '');
}

export function leadEmail(lead) {
    const raw = asString(lead?.email);
    if (raw && isValidEmail(raw) && !isFakeEmail(raw)) {
        return raw.toLowerCase();
    }

    const phone = leadPhone(lead);
    if (phone) {
        return generateEmailFromPhone(phone);
    }

    return raw && isValidEmail(raw) ? raw.toLowerCase() : '';
}

function formatReferralDate() {
    const formatter = new Intl.DateTimeFormat('es-UY', {
        timeZone: 'America/Montevideo',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });

    return formatter.format(new Date());
}

function parseReferrals(raw) {
    if (!raw) {
        return [];
    }

    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function referralEntry(lead, name) {
    return {
        name,
        phone: asString(lead?.phone),
        date: formatReferralDate(),
        coupon: '',
        type: 'referido',
    };
}

function mergeReferral(rows, entry) {
    const phone = asString(entry.phone);
    const filtered = rows.filter((row) => {
        if (phone && asString(row?.phone) === phone) {
            return false;
        }
        return true;
    });

    filtered.push(entry);
    return filtered;
}

function loverDisplayName(lover, loverContact) {
    return (
        asString(loverContact?.name)
        || asString(lover?.name)
        || asString(lover?.username)
        || asString(lover?.email)
        || 'Lover'
    );
}

function buildReferidoPor(lover, loverContact) {
    const name = loverDisplayName(lover, loverContact);
    const phone = asString(loverContact?.personal_phone || loverContact?.mobile_phone);

    return phone ? `${name} (${phone})` : name;
}

/**
 * Payload de contacto de Marketing para un Seller.
 */
export function buildSellerContactPayload(event) {
    const seller = event?.seller || {};
    const lover = event?.lover || null;

    return {
        name: asString(seller.name) || asString(seller.username) || asString(seller.email),
        email: asString(seller.email),
        personal_phone: asString(seller.phone),
        mobile_phone: asString(seller.phone),
        cf_tipo_afiliado: 'Seller',
        cf_seller_affiliate_id: asString(seller.affiliate_id),
        cf_seller_username: asString(seller.username),
        cf_seller_status: asString(seller.status),
        cf_seller_referral_url: asString(seller.referral_url),
        cf_lover_affiliate_id: asString(lover?.affiliate_id),
        cf_lover_username: asString(lover?.username),
        cf_lover_email: asString(lover?.email),
        cf_lover_name: asString(lover?.name),
    };
}

/**
 * Payload de contacto C en RD Marketing.
 *
 * `loverContact` viene de RD y se usa para mantener el mismo formato histórico
 * de `cf_referido_por`: "Nombre (teléfono)".
 */
export function buildLeadContactPayload(event, loverContact = null) {
    const lead = event?.lead || {};
    const lover = event?.lover || null;

    return {
        name: leadName(lead),
        email: leadEmail(lead),
        personal_phone: leadPhone(lead),
        cf_referido_por: buildReferidoPor(lover, loverContact),
    };
}

/**
 * Payload para actualizar el contacto del Lover con su lista de referidos.
 */
export function buildLoverReferralsPayload(lover, loverContact, lead = {}) {
    const current = parseReferrals(loverContact?.cf_referidos);
    const entry = referralEntry(lead, leadName(lead));

    return {
        email: asString(lover?.email),
        name: loverDisplayName(lover, loverContact),
        cf_referidos: JSON.stringify(mergeReferral(current, entry)),
    };
}

function extractContact(response) {
    return (
        response?.contact
        || response?.payload?.contact
        || response?.payload
        || response
        || null
    );
}

export async function ensureCenterChatwootContact({ name, email, phone }) {
    let existing = null;

    if (email) {
        existing = await chatwootClient.findContact({ email });
    }

    if (!existing && phone) {
        existing = await chatwootClient.findContact({ phone_number: phone });
    }

    if (existing) {
        const updates = {};

        if (!existing.name && name) {
            updates.name = name;
        }
        if (!existing.email && email) {
            updates.email = email;
        }
        if (!existing.phone_number && phone) {
            updates.phone_number = phone;
        }

        if (Object.keys(updates).length > 0) {
            const updated = await chatwootClient.updateContact(existing.id, updates);
            return extractContact(updated) || { ...existing, ...updates };
        }

        return existing;
    }

    try {
        const created = await chatwootClient.createContact({
            name,
            ...(email ? { email } : {}),
            ...(phone ? { phone_number: phone } : {}),
        });

        return extractContact(created);
    } catch (error) {
        const duplicatePhone = error.response?.status === 422
            && error.response?.data?.message?.includes('Phone number has already been taken')
            && phone;

        if (!duplicatePhone) {
            throw error;
        }

        const digits = phone.replace(/\D/g, '');
        const matches = await chatwootClient.searchContacts(digits);
        const match = matches.find((contact) => (
            asString(contact.phone_number).replace(/\D/g, '') === digits
        )) || matches[0];

        if (!match?.id) {
            throw error;
        }

        return match;
    }
}

/**
 * Procesa seller.created, seller.updated y seller.lover_linked.
 */
export async function syncSellerEvent(event) {
    const payload = buildSellerContactPayload(event);

    if (!payload.email) {
        return {
            ok: false,
            reason: 'seller_email_missing',
        };
    }

    const result = await upsertMarketingContact(payload);
    const contact = extractContact(result);

    return {
        ok: true,
        patch: {
            seller_affiliate_id: asNumber(event?.seller?.affiliate_id),
            rd_contact_uuid: asString(contact?.uuid),
        },
    };
}

/**
 * Procesa lead.created.
 */
export async function syncLeadCreatedEvent(event) {
    const lead = event?.lead || {};
    const lover = event?.lover || null;
    const name = leadName(lead);
    const email = leadEmail(lead);
    const phone = leadPhone(lead);

    if (!email && !phone) {
        return {
            ok: false,
            reason: 'lead_without_email_or_phone',
        };
    }

    let loverContact = null;
    if (lover?.email) {
        loverContact = await findMarketingContact(lover.email);

        if (!loverContact) {
            const created = await upsertMarketingContact({
                name: loverDisplayName(lover, null),
                email: asString(lover.email),
            });
            loverContact = extractContact(created);
        }
    }

    const leadPayload = buildLeadContactPayload(event, loverContact);
    const leadResult = await upsertMarketingContact(leadPayload);
    const leadContact = extractContact(leadResult);

    const centerContact = await ensureCenterChatwootContact({
        name,
        email,
        phone,
    });

    let loverUpdated = false;
    if (lover?.email) {
        const loverPayload = buildLoverReferralsPayload(lover, loverContact, lead);
        await upsertMarketingContact(loverPayload);
        loverUpdated = true;
    }

    await sendMarketingConversionEvent(email, REFERRAL_EVENT, {
        name,
        personal_phone: phone,
    });

    return {
        ok: true,
        patch: {
            seller_affiliate_id: asNumber(lead.partner_affiliate_id),
            rd_contact_uuid: asString(leadContact?.uuid),
            chatwoot_center_contact_id: asNumber(centerContact?.id),
            chatwoot_center_account_id: CENTER_ACCOUNT_ID,
            lover_referrals_updated: loverUpdated,
        },
    };
}

export default {
    buildSellerContactPayload,
    buildLeadContactPayload,
    buildLoverReferralsPayload,
    syncSellerEvent,
    syncLeadCreatedEvent,
};

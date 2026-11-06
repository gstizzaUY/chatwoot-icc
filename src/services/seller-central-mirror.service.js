import chatwootClient from '../clients/chatwoot.client.js';
import {
    getSellerContactFlags,
} from './seller-contact-flags.service.js';
import {
    normalizeEmail,
} from '../utils/email.utils.js';

/**
 * Fase 7 — Espejo central en modo shadow.
 *
 * Busca el contacto equivalente en la cuenta 2 y registra qué pasaría si se
 * activara la escritura. NO crea, NO actualiza y NO borra contactos centrales.
 */

function asString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
}

function digits(value) {
    return asString(value).replace(/\D/g, '');
}

function normalizeName(value) {
    return asString(value).toLowerCase().replace(/\s+/g, ' ');
}

function normalizePhone(value) {
    return digits(value);
}

function sameValue(left, right) {
    return normalizeName(left) === normalizeName(right);
}

function fieldDiff(field, centralValue, incomingValue, normalize = sameValue) {
    const central = asString(centralValue);
    const incoming = asString(incomingValue);
    return {
        field,
        presentInCentral: Boolean(central),
        presentInIncoming: Boolean(incoming),
        matches: Boolean(central && incoming && normalize(central, incoming)),
    };
}

function publicContact(contact) {
    if (!contact) {
        return null;
    }
    return {
        id: contact.id ?? null,
        name: contact.name || '',
        email: contact.email || '',
        phone_number: contact.phone_number || '',
    };
}

async function searchCentralContacts(term, deps) {
    if (!term) {
        return [];
    }
    const search = deps.searchContacts || chatwootClient.searchContacts.bind(chatwootClient);
    const result = await search(term);
    return Array.isArray(result) ? result : [];
}

export async function findCentralContact({
    email,
    phone,
    deps = {},
} = {}) {
    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = digits(phone);

    let emailMatches = [];
    if (normalizedEmail) {
        emailMatches = await searchCentralContacts(normalizedEmail, deps);
        const exact = emailMatches.find(
            (contact) => normalizeEmail(contact.email) === normalizedEmail,
        );
        if (exact?.id) {
            return {
                contact: exact,
                matchedBy: 'email',
                candidates: [exact],
                ambiguous: false,
            };
        }
    }

    let phoneMatches = [];
    if (normalizedPhone) {
        phoneMatches = await searchCentralContacts(normalizedPhone, deps);
        const exact = phoneMatches.find(
            (contact) => digits(contact.phone_number) === normalizedPhone,
        );
        if (exact?.id) {
            return {
                contact: exact,
                matchedBy: 'phone',
                candidates: [exact],
                ambiguous: emailMatches.length > 1 || phoneMatches.length > 1,
            };
        }
    }

    const candidates = [...emailMatches, ...phoneMatches]
        .filter((contact, index, list) => (
            contact?.id && list.findIndex((item) => item?.id === contact.id) === index
        ));

    return {
        contact: null,
        matchedBy: null,
        candidates,
        ambiguous: candidates.length > 1,
    };
}

export async function observeCentralMirror({
    accountId,
    affiliateId,
    source,
    contact = {},
    contactData = {},
    deps = {},
} = {}) {
    const flags = deps.getFlags ? deps.getFlags() : getSellerContactFlags();

    // Fase 7 es solo observación. La escritura central no se implementa acá.
    if (flags.centralMirror !== 'shadow') {
        return {
            ok: true,
            skipped: 'central_mirror_not_shadow',
            mode: flags.centralMirror,
        };
    }

    const email = normalizeEmail(contact.email || contactData.email);
    const phone = digits(contact.phone_number || contactData.mobile_phone || contactData.phone);
    const name = asString(contact.name || contactData.name);

    if (!email && !phone) {
        return {
            ok: true,
            skipped: 'contact_without_identity',
        };
    }

    try {
        const found = await findCentralContact({ email, phone, deps });
        const central = found.contact;
        const differences = central
            ? [
                fieldDiff('name', central.name, name),
                fieldDiff('email', central.email, email, (a, b) => normalizeEmail(a) === normalizeEmail(b)),
                fieldDiff('phone_number', central.phone_number, phone, (a, b) => digits(a) === digits(b)),
            ].filter((diff) => !diff.matches)
            : [];

        const report = {
            ok: true,
            mode: 'shadow',
            source,
            sellerAccountId: Number(accountId) || null,
            sellerAffiliateId: Number(affiliateId) || null,
            centralAccountId: Number(process.env.CHATWOOT_ACCOUNT_ID || 2),
            centralFound: Boolean(central),
            centralContactId: central?.id || null,
            matchedBy: found.matchedBy,
            ambiguous: found.ambiguous,
            candidateContactIds: found.candidates.map((item) => item.id).filter(Boolean),
            wouldCreate: !central,
            wouldUpdate: Boolean(central) && differences.length > 0,
            identityMatches: Boolean(central)
                && differences.every((diff) => diff.field !== 'email' && diff.field !== 'phone_number'),
            differences,
            centralCustomAttributeKeys: Object.keys(central?.custom_attributes || {}).length,
        };

        console.log('[seller-mirror]', JSON.stringify(report));
        return report;
    } catch (error) {
        const report = {
            ok: false,
            mode: 'shadow',
            source,
            sellerAccountId: Number(accountId) || null,
            sellerAffiliateId: Number(affiliateId) || null,
            error: error.message,
        };
        console.warn('[seller-mirror] Error en shadow:', error.message);
        return report;
    }
}

export default {
    findCentralContact,
    observeCentralMirror,
};

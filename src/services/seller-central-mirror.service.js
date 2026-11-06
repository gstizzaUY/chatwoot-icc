import chatwootClient from '../clients/chatwoot.client.js';
import {
    getSellerContactFlags,
    isCentralWriteAllowedForContact,
} from './seller-contact-flags.service.js';
import {
    generateEmailFromPhone,
    isValidEmail,
    normalizeEmail,
} from '../utils/email.utils.js';
import { normalizePhone } from '../utils/phone.utils.js';
import {
    fetchContactDefinitions,
    mapRdFieldsToChatwoot,
} from './contact-field-mapping.service.js';

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

function normalizeChatwootPhone(value) {
    const raw = asString(value);
    if (!raw) {
        return '';
    }

    if (/^\+\d{8,15}$/.test(raw)) {
        return raw;
    }

    return normalizePhone(raw, 'UY') || '';
}

function buildCentralIdentityPatch(central, { name, email, phone }) {
    const updates = {};
    const cleanName = asString(name);
    const cleanEmail = normalizeEmail(email);
    const cleanPhone = normalizeChatwootPhone(phone);

    if (cleanName && cleanName !== asString(central?.name)) {
        updates.name = cleanName;
    }
    if (cleanEmail && isValidEmail(cleanEmail) && cleanEmail !== normalizeEmail(central?.email)) {
        updates.email = cleanEmail;
    }
    if (cleanPhone && cleanPhone !== asString(central?.phone_number)) {
        updates.phone_number = cleanPhone;
    }

    return updates;
}

/**
 * Escritura controlada en la cuenta central.
 *
 * Sincroniza todos los campos RD que tengan un atributo equivalente en
 * Chatwoot. Conserva las protecciones de stage/tiene_ichef/es_cliente.
 *
 * No toca etiquetas, conversaciones ni mensajes.
 */
export async function writeCentralMirror({
    accountId,
    affiliateId,
    source,
    contact = {},
    contactData = {},
    deps = {},
} = {}) {
    const flags = deps.getFlags ? deps.getFlags() : getSellerContactFlags();

    if (flags.centralMirror !== 'write') {
        return {
            ok: true,
            skipped: 'central_mirror_not_write',
            mode: flags.centralMirror,
        };
    }

    const email = normalizeEmail(contact.email || contactData.email)
        || generateEmailFromPhone(asString(contact.phone_number || contactData.mobile_phone || contactData.phone))
        || '';
    const phone = normalizeChatwootPhone(
        contact.phone_number || contactData.mobile_phone || contactData.phone,
    );
    const name = asString(contact.name || contactData.name);

    if (!isCentralWriteAllowedForContact({ email, phone }, flags)) {
        return {
            ok: true,
            skipped: 'central_write_not_allowlisted',
            mode: 'write',
        };
    }

    if (!email && !phone) {
        return {
            ok: true,
            skipped: 'contact_without_identity',
            mode: 'write',
        };
    }

    try {
        const found = await findCentralContact({ email, phone, deps });
        const definitions = deps.definitions || await (
            deps.fetchContactDefinitions || fetchContactDefinitions
        )({
            baseUrl: process.env.CHATWOOT_URL,
            token: process.env.API_ACCESS_TOKEN,
            accountId: process.env.CHATWOOT_ACCOUNT_ID || 2,
            fetcher: deps.definitionsFetcher,
        });

        const mapped = mapRdFieldsToChatwoot({
            rdData: contactData,
            definitions,
            currentAttributes: found.contact?.custom_attributes || {},
            clearFields: contactData.clearFields || [],
        });

        if (!found.contact?.id) {
            const payload = buildCentralIdentityPatch(null, { name, email, phone });
            if (Object.keys(mapped.attributes).length > 0) {
                payload.custom_attributes = mapped.attributes;
            }
            if (!payload.email && !payload.phone_number) {
                return {
                    ok: true,
                    skipped: 'contact_without_valid_identity',
                    mode: 'write',
                };
            }

            const create = deps.createContact || chatwootClient.createContact.bind(chatwootClient);
            const created = await create(payload);
            const central = created?.payload || created?.contact || created;

            const report = {
                ok: true,
                mode: 'write',
                source,
                sellerAccountId: Number(accountId) || null,
                sellerAffiliateId: Number(affiliateId) || null,
                action: 'created',
                centralContactId: central?.id || null,
                fields: [
                    ...Object.keys(payload).filter((key) => key !== 'custom_attributes'),
                    ...Object.keys(mapped.attributes),
                ],
                omittedFields: mapped.omitted,
                protectedFields: mapped.protectedFields,
            };
            console.log('[seller-mirror-write]', JSON.stringify({
                ...report,
                omittedFields: report.omittedFields.length,
            }));
            return report;
        }

        const identityUpdates = buildCentralIdentityPatch(found.contact, { name, email, phone });
        const updates = { ...identityUpdates };
        if (Object.keys(mapped.attributes).length > 0) {
            updates.custom_attributes = {
                ...(found.contact.custom_attributes || {}),
                ...mapped.attributes,
            };
        }

        if (Object.keys(updates).length === 0) {
            const report = {
                ok: true,
                mode: 'write',
                source,
                action: 'none',
                centralContactId: found.contact.id,
                fields: [],
                omittedFields: mapped.omitted,
                protectedFields: mapped.protectedFields,
            };
            console.log('[seller-mirror-write]', JSON.stringify({
                ...report,
                omittedFields: report.omittedFields.length,
            }));
            return report;
        }

        const update = deps.updateContact || chatwootClient.updateContact.bind(chatwootClient);
        await update(found.contact.id, updates);

        const report = {
            ok: true,
            mode: 'write',
            source,
            sellerAccountId: Number(accountId) || null,
            sellerAffiliateId: Number(affiliateId) || null,
            action: 'updated',
            centralContactId: found.contact.id,
            fields: [
                ...Object.keys(identityUpdates),
                ...Object.keys(mapped.attributes),
            ],
            omittedFields: mapped.omitted,
            protectedFields: mapped.protectedFields,
        };
        console.log('[seller-mirror-write]', JSON.stringify({
            ...report,
            omittedFields: report.omittedFields.length,
        }));
        return report;
    } catch (error) {
        const report = {
            ok: false,
            mode: 'write',
            source,
            sellerAccountId: Number(accountId) || null,
            sellerAffiliateId: Number(affiliateId) || null,
            error: error.message,
        };
        console.warn('[seller-mirror-write] Error:', error.message);
        return report;
    }
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
    writeCentralMirror,
};

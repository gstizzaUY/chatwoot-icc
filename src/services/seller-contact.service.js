import axios from 'axios';

import {
    assertSellerAccountAllowed,
} from './seller-chatwoot-registry.service.js';
import {
    canWriteSellerContact,
    getSellerContactFlags,
} from './seller-contact-flags.service.js';
import {
    UpdateContactExtended,
    buildChatwootUpdatePayload,
    sanitizeContactPayload,
} from '../../controllers/registerContactController.js';
import {
    generateEmailFromPhone,
    normalizeEmail,
} from '../utils/email.utils.js';
import {
    observeCentralMirror,
    writeCentralMirror,
} from './seller-central-mirror.service.js';

/**
 * Fase 3 — Actualización aislada de un contacto de Seller.
 *
 * Este servicio actualiza:
 *   1. RD Station Marketing (cuenta central);
 *   2. el contacto de Chatwoot de la cuenta del Seller.
 *
 * NO actualiza la cuenta 2 de iChef. El espejo central queda para una fase
 * posterior y con un flag independiente.
 */

const REQUEST_TIMEOUT_MS = 30000;

export class SellerContactError extends Error {
    constructor(code, message, status = 400, details = null) {
        super(message);
        this.name = 'SellerContactError';
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

function asString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
}

function asNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function normalizeUrl(url) {
    return asString(url).replace(/\/+$/, '');
}

function sellerClientFor(config) {
    return axios.create({
        baseURL: `${normalizeUrl(config.url)}/api/v1/accounts/${config.accountId}`,
        headers: {
            'Content-Type': 'application/json',
            api_access_token: config.token,
        },
        timeout: REQUEST_TIMEOUT_MS,
    });
}

function contactFromResponse(response) {
    return response?.data?.payload?.contact
        || response?.data?.payload
        || response?.data
        || null;
}

async function fetchSellerContactById(client, contactId) {
    if (!contactId) {
        return null;
    }

    try {
        const response = await client.get(`/contacts/${encodeURIComponent(contactId)}`);
        return contactFromResponse(response);
    } catch (error) {
        if (error.response?.status === 404) {
            return null;
        }
        throw new SellerContactError(
            'SELLER_CHATWOOT_READ_FAILED',
            `No se pudo leer el contacto ${contactId} del Seller: ${error.message}`,
            502,
        );
    }
}

async function searchSellerContacts(client, query) {
    if (!query) {
        return [];
    }

    try {
        const response = await client.get('/contacts/search', {
            params: {
                q: query,
                include_contacts: true,
                page: 1,
            },
        });
        return response.data?.payload || [];
    } catch (error) {
        throw new SellerContactError(
            'SELLER_CHATWOOT_SEARCH_FAILED',
            `No se pudo buscar el contacto del Seller: ${error.message}`,
            502,
        );
    }
}

function digits(value) {
    return asString(value).replace(/\D/g, '');
}

function matchesIdentity(contact, { email, phone }) {
    const contactEmail = normalizeEmail(contact?.email);
    if (email && contactEmail && contactEmail === email) {
        return true;
    }

    const contactPhone = digits(contact?.phone_number);
    return Boolean(phone && contactPhone && contactPhone === phone);
}

async function resolveSellerContact(client, { contactId, email, phone }) {
    const byId = await fetchSellerContactById(client, contactId);
    if (byId?.id) {
        return byId;
    }

    if (email) {
        const matches = await searchSellerContacts(client, email);
        const exact = matches.find((contact) => matchesIdentity(contact, { email, phone: null }));
        if (exact?.id) {
            return exact;
        }
    }

    if (phone) {
        const matches = await searchSellerContacts(client, phone);
        const exact = matches.find((contact) => matchesIdentity(contact, { email: null, phone }));
        if (exact?.id) {
            return exact;
        }
    }

    throw new SellerContactError(
        'SELLER_CONTACT_NOT_FOUND',
        'No se encontró el contacto en la cuenta del Seller',
        404,
    );
}

function resolveEmail(contactData) {
    const email = normalizeEmail(contactData.email);
    if (email) {
        return email;
    }

    const phone = contactData.mobile_phone || contactData.phone;
    return generateEmailFromPhone(asString(phone)) || null;
}

function resolveMobilePhone(contactData) {
    return asString(contactData.mobile_phone || contactData.phone) || null;
}

function buildRdPayload(contactData) {
    // Mismo criterio del endpoint histórico: email/phone se usan como
    // identificadores y no se envían dentro del PATCH de campos.
    const { email, phone, ...fields } = contactData;
    return fields;
}

/**
 * Actualiza RD y el contacto de Chatwoot del Seller.
 *
 * `deps` permite inyectar implementaciones en tests sin tocar APIs reales.
 */
export async function updateSellerContact({
    accountId,
    affiliateId,
    contactId = null,
    contactData = {},
    deps = {},
} = {}) {
    const sellerAccountId = asNumber(accountId);
    const sellerAffiliateId = asNumber(affiliateId);

    if (!sellerAccountId) {
        throw new SellerContactError(
            'INVALID_SELLER_ACCOUNT',
            'seller_account_id es obligatorio',
            400,
        );
    }

    const flags = deps.getFlags ? deps.getFlags() : getSellerContactFlags();
    if (!canWriteSellerContact(sellerAccountId, flags)) {
        throw new SellerContactError(
            'SELLER_CONTACT_SYNC_DISABLED',
            'La sincronización de contacto del Seller no está habilitada para esta cuenta',
            403,
        );
    }

    const config = (deps.resolveSeller || assertSellerAccountAllowed)({
        accountId: sellerAccountId,
        affiliateId: sellerAffiliateId || null,
    });

    const client = (deps.createClient || sellerClientFor)(config);
    const email = resolveEmail(contactData);
    const phone = resolveMobilePhone(contactData);

    if (!email && !phone) {
        throw new SellerContactError(
            'CONTACT_IDENTITY_REQUIRED',
            'El contacto no tiene email ni teléfono para identificar el registro',
            400,
        );
    }

    const contact = deps.findContact
        ? await deps.findContact({ client, contactId, email, phone })
        : await resolveSellerContact(client, {
            contactId: asNumber(contactId) || null,
            email,
            phone: digits(phone),
        });

    if (!contact?.id) {
        throw new SellerContactError(
            'SELLER_CONTACT_NOT_FOUND',
            'No se encontró el contacto en la cuenta del Seller',
            404,
        );
    }

    const sanitize = deps.sanitizeContactPayload || sanitizeContactPayload;
    const updateRd = deps.updateRdContact || UpdateContactExtended;
    const buildPayload = deps.buildChatwootUpdatePayload || buildChatwootUpdatePayload;

    let rdUpdated = null;
    try {
        const rdPayload = await sanitize(buildRdPayload(contactData));
        rdUpdated = await updateRd(email, rdPayload);
    } catch (error) {
        throw new SellerContactError(
            'RD_UPDATE_FAILED',
            `No se pudo actualizar RD Station: ${error.message}`,
            502,
            { code: error.code || null, status: error.status || null },
        );
    }

    let chatwootPayload = {};
    try {
        chatwootPayload = buildPayload({
            ...contactData,
            email: email || contactData.email,
            mobile_phone: phone || contactData.mobile_phone,
        }, contact);
    } catch (error) {
        throw new SellerContactError(
            'SELLER_CONTACT_PAYLOAD_FAILED',
            `No se pudo preparar la actualización de Chatwoot: ${error.message}`,
            500,
        );
    }

    if (Object.keys(chatwootPayload).length > 0) {
        try {
            await client.put(`/contacts/${encodeURIComponent(contact.id)}`, chatwootPayload);
        } catch (error) {
            throw new SellerContactError(
                'SELLER_CHATWOOT_UPDATE_FAILED',
                `RD fue actualizado, pero falló Chatwoot del Seller: ${error.message}`,
                502,
                { rdUpdated: true, contactId: contact.id },
            );
        }
    }

    let centralMirror = null;
    if (flags.centralMirror === 'shadow') {
        const observeMirror = deps.observeCentralMirror || observeCentralMirror;
        try {
            centralMirror = await observeMirror({
                accountId: sellerAccountId,
                affiliateId: config.affiliateId,
                source: 'seller_edit',
                contact: {
                    name: contactData.name,
                    email,
                    phone_number: phone,
                },
                contactData,
                deps: deps.mirrorDeps || {},
            });
        } catch (error) {
            console.warn('[seller-contact] No se pudo observar el espejo central:', error.message);
        }
    } else if (flags.centralMirror === 'write') {
        const writeMirror = deps.writeCentralMirror || writeCentralMirror;
        try {
            centralMirror = await writeMirror({
                accountId: sellerAccountId,
                affiliateId: config.affiliateId,
                source: 'seller_edit',
                contact: {
                    name: contactData.name,
                    email,
                    phone_number: phone,
                },
                contactData,
                deps: deps.mirrorDeps || {},
            });
        } catch (error) {
            console.warn('[seller-contact] No se pudo escribir el espejo central:', error.message);
        }
    }

    return {
        ok: true,
        sellerAccountId,
        sellerAffiliateId: config.affiliateId,
        contactId: contact.id,
        rdUpdated: Boolean(rdUpdated),
        chatwootUpdated: Object.keys(chatwootPayload).length > 0,
        updatedFields: Object.keys(chatwootPayload),
        centralMirror,
    };
}

export default {
    SellerContactError,
    updateSellerContact,
};

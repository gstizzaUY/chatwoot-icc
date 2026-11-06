import axios from 'axios';
import { generateEmailFromPhone, isValidEmail } from '../utils/email.utils.js';
import { normalizePhone } from '../utils/phone.utils.js';
import { STAGE_LABELS } from '../utils/stage-labels.utils.js';

/**
 * Fase 5 — Instancias Chatwoot de Sellers.
 *
 * Cada Seller puede tener su propia instancia:
 *
 *   CHATWOOT_SELLER_<AFFILIATE_ID>_URL
 *   CHATWOOT_SELLER_<AFFILIATE_ID>_ACCOUNT_ID
 *   CHATWOOT_SELLER_<AFFILIATE_ID>_TOKEN
 *   CHATWOOT_SELLER_<AFFILIATE_ID>_INBOX_ID
 *   CHATWOOT_SELLER_<AFFILIATE_ID>_TEAM_ID
 *   CHATWOOT_SELLER_<AFFILIATE_ID>_ASSIGNEE_ID
 *
 * Opcionales para provisión y metadatos:
 *
 *   CHATWOOT_SELLER_<AFFILIATE_ID>_ADMIN_TOKEN
 *   CHATWOOT_SELLER_<AFFILIATE_ID>_PROVISIONING_TOKEN
 *   CHATWOOT_SELLER_<AFFILIATE_ID>_SELLER_NAME
 *   CHATWOOT_SELLER_<AFFILIATE_ID>_SELLER_EMAIL
 *   CHATWOOT_SELLER_<AFFILIATE_ID>_SELLER_PHONE
 *   CHATWOOT_SELLER_<AFFILIATE_ID>_SELLER_REFERRAL_URL
 *
 * Si faltan URL, ACCOUNT_ID o TOKEN, la instancia queda sin configurar y el
 * flujo continúa sin error. El INBOX_ID sigue siendo obligatorio para el flujo
 * histórico de conversaciones; para provisión se usa
 * `getSellerChatwootAccountConfig()`, que no lo exige.
 */

const REQUEST_TIMEOUT = 30000;

function asString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
}

function asNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function readSellerConfig(affiliateId, { requireInbox = false } = {}) {
    const id = asNumber(affiliateId);
    if (!id) {
        return null;
    }

    const prefix = `CHATWOOT_SELLER_${id}_`;
    const url = asString(process.env[`${prefix}URL`]).replace(/\/+$/, '');
    const accountId = asString(process.env[`${prefix}ACCOUNT_ID`]);
    const token = asString(process.env[`${prefix}TOKEN`]);
    const inboxId = asString(process.env[`${prefix}INBOX_ID`]);

    if (!url || !accountId || !token || (requireInbox && !inboxId)) {
        return null;
    }

    return {
        affiliateId: id,
        url,
        accountId,
        token,
        inboxId: inboxId ? Number(inboxId) : null,
        teamId: asNumber(process.env[`${prefix}TEAM_ID`]) || null,
        assigneeId: asNumber(process.env[`${prefix}ASSIGNEE_ID`]) || null,
        adminToken: asString(process.env[`${prefix}ADMIN_TOKEN`])
            || asString(process.env[`${prefix}PROVISIONING_TOKEN`])
            || null,
        seller: {
            name: asString(process.env[`${prefix}SELLER_NAME`]),
            username: asString(process.env[`${prefix}SELLER_USERNAME`]),
            email: asString(process.env[`${prefix}SELLER_EMAIL`]),
            phone: asString(process.env[`${prefix}SELLER_PHONE`]),
            status: asString(process.env[`${prefix}SELLER_STATUS`]),
            referralUrl: asString(process.env[`${prefix}SELLER_REFERRAL_URL`]),
        },
    };
}

/**
 * Configuración histórica para conversaciones de Seller.
 * Requiere INBOX_ID para evitar que un flujo incompleto intente crear
 * conversaciones sin canal.
 */
export function getSellerChatwootConfig(affiliateId) {
    return readSellerConfig(affiliateId, { requireInbox: true });
}

/**
 * Configuración para tareas de cuenta (campos, dashboard apps, webhooks).
 * No exige INBOX_ID; solo URL, ACCOUNT_ID y TOKEN.
 */
export function getSellerChatwootAccountConfig(affiliateId) {
    return readSellerConfig(affiliateId, { requireInbox: false });
}

function clientFor(config) {
    return axios.create({
        baseURL: `${config.url}/api/v1/accounts/${config.accountId}`,
        headers: {
            'Content-Type': 'application/json',
            api_access_token: config.token,
        },
        timeout: REQUEST_TIMEOUT,
    });
}

function contactFromResponse(response) {
    return response?.data?.payload?.contact
        || response?.data?.payload
        || response?.data
        || null;
}

async function findContact(client, { email, phone }) {
    if (email) {
        try {
            const response = await client.post('/contacts/filter', {
                payload: [{
                    attribute_key: 'email',
                    filter_operator: 'equal_to',
                    values: [email],
                    query_operator: null,
                }],
            });

            if ((response.data?.meta?.count || 0) > 0) {
                return response.data.payload?.[0] || null;
            }
        } catch (error) {
            console.warn(`[seller-chatwoot] Error buscando contacto por email: ${error.message}`);
        }
    }

    if (phone) {
        try {
            const response = await client.post('/contacts/filter', {
                payload: [{
                    attribute_key: 'phone_number',
                    filter_operator: 'equal_to',
                    values: [phone],
                    query_operator: null,
                }],
            });

            if ((response.data?.meta?.count || 0) > 0) {
                return response.data.payload?.[0] || null;
            }
        } catch (error) {
            console.warn(`[seller-chatwoot] Error buscando contacto por teléfono: ${error.message}`);
        }
    }

    return null;
}

async function createContact(client, { name, email, phone }) {
    const payload = {
        name: name || 'Contacto sin nombre',
        ...(email ? { email } : {}),
        ...(phone ? { phone_number: phone } : {}),
    };

    try {
        const response = await client.post('/contacts', payload);
        return contactFromResponse(response);
    } catch (error) {
        const duplicatePhone = error.response?.status === 422
            && error.response?.data?.message?.includes('Phone number has already been taken')
            && phone;

        if (!duplicatePhone) {
            throw error;
        }

        const digits = phone.replace(/\D/g, '');
        const search = await client.get('/contacts/search', {
            params: { q: digits, include_contacts: true, page: 1 },
        });
        const matches = search.data?.payload || [];
        const match = matches.find((contact) => (
            String(contact.phone_number || '').replace(/\D/g, '') === digits
        )) || matches[0];

        if (!match) {
            throw error;
        }

        return match;
    }
}

async function ensureContact(client, lead, createIfMissing) {
    const email = asString(lead.email);
    const normalPhone = lead.phone ? normalizePhone(String(lead.phone), 'UY') : null;
    const contactEmail = email && isValidEmail(email)
        ? email.toLowerCase()
        : generateEmailFromPhone(normalPhone);

    let contact = await findContact(client, { email: contactEmail, phone: normalPhone });

    if (!contact && createIfMissing) {
        contact = await createContact(client, {
            name: lead.name || 'Contacto sin nombre',
            email: contactEmail,
            phone: normalPhone,
        });
    }

    return contact;
}

async function findConversation(client, contactId, inboxId) {
    const response = await client.get(`/contacts/${encodeURIComponent(contactId)}/conversations`);
    const conversations = response.data?.payload || response.data || [];

    return conversations.find((conversation) => (
        Number(conversation.inbox_id) === Number(inboxId)
    )) || null;
}

async function reopenConversation(client, conversation) {
    if (!conversation || conversation.status === 'open') {
        return conversation;
    }

    await client.post(`/conversations/${encodeURIComponent(conversation.id)}/toggle_status`, {
        status: 'open',
    });

    return { ...conversation, status: 'open' };
}

async function ensureConversation(client, config, contact) {
    let conversation = await findConversation(client, contact.id, config.inboxId);

    if (conversation) {
        return {
            conversation: await reopenConversation(client, conversation),
            created: false,
            reopened: conversation.status !== 'open',
        };
    }

    const payload = {
        inbox_id: config.inboxId,
        contact_id: contact.id,
        status: 'open',
    };

    if (config.assigneeId) payload.assignee_id = config.assigneeId;
    if (config.teamId) payload.team_id = config.teamId;

    const response = await client.post('/conversations', payload);

    return {
        conversation: response.data,
        created: true,
        reopened: false,
    };
}

async function applyOpportunityLabel(client, conversationId) {
    const response = await client.get(`/conversations/${encodeURIComponent(conversationId)}`);
    const current = response.data?.labels || [];
    const labels = current.filter((label) => !STAGE_LABELS.includes(label));
    labels.push('oportunidad');

    await client.post(`/conversations/${encodeURIComponent(conversationId)}/labels`, {
        labels: [...new Set(labels)],
    });
}

async function sendPrivateNote(client, conversationId, note) {
    await client.post(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
        content: note,
        message_type: 'outgoing',
        private: true,
    });
}

/**
 * Sincroniza C y la conversación en la instancia del Seller.
 * Devuelve skipped si el Seller no tiene instancia configurada.
 */
export async function syncSellerConversation({ sellerId, lead, note }) {
    const config = getSellerChatwootConfig(sellerId);

    if (!config) {
        return {
            ok: true,
            skipped: 'seller_chatwoot_not_configured',
            configured: false,
        };
    }

    const client = clientFor(config);
    const contact = await ensureContact(client, lead, true);

    if (!contact?.id) {
        throw new Error('No se pudo crear/encontrar C en la instancia del Seller');
    }

    const { conversation, created, reopened } = await ensureConversation(client, config, contact);
    const conversationId = conversation?.id || conversation?.payload?.id;

    if (!conversationId) {
        throw new Error('No se pudo crear/reutilizar la conversación del Seller');
    }

    await sendPrivateNote(client, conversationId, note);
    await applyOpportunityLabel(client, conversationId);

    return {
        ok: true,
        configured: true,
        contactId: contact.id,
        conversationId,
        created,
        reopened,
    };
}

/**
 * En una reasignación, agrega una nota en la conversación del Seller anterior.
 * No crea una conversación nueva si no existe: solo reabre la existente.
 */
export async function notifyPreviousSellerConversation({ sellerId, lead, note }) {
    const config = getSellerChatwootConfig(sellerId);

    if (!config) {
        return {
            ok: true,
            skipped: 'previous_seller_chatwoot_not_configured',
            configured: false,
        };
    }

    const client = clientFor(config);
    const contact = await ensureContact(client, lead, false);

    if (!contact?.id) {
        return {
            ok: true,
            skipped: 'previous_seller_contact_not_found',
            configured: true,
        };
    }

    const conversation = await findConversation(client, contact.id, config.inboxId);

    if (!conversation?.id) {
        return {
            ok: true,
            skipped: 'previous_seller_conversation_not_found',
            configured: true,
        };
    }

    const reopenedConversation = await reopenConversation(client, conversation);
    await sendPrivateNote(client, reopenedConversation.id, note);

    return {
        ok: true,
        configured: true,
        contactId: contact.id,
        conversationId: reopenedConversation.id,
        reopened: conversation.status !== 'open',
    };
}

export default {
    getSellerChatwootConfig,
    syncSellerConversation,
    notifyPreviousSellerConversation,
};

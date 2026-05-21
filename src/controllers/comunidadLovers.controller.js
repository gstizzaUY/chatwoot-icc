import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const CHATWOOT_URL = process.env.CHATWOOT_URL || 'https://contact-center.5vsa59.easypanel.host';
const API_ACCESS_TOKEN = process.env.API_ACCESS_TOKEN;
const ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || '2';

const chatwoot = axios.create({
    baseURL: `${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}`,
    headers: {
        'Content-Type': 'application/json',
        'api_access_token': API_ACCESS_TOKEN
    },
    timeout: 30000
});

// Inbox: "Experiencias iChef Wpp" (id=38)
const INBOX_ID = 38;
// Agente Neiff Cardozo (id=19), Team id=4
const ASSIGNEE_ID = 19;
const TEAM_ID = 4;

// ── Helpers ──────────────────────────────────────────────────────────────────

const buildPayloadItem = (key, value) => {
    if (!value) return null;
    return {
        attribute_key: key,
        filter_operator: 'equal_to',
        values: [value],
        query_operator: 'OR'
    };
};

/**
 * Busca un contacto en Chatwoot por id RD, email o teléfono.
 * Retorna el contacto o null.
 */
const findContact = async (lead) => {
    const items = [
        { key: 'id',           value: lead.id     || null },
        { key: 'email',        value: lead.email  || null },
        { key: 'phone_number', value: lead.personal_phone || lead.mobile_phone || lead.phone || null }
    ]
        .map(item => buildPayloadItem(item.key, item.value))
        .filter(Boolean)
        .map((item, idx, arr) => ({
            ...item,
            query_operator: idx === arr.length - 1 ? null : 'OR'
        }));

    if (items.length === 0) return null;

    const resp = await chatwoot.post('/contacts/filter', { payload: items });
    if (resp.data.meta.count > 0) return resp.data.payload[0];
    return null;
};

/**
 * Crea un contacto nuevo en Chatwoot.
 * Si no tiene email, genera uno ficticio a partir del teléfono.
 */
const createContact = async (lead) => {
    const phone = lead.personal_phone || lead.mobile_phone || lead.phone || null;
    const email = (lead.email && lead.email.includes('@'))
        ? lead.email
        : phone ? `${phone.replace(/\D/g, '')}@email.com` : null;

    const payload = { name: lead.name || 'Sin nombre' };
    if (email)  payload.email        = email;
    if (phone)  payload.phone_number = phone;

    const customAttrs = {};
    if (lead.id)      customAttrs.id      = lead.id;
    if (lead.city)    customAttrs.city    = lead.city;
    if (lead.country) customAttrs.country = lead.country;
    if (Object.keys(customAttrs).length > 0) payload.custom_attributes = customAttrs;

    const resp = await chatwoot.post('/contacts', payload);
    return resp.data.payload || resp.data;
};

/**
 * Crea una conversación en el inbox indicado con el agente asignado.
 */
const createConversation = async (contactId) => {
    const payload = {
        inbox_id:    INBOX_ID,
        contact_id:  contactId,
        status:      'open',
        assignee_id: ASSIGNEE_ID,
        team_id:     TEAM_ID
    };

    const resp = await chatwoot.post('/conversations', payload);
    return resp.data;
};

/**
 * Crea una nota interna (mensaje privado) en la conversación.
 */
const createInternalNote = async (conversationId, content) => {
    const resp = await chatwoot.post(`/conversations/${conversationId}/messages`, {
        content,
        message_type: 'outgoing',
        private:      true
    });
    return resp.data;
};

/**
 * Formatea los datos del lead en texto legible para la nota interna.
 */
const formatLeadData = (lead) => {
    const fields = [
        ['Nombre',        lead.name],
        ['Email',         lead.email],
        ['Teléfono',      lead.personal_phone || lead.mobile_phone || lead.phone],
        ['Ciudad',        lead.city],
        ['País',          lead.country],
        ['Empresa',       lead.company],
        ['Etapa',         lead.lead_stage],
        ['ID RD Station', lead.id],
        ['UUID',          lead.uuid],
    ].filter(([, v]) => v);

    return fields.map(([k, v]) => `• *${k}:* ${v}`).join('\n');
};

// ── Handler principal ─────────────────────────────────────────────────────────

/**
 * POST /api/v2/comunidad-lovers/solicitud-acceso
 *
 * Body esperado (viene de automatización RD Station):
 * { "leads": [ { "id", "uuid", "email", "mobile_phone", "name", ... }, ... ] }
 */
const solicitudAccesoComunidad = async (req, res) => {
    const leads = req.body?.leads;

    if (!Array.isArray(leads) || leads.length === 0) {
        return res.status(400).json({
            success: false,
            error: 'Body inválido: se esperaba { leads: [...] }'
        });
    }

    // Responder inmediatamente (202) para evitar reintentos de RD Station
    res.status(202).json({
        success: true,
        message: 'Procesando en background',
        received: leads.length
    });

    setImmediate(async () => {
        const results = { received: leads.length, created: 0, errors: 0, details: [] };

        for (const lead of leads) {
            try {
                console.log(`[comunidad-lovers] Procesando lead: ${lead.name} (${lead.email})`);

                // 1. Buscar o crear contacto en Chatwoot
                let contact = await findContact(lead);
                let wasCreated = false;

                if (!contact) {
                    contact = await createContact(lead);
                    wasCreated = true;
                    console.log(`[comunidad-lovers] Contacto creado: ID ${contact.id}`);
                } else {
                    console.log(`[comunidad-lovers] Contacto encontrado: ID ${contact.id}`);
                }

                // 2. Crear conversación en "Experiencias iChef Wpp" (id=38)
                const conversation = await createConversation(contact.id);
                console.log(`[comunidad-lovers] Conversación creada: ID ${conversation.id}`);

                // 3. Crear nota interna con los datos del lead
                const noteContent =
                    `*Solicitud de Acceso a la comunidad iChef Lovers desde el Portal de Recetas*\n\n` +
                    `Se ha solicitado desde el portal el acceso a iChef Lovers para:\n\n` +
                    formatLeadData(lead);

                await createInternalNote(conversation.id, noteContent);
                console.log(`[comunidad-lovers] ✓ Nota interna creada en conversación ${conversation.id}`);

                results.created += 1;
                results.details.push({
                    leadId:         lead.id,
                    email:          lead.email,
                    contactId:      contact.id,
                    contactCreated: wasCreated,
                    conversationId: conversation.id,
                    status:         'ok'
                });

            } catch (err) {
                results.errors += 1;
                console.error(`[comunidad-lovers] ✗ Error procesando lead ${lead.id}:`, err.message);
                if (err.response?.data) {
                    console.error('[comunidad-lovers] Detalles:', JSON.stringify(err.response.data));
                }
                results.details.push({
                    leadId: lead.id,
                    email:  lead.email,
                    status: 'error',
                    error:  err.message
                });
            }
        }

        console.log('[comunidad-lovers] Resumen final:', {
            received: results.received,
            created:  results.created,
            errors:   results.errors
        });
    });
};

export default solicitudAccesoComunidad;

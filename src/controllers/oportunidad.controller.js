import axios from 'axios';
import dotenv from 'dotenv';
import { normalizePhone } from '../utils/phone.utils.js';

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

// ── Inbox: "iChef Center Wpp" (id=34) ────────────────────────────────────────
const INBOX_ID    = 34;
// Agente Melany Fulco (id=14), Team "ventas" (id=2)
const ASSIGNEE_ID = 14;
const TEAM_ID     = 2;
const TAG         = 'oportunidad';
const NOTE_TEXT   = 'Oportunidad Abierta en rd-station a partir de lead scoring';

// ── Helpers ──────────────────────────────────────────────────────────────────

const COUNTRY_NAME_TO_ISO = {
    'uruguay':    'UY', 'argentina':  'AR', 'brasil':    'BR',
    'brazil':     'BR', 'chile':      'CL', 'colombia':  'CO',
    'peru':       'PE', 'perú':       'PE', 'ecuador':   'EC',
    'bolivia':    'BO', 'paraguay':   'PY', 'venezuela': 'VE'
};

const getCountryCode = (lead) => {
    const raw = (lead.country || '').toLowerCase().trim();
    return COUNTRY_NAME_TO_ISO[raw] || 'UY';
};

/**
 * Busca un contacto en Chatwoot: primero por email, luego por teléfono normalizado.
 */
const findContact = async (lead) => {
    const rawPhone   = lead.personal_phone || lead.mobile_phone || lead.phone || null;
    const email      = (lead.email && lead.email.includes('@')) ? lead.email : null;
    const countryIso = getCountryCode(lead);
    const phone      = rawPhone ? normalizePhone(rawPhone, countryIso) : null;

    if (email) {
        try {
            const resp = await chatwoot.post('/contacts/filter', {
                payload: [{ attribute_key: 'email', filter_operator: 'equal_to', values: [email], query_operator: null }]
            });
            if (resp.data.meta.count > 0) {
                console.log(`[oportunidad] Contacto encontrado por email: ${email} (ID ${resp.data.payload[0].id})`);
                return resp.data.payload[0];
            }
        } catch (err) {
            console.warn(`[oportunidad] Error buscando por email "${email}": ${err.message}`);
            if (err.response?.status) console.warn(`  HTTP ${err.response.status}`);
            if (err.response?.data)   console.warn('  Detalle:', JSON.stringify(err.response.data));
        }
    }

    if (phone) {
        try {
            const resp = await chatwoot.post('/contacts/filter', {
                payload: [{ attribute_key: 'phone_number', filter_operator: 'equal_to', values: [phone], query_operator: null }]
            });
            if (resp.data.meta.count > 0) {
                console.log(`[oportunidad] Contacto encontrado por teléfono: ${phone} (ID ${resp.data.payload[0].id})`);
                return resp.data.payload[0];
            }
        } catch (err) {
            console.warn(`[oportunidad] Error buscando por teléfono "${phone}": ${err.message}`);
            if (err.response?.status) console.warn(`  HTTP ${err.response.status}`);
            if (err.response?.data)   console.warn('  Detalle:', JSON.stringify(err.response.data));
        }
    }

    if (!email && !phone) {
        console.log(`[oportunidad] Sin email ni teléfono para buscar: ${lead.name}`);
    }
    return null;
};

/**
 * Crea un contacto nuevo en Chatwoot.
 * Si no tiene email, genera uno ficticio a partir del teléfono.
 */
const createContact = async (lead) => {
    const rawPhone   = lead.personal_phone || lead.mobile_phone || lead.phone || null;
    const countryIso = getCountryCode(lead);
    const phone      = rawPhone ? normalizePhone(rawPhone, countryIso) : null;
    const email = (lead.email && lead.email.includes('@'))
        ? lead.email
        : phone ? `${phone.replace(/\D/g, '')}@email.com` : null;

    if (!email && !phone) {
        throw new Error(`Lead sin email ni teléfono: no se puede crear en Chatwoot (nombre: ${lead.name})`);
    }

    const payload = { name: lead.name || 'Sin nombre' };
    if (email)  payload.email        = email;
    if (phone)  payload.phone_number = phone;

    const customAttrs = {};
    if (lead.id)      customAttrs.id      = lead.id;
    if (lead.city)    customAttrs.city    = lead.city;
    if (lead.country) customAttrs.country = lead.country;
    if (Object.keys(customAttrs).length > 0) payload.custom_attributes = customAttrs;

    console.log(`[oportunidad] Creando contacto: ${payload.name} | email=${payload.email} | phone=${payload.phone_number}`);
    try {
        const resp = await chatwoot.post('/contacts', payload);
        const contact = resp.data?.payload?.contact || resp.data?.payload || resp.data;
        if (!contact?.id) throw new Error(`Chatwoot no retornó un contacto válido: ${JSON.stringify(resp.data)}`);
        return { ...contact, _wasCreated: true };
    } catch (err) {
        if (err.response?.status === 422 &&
            err.response?.data?.message?.includes('Phone number has already been taken') &&
            phone) {
            const digits = phone.replace(/\D/g, '');
            console.log(`[oportunidad] Teléfono ${phone} ya registrado, buscando contacto existente...`);
            const search = await chatwoot.get('/contacts/search', {
                params: { q: digits, include_contacts: true, page: 1 }
            });
            const matches = search.data?.payload;
            if (matches?.length > 0) {
                const match = matches.find(c => (c.phone_number || '').replace(/\D/g, '') === digits) || matches[0];
                console.log(`[oportunidad] Contacto encontrado por teléfono duplicado: ID ${match.id}`);
                return match;
            }
        }
        throw err;
    }
};

/**
 * Busca si ya existe una conversación abierta en el inbox configurado para este contacto.
 * Retorna la conversación existente o null.
 */
const findOpenConversation = async (contactId) => {
    try {
        const resp = await chatwoot.get(`/contacts/${contactId}/conversations`);
        const conversations = resp.data?.payload || resp.data || [];
        const existing = conversations.find(c => c.inbox_id === INBOX_ID && c.status === 'open');
        return existing || null;
    } catch (err) {
        console.warn(`[oportunidad] Error buscando conversaciones del contacto ${contactId}: ${err.message}`);
        return null;
    }
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

    console.log(`[oportunidad] Creando conversación para contactId=${contactId}`);
    const resp = await chatwoot.post('/conversations', payload);
    return resp.data;
};

/**
 * Agrega la etiqueta "oportunidad" a la conversación si no la tiene ya.
 */
const ensureLabel = async (conversationId) => {
    try {
        const convResp = await chatwoot.get(`/conversations/${conversationId}`);
        const conv = convResp.data;
        const currentLabels = conv?.labels || [];
        if (currentLabels.includes(TAG)) {
            console.log(`[oportunidad] Etiqueta "${TAG}" ya existe en conversación ${conversationId}`);
            return;
        }
        const newLabels = [...currentLabels, TAG];
        await chatwoot.post(`/conversations/${conversationId}/labels`, { labels: newLabels });
        console.log(`[oportunidad] Etiqueta "${TAG}" agregada a conversación ${conversationId}`);
    } catch (err) {
        console.warn(`[oportunidad] Error agregando etiqueta a conversación ${conversationId}: ${err.message}`);
    }
};

/**
 * Crea una nota interna (mensaje privado) en la conversación.
 */
const createInternalNote = async (conversationId) => {
    const resp = await chatwoot.post(`/conversations/${conversationId}/messages`, {
        content:      NOTE_TEXT,
        message_type: 'outgoing',
        private:      true
    });

    await chatwoot.post(`/conversations/${conversationId}/unread`);

    return resp.data;
};

// ── Handler principal ─────────────────────────────────────────────────────────

/**
 * POST /api/v2/oportunidad/abierta
 *
 * Recibe leads desde una automatización de RD Station cuando se crea una oportunidad.
 * Para cada lead:
 *   1. Busca o crea el contacto en Chatwoot.
 *   2. Abre una conversación en el canal "iChef Center Wpp" (id=34),
 *      estado abierta, asignada a Melany Fulco (id=14), team "ventas" (id=2).
 *   3. Agrega la etiqueta "oportunidad".
 *   4. Crea una nota interna: "Oportunidad Abierta en rd-station a partir de lead scoring"
 *
 * Si ya existe una conversación abierta en ese inbox para el contacto,
 * reutiliza la existente y solo agrega la nota interna.
 *
 * Body esperado (viene de automatización RD Station):
 * { "leads": [ { "id", "uuid", "email", "mobile_phone", "name", ... }, ... ] }
 */
const oportunidadAbierta = async (req, res) => {
    const leads = req.body?.leads;

    if (!Array.isArray(leads) || leads.length === 0) {
        console.error('[oportunidad] Body inválido. Body recibido:', JSON.stringify(req.body));
        return res.status(400).json({
            success: false,
            error: 'Body inválido: se esperaba { leads: [...] }'
        });
    }

    console.log(`[oportunidad] Recibidos ${leads.length} leads`);

    res.status(202).json({
        success: true,
        message: 'Procesando en background',
        received: leads.length
    });

    setImmediate(async () => {
        console.log('[oportunidad] Iniciando procesamiento en background...');
        const results = { received: leads.length, created: 0, errors: 0, details: [] };
        try {

        for (const lead of leads) {
            try {
                console.log(`[oportunidad] --- Procesando: ${lead.name} | email: ${lead.email} | tel: ${lead.personal_phone || lead.mobile_phone || lead.phone || 'N/A'}`);

                // 1. Buscar o crear contacto en Chatwoot
                let contact = await findContact(lead);
                let wasCreated = false;

                if (!contact) {
                    contact = await createContact(lead);
                    if (contact._wasCreated) {
                        wasCreated = true;
                        console.log(`[oportunidad] Contacto nuevo creado: ID ${contact.id}`);
                    } else {
                        console.log(`[oportunidad] Contacto encontrado (tel duplicado): ID ${contact.id}`);
                    }
                } else {
                    console.log(`[oportunidad] Contacto encontrado: ID ${contact.id}`);
                }

                // 2. Verificar si ya existe conversación abierta en el inbox
                let conversation = await findOpenConversation(contact.id);
                let conversationWasReused = false;

                if (conversation) {
                    conversationWasReused = true;
                    console.log(`[oportunidad] Conversación existente reutilizada: ID ${conversation.id}`);
                } else {
                    // 3. Crear conversación en "iChef Center Wpp" (id=34)
                    conversation = await createConversation(contact.id);
                    if (!conversation?.id) throw new Error(`Chatwoot no retornó conversación válida: ${JSON.stringify(conversation)}`);
                    console.log(`[oportunidad] Conversación creada: ID ${conversation.id}`);

                    // 4. Agregar etiqueta "oportunidad"
                    await ensureLabel(conversation.id);
                }

                // 5. Crear nota interna
                await createInternalNote(conversation.id);
                console.log(`[oportunidad] ✓ Nota interna creada en conversación ${conversation.id}`);

                results.created += 1;
                results.details.push({
                    leadId:                lead.id,
                    email:                 lead.email,
                    contactId:             contact.id,
                    contactCreated:        wasCreated,
                    conversationId:        conversation.id,
                    conversationReused:    conversationWasReused,
                    status:                'ok'
                });

            } catch (err) {
                results.errors += 1;
                console.error(
                    `[oportunidad] ✗ ERROR lead "${lead.name}" (${lead.email || lead.personal_phone || lead.mobile_phone || 'sin contacto'}):`,
                    err.message
                );
                if (err.response?.status)  console.error(`  HTTP ${err.response.status}`);
                if (err.response?.data)    console.error(`  Detalle:`, JSON.stringify(err.response.data));
                results.details.push({
                    leadId: lead.id,
                    name:   lead.name,
                    email:  lead.email,
                    status: 'error',
                    error:  err.message,
                    httpStatus: err.response?.status
                });
            }

            await new Promise(resolve => setTimeout(resolve, 300));
        }

        console.log('[oportunidad] Resumen final:', {
                received: results.received,
                created:  results.created,
                errors:   results.errors,
                errorDetails: results.details.filter(d => d.status === 'error')
            });
        } catch (fatalErr) {
            console.error('[oportunidad] ERROR FATAL en background:', fatalErr.message, fatalErr.stack);
        }
    });
};

export default oportunidadAbierta;

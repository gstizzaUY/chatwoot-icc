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

// ── Cliente RD Station con auto-refresh de token ──────────────────────────────
const rdstation = axios.create({
    baseURL: process.env.RDSTATION_URL || 'https://api.rd.services',
    headers: { 'Content-Type': 'application/json' }
});

const setRdToken = (token) => {
    rdstation.defaults.headers['Authorization'] = `Bearer ${token}`;
};

const refreshRdToken = async () => {
    const resp = await axios.post(
        `${process.env.RDSTATION_URL || 'https://api.rd.services'}/auth/token`,
        {
            client_id:     process.env.RDSTATION_CLIENT_ID,
            client_secret: process.env.RDSTATION_CLIENT_SECRET,
            refresh_token: process.env.RDSTATION_REFRESH_TOKEN
        },
        { headers: { 'Content-Type': 'application/json' } }
    );
    return resp.data.access_token;
};

// ──────────────────────────────────────────────────────────────────
// Inbox: "Experiencias iChef Wpp" (id=38)
const INBOX_ID = 38;
// Agente Neiff Cardozo (id=19), Team id=4
const ASSIGNEE_ID = 19;
const TEAM_ID = 4;

// ── Helpers ──────────────────────────────────────────────────────────────────

// Mapeo de nombres de país (RD Station) a código ISO para normalizePhone
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
 * Retorna el contacto o null.
 */
const findContact = async (lead) => {
    const rawPhone  = lead.personal_phone || lead.mobile_phone || lead.phone || null;
    const email     = (lead.email && lead.email.includes('@')) ? lead.email : null;
    const countryIso = getCountryCode(lead);
    const phone     = rawPhone ? normalizePhone(rawPhone, countryIso) : null;

    // 1. Buscar por email
    if (email) {
        try {
            const resp = await chatwoot.post('/contacts/filter', {
                payload: [{ attribute_key: 'email', filter_operator: 'equal_to', values: [email], query_operator: null }]
            });
            if (resp.data.meta.count > 0) {
                console.log(`[comunidad-lovers] Contacto encontrado por email: ${email} (ID ${resp.data.payload[0].id})`);
                return resp.data.payload[0];
            }
        } catch (err) {
            console.warn(`[comunidad-lovers] Error buscando por email "${email}": ${err.message}`);
            if (err.response?.status) console.warn(`  HTTP ${err.response.status}`);
            if (err.response?.data)   console.warn('  Detalle:', JSON.stringify(err.response.data));
        }
    }

    // 2. Buscar por teléfono normalizado (E.164)
    if (phone) {
        try {
            const resp = await chatwoot.post('/contacts/filter', {
                payload: [{ attribute_key: 'phone_number', filter_operator: 'equal_to', values: [phone], query_operator: null }]
            });
            if (resp.data.meta.count > 0) {
                console.log(`[comunidad-lovers] Contacto encontrado por teléfono: ${phone} (ID ${resp.data.payload[0].id})`);
                return resp.data.payload[0];
            }
        } catch (err) {
            console.warn(`[comunidad-lovers] Error buscando por teléfono "${phone}": ${err.message}`);
            if (err.response?.status) console.warn(`  HTTP ${err.response.status}`);
            if (err.response?.data)   console.warn('  Detalle:', JSON.stringify(err.response.data));
        }
    }

    if (!email && !phone) {
        console.log(`[comunidad-lovers] Sin email ni teléfono para buscar: ${lead.name}`);
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

    console.log(`[comunidad-lovers] Creando contacto: ${payload.name} | email=${payload.email} | phone=${payload.phone_number}`);
    try {
        const resp = await chatwoot.post('/contacts', payload);
        const contact = resp.data?.payload?.contact || resp.data?.payload || resp.data;
        if (!contact?.id) throw new Error(`Chatwoot no retornó un contacto válido: ${JSON.stringify(resp.data)}`);
        return { ...contact, _wasCreated: true };
    } catch (err) {
        // Fallback: si el teléfono ya existe en otro contacto, buscarlo por dígitos
        if (err.response?.status === 422 &&
            err.response?.data?.message?.includes('Phone number has already been taken') &&
            phone) {
            const digits = phone.replace(/\D/g, '');
            console.log(`[comunidad-lovers] Teléfono ${phone} ya registrado, buscando contacto existente...`);
            const search = await chatwoot.get('/contacts/search', {
                params: { q: digits, include_contacts: true, page: 1 }
            });
            const matches = search.data?.payload;
            if (matches?.length > 0) {
                const match = matches.find(c => (c.phone_number || '').replace(/\D/g, '') === digits) || matches[0];
                console.log(`[comunidad-lovers] Contacto encontrado por teléfono duplicado: ID ${match.id}`);
                return match;
            }
        }
        throw err;
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

    console.log(`[comunidad-lovers] Creando conversación para contactId=${contactId}`);
    const resp = await chatwoot.post('/conversations', payload);
    return resp.data;
};

/**
 * Crea una nota interna (mensaje privado) en la conversación.
 * No marca la conversación como leída para no confundir a operadores humanos.
 */
const createInternalNote = async (conversationId, content) => {
    const resp = await chatwoot.post(`/conversations/${conversationId}/messages`, {
        content: `[Agente IA] ${content}`,
        message_type: 'outgoing',
        private:      true
    });

    // Restaurar estado "no leído"
    await chatwoot.post(`/conversations/${conversationId}/unread`);

    return resp.data;
};

/**
 * Formatea los datos del lead en texto legible para la nota interna.
 */
const formatLeadData = (lead) => {
    // id_equipo viene dentro de custom_fields en el payload de RD Station
    const robotId = lead.custom_fields?.id_equipo || lead.cf_id_equipo || null;

    const fields = [
        ['Nombre',        lead.name],
        ['Email',         lead.email],
        ['Teléfono',      lead.personal_phone || lead.mobile_phone || lead.phone],
        ['País',          lead.country],
        ['Empresa',       lead.company],
        ['ID del robot',  robotId],
        ['Etapa',         lead.lead_stage],
    ].filter(([, v]) => v);

    return fields.map(([k, v]) => `• *${k}:* ${v}`).join('\n');
};

/**
 * Actualiza tiene_ichef a "Sí" en el contacto de Chatwoot.
 */
const updateTieneIchefChatwoot = async (contactId) => {
    await chatwoot.patch(`/contacts/${contactId}`, {
        custom_attributes: { tiene_ichef: 'Sí' }
    });
};

/**
 * Actualiza cf_tiene_ichef a "Sí" en RD Station.
 * Usa auto-refresh de token si recibe 401.
 */
const updateTieneIchefRdStation = async (email) => {
    const doUpdate = async () => {
        await rdstation.patch(
            `/platform/contacts/email:${encodeURIComponent(email)}`,
            { cf_tiene_ichef: 'Sí' }
        );
    };

    try {
        await doUpdate();
    } catch (err) {
        if (err.response?.status === 401) {
            const newToken = await refreshRdToken();
            setRdToken(newToken);
            await doUpdate();
        } else {
            throw err;
        }
    }
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
        console.error('[comunidad-lovers] Body inválido. Body recibido:', JSON.stringify(req.body));
        return res.status(400).json({
            success: false,
            error: 'Body inválido: se esperaba { leads: [...] }'
        });
    }

    console.log(`[comunidad-lovers] Recibidos ${leads.length} leads`);

    // Responder inmediatamente (202) para evitar reintentos de RD Station
    res.status(202).json({
        success: true,
        message: 'Procesando en background',
        received: leads.length
    });

    setImmediate(async () => {
        console.log('[comunidad-lovers] Iniciando procesamiento en background...');
        const results = { received: leads.length, created: 0, errors: 0, details: [] };
        try {

        for (const lead of leads) {
            try {
                console.log(`[comunidad-lovers] --- Procesando: ${lead.name} | email: ${lead.email} | tel: ${lead.personal_phone || lead.mobile_phone || lead.phone || 'N/A'}`);

                // 1. Buscar o crear contacto en Chatwoot
                let contact = await findContact(lead);
                let wasCreated = false;

                if (!contact) {
                    contact = await createContact(lead);
                    if (contact._wasCreated) {
                        wasCreated = true;
                        console.log(`[comunidad-lovers] Contacto nuevo creado: ID ${contact.id}`);
                    } else {
                        console.log(`[comunidad-lovers] Contacto encontrado (tel duplicado): ID ${contact.id}`);
                    }
                } else {
                    console.log(`[comunidad-lovers] Contacto encontrado: ID ${contact.id}`);
                }

                // 2. Crear conversación en "Experiencias iChef Wpp" (id=38)
                const conversation = await createConversation(contact.id);
                if (!conversation?.id) throw new Error(`Chatwoot no retornó conversación válida: ${JSON.stringify(conversation)}`);
                console.log(`[comunidad-lovers] Conversación creada: ID ${conversation.id}`);

                // 3. Crear nota interna con los datos del lead
                const noteContent =
                    `*Solicitud de Acceso a la comunidad iChef Lovers desde el Portal de Recetas*\n\n` +
                    `Se ha solicitado desde el portal el acceso a iChef Lovers para:\n\n` +
                    formatLeadData(lead);

                await createInternalNote(conversation.id, noteContent);
                console.log(`[comunidad-lovers] ✓ Nota interna creada en conversación ${conversation.id}`);

                // 4. Actualizar tiene_ichef si está vacío o en "No"
                const tieneIchef = contact.custom_attributes?.tiene_ichef;
                const needsUpdate = !tieneIchef || tieneIchef === 'No';

                if (needsUpdate) {
                    const email = contact.email ||
                        `${(lead.personal_phone || lead.mobile_phone || lead.phone || '').replace(/\D/g, '')}@email.com`;

                    let chatwootUpdated = false;
                    let rdUpdated = false;
                    const updateErrors = [];

                    try {
                        await updateTieneIchefChatwoot(contact.id);
                        chatwootUpdated = true;
                    } catch (e) {
                        updateErrors.push(`Chatwoot: ${e.message}`);
                        console.error(`[comunidad-lovers] Error actualizando tiene_ichef en Chatwoot:`, e.message);
                    }

                    try {
                        await updateTieneIchefRdStation(email);
                        rdUpdated = true;
                    } catch (e) {
                        updateErrors.push(`RD Station: ${e.message}`);
                        console.error(`[comunidad-lovers] Error actualizando cf_tiene_ichef en RD Station:`, e.message);
                    }

                    const updateNote = chatwootUpdated || rdUpdated
                        ? `✅ *tiene_ichef actualizado a "Sí"*\n` +
                          `• Chatwoot: ${chatwootUpdated ? 'actualizado' : 'error - ' + updateErrors.find(e => e.startsWith('Chatwoot'))}\n` +
                          `• RD Station: ${rdUpdated ? 'actualizado' : 'error - ' + updateErrors.find(e => e.startsWith('RD'))}`
                        : `⚠️ No se pudo actualizar tiene_ichef: ${updateErrors.join(' | ')}`;

                    await createInternalNote(conversation.id, updateNote);
                    console.log(`[comunidad-lovers] tiene_ichef → Chatwoot:${chatwootUpdated} RD:${rdUpdated}`);
                }

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
                console.error(
                    `[comunidad-lovers] ✗ ERROR lead "${lead.name}" (${lead.email || lead.personal_phone || lead.mobile_phone || 'sin contacto'}):`,
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

            // Delay entre leads para no saturar la API de Chatwoot
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        console.log('[comunidad-lovers] Resumen final:', {
                received: results.received,
                created:  results.created,
                errors:   results.errors,
                errorDetails: results.details.filter(d => d.status === 'error')
            });
        } catch (fatalErr) {
            console.error('[comunidad-lovers] ERROR FATAL en background:', fatalErr.message, fatalErr.stack);
        }
    });
};

export default solicitudAccesoComunidad;

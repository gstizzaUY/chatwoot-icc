import dotenv from 'dotenv';
import chatwootClient from '../clients/chatwoot.client.js';
import rdStationClient from '../clients/rdstation.client.js';

dotenv.config();

// ── Canal "Centro de Experiencias" = inbox "Experiencias iChef Wpp" (id=38) ───
const INBOX_ID = 38;
// Agente Neiff Cardozo (id=19), Team id=4
const ASSIGNEE_ID = 19;
const TEAM_ID = 4;

const TITLES = {
    loginPortal:     'El usuario se logueó al portal de recetas',
    robotEncendido:  'El usuario encendió el robot iChef'
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Busca un contacto en Chatwoot por email.
 * Retorna el contacto o null.
 */
const findContactByEmail = async (email) => {
    const contact = await chatwootClient.findContact({ email });
    if (contact) {
        console.log(`[triggers-eventos] Contacto encontrado por email: ${email} (ID ${contact.id})`);
    }
    return contact || null;
};

/**
 * Crea el contacto en Chatwoot con los datos del evento.
 * Incluye custom attributes: tiene_ichef, id_robot, version_del_firmware.
 */
const createContactChatwoot = async (event, email) => {
    const payload = { name: event.clientName || 'Sin nombre' };
    if (email) payload.email = email;
    if (event.cellphone) payload.phone_number = event.cellphone;

    payload.custom_attributes = { tiene_ichef: 'Sí' };
    if (event.robotId) payload.custom_attributes.id_robot = event.robotId;
    if (event.firmwareVersion) payload.custom_attributes.version_del_firmware = event.firmwareVersion;

    console.log(`[triggers-eventos] Creando contacto en Chatwoot: ${payload.name} | email=${email} | phone=${payload.phone_number}`);
    const resp = await chatwootClient.createContact(payload);
    const contact = resp?.payload?.contact || resp?.payload || resp;
    if (!contact?.id) throw new Error(`Chatwoot no retornó un contacto válido: ${JSON.stringify(resp)}`);
    return { ...contact, _wasCreated: true };
};

/**
 * Crea (o actualiza) el contacto en RD Station con los datos del evento.
 */
const upsertContactRdStation = async (event, email) => {
    const contactData = { email, cf_tiene_ichef: 'Sí' };
    if (event.clientName) contactData.name = event.clientName;
    if (event.cellphone) {
        contactData.mobile_phone = event.cellphone;
        contactData.personal_phone = event.cellphone;
    }
    if (event.robotId) contactData.cf_id_equipo = event.robotId;
    if (event.firmwareVersion) contactData.cf_version_firmware = event.firmwareVersion;

    const result = await rdStationClient.upsertContact(contactData);
    console.log(`[triggers-eventos] RD Station ${result.created ? 'creado' : 'actualizado'}: ${email}`);
    return result;
};

/**
 * Completa custom attributes faltantes del contacto en Chatwoot
 * (tiene_ichef, id_robot, version_del_firmware) sin pisar valores existentes.
 */
const fillContactChatwoot = async (contact, event) => {
    const attrs = contact.custom_attributes || {};
    const updateAttrs = {};

    if (!attrs.tiene_ichef || attrs.tiene_ichef === 'No') {
        updateAttrs.tiene_ichef = 'Sí';
    }
    if (event.robotId && attrs.id_robot !== event.robotId) {
        updateAttrs.id_robot = event.robotId;
    }
    if (event.firmwareVersion && attrs.version_del_firmware !== event.firmwareVersion) {
        updateAttrs.version_del_firmware = event.firmwareVersion;
    }

    if (Object.keys(updateAttrs).length > 0) {
        await chatwootClient.updateContact(contact.id, { custom_attributes: updateAttrs });
        console.log(`[triggers-eventos] Contacto ${contact.id} actualizado: ${JSON.stringify(updateAttrs)}`);
    }
};

/**
 * Busca si ya existe una conversación abierta en el inbox configurado
 * para este contacto. Retorna la conversación existente o null.
 */
const findOpenConversation = async (contactId) => {
    const conversations = await chatwootClient.getConversationsByContact(contactId);
    return conversations.find(c => c.inbox_id === INBOX_ID && c.status === 'open') || null;
};

/**
 * Crea una conversación en el inbox del Centro de Experiencias
 * con el agente y equipo asignados.
 */
const createConversation = async (contactId) => {
    const resp = await chatwootClient.createConversation({
        inbox_id: INBOX_ID,
        contact_id: contactId,
        status: 'open',
        assignee_id: ASSIGNEE_ID,
        team_id: TEAM_ID
    });
    const conversation = resp?.payload || resp;
    if (!conversation?.id) throw new Error(`Chatwoot no retornó conversación válida: ${JSON.stringify(resp)}`);
    return conversation;
};

/**
 * Crea una nota interna (mensaje privado) en la conversación.
 * No marca la conversación como leída para no confundir a operadores humanos.
 */
const createInternalNote = async (conversationId, content) => {
    await chatwootClient.sendMessage(conversationId, {
        content,
        message_type: 'outgoing',
        private: true
    });
    await chatwootClient.markAsUnread(conversationId);
};

/**
 * Formatea los datos del evento en texto legible para la nota interna.
 */
const formatEventData = (event) => {
    const bool = (v) => (v === true ? 'Sí' : v === false ? 'No' : null);

    const fields = [
        ['Nombre',            event.clientName],
        ['Email',             event.email],
        ['Celular',           event.cellphone],
        ['Usuario',           event.user],
        ['ID del robot',      event.robotId],
        ['Versión de firmware', event.firmwareVersion],
        ['Estado',            event.status],
        ['Última conexión',   event.lastDate],
        ['Conectado',         bool(event.connected)],
        ['Habilitado',        bool(event.enabled)],
        ['Activado',          bool(event.activated)],
        ['Bloqueado',         bool(event.blocked)],
        ['Betatester',        bool(event.betatester)],
    ].filter(([, v]) => v !== null && v !== undefined && v !== '');

    return fields.map(([k, v]) => `• *${k}:* ${v}`).join('\n');
};

/**
 * Procesa un evento de actividad del portal de recetas / robot iChef.
 */
const procesarEvento = async (event, tipo) => {
    const email = (event.email || '').trim().toLowerCase();

    // 1. Buscar o crear el contacto en Chatwoot
    let contact = await findContactByEmail(email);

    if (!contact) {
        contact = await createContactChatwoot(event, email);
        console.log(`[triggers-eventos] Contacto nuevo creado: ID ${contact.id}`);

        // Crear/actualizar también en RD Station
        await upsertContactRdStation(event, email);
    } else {
        console.log(`[triggers-eventos] Contacto existente: ID ${contact.id}`);
        await fillContactChatwoot(contact, event);
    }

    // 2. Reutilizar conversación abierta en el inbox o crear una nueva
    let conversation = await findOpenConversation(contact.id);
    if (conversation) {
        console.log(`[triggers-eventos] Conversación existente reutilizada: ID ${conversation.id}`);
    } else {
        conversation = await createConversation(contact.id);
        console.log(`[triggers-eventos] Conversación creada: ID ${conversation.id}`);
    }

    // 3. Crear nota interna con el título del evento y los datos
    const noteContent =
        `*${TITLES[tipo]}*\n\n` +
        `Se ha registrado un evento de actividad:\n\n` +
        formatEventData(event);

    await createInternalNote(conversation.id, noteContent);
    console.log(`[triggers-eventos] ✓ Nota interna creada en conversación ${conversation.id} (${tipo})`);
};

// ── Handler principal ─────────────────────────────────────────────────────────

/**
 * POST /api/v2/triggers/eventos/login-portal
 * POST /api/v2/triggers/eventos/robot-encendido
 *
 * Body esperado (evento del portal de recetas):
 * { "clientId", "clientName", "robotId", "email", "cellphone", ... }
 */
const handleEvent = (tipo) => async (req, res) => {
    const event = req.body || {};
    const email = (event.email || '').trim();

    if (!email.includes('@')) {
        console.error(`[triggers-eventos] Body inválido (${tipo}). Recibido:`, JSON.stringify(req.body));
        return res.status(400).json({
            success: false,
            error: 'Body inválido: se requiere un email válido'
        });
    }

    console.log(`[triggers-eventos] Evento ${tipo} recibido para: ${email}`);

    // Responder inmediatamente (202) para evitar reintentos del portal
    res.status(202).json({
        success: true,
        message: 'Procesando en background',
        event: tipo
    });

    setImmediate(async () => {
        try {
            await procesarEvento(event, tipo);
            console.log(`[triggers-eventos] ${tipo} procesado correctamente: ${email}`);
        } catch (err) {
            console.error(`[triggers-eventos] ✗ ERROR procesando ${tipo} (${email}):`, err.message);
            if (err.response?.status) console.error(`  HTTP ${err.response.status}`);
            if (err.response?.data)   console.error('  Detalle:', JSON.stringify(err.response.data));
        }
    });
};

export const loginPortal = handleEvent('loginPortal');
export const robotEncendido = handleEvent('robotEncendido');
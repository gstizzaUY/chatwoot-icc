import chatwootClient from '../clients/chatwoot.client.js';
import { normalizePhone } from '../utils/phone.utils.js';
import { generateEmailFromPhone, isFakeEmail, isValidEmail } from '../utils/email.utils.js';

/**
 * Servicio de conversación de seguimiento para demos agendadas.
 *
 * Se invoca desde `registrarDemo` (controllers/rdStationControllers.js) cuando
 * llega una demo desde el sistema de agendamiento. Además de registrar el
 * contacto y el evento de conversión en RD Station (eso lo hace el
 * controlador), este servicio:
 *   1. Busca (o crea) el contacto en Chatwoot.
 *   2. Abre (o reutiliza/reabre) una conversación en el canal WhatsApp
 *      "iChef Center Wpp" (inbox 34), asignada a Melany Fulco (14) y al
 *      team ventas (2).
 *   3. Agrega la etiqueta "demo" (sin pisar las existentes).
 *   4. Crea una nota privada con los detalles de la demo.
 *   5. Marca la conversación como no leída para que el agente la vea.
 */

// Configuración de la conversación de demo (canal, asignación y etiqueta)
const DEMO_CONVERSATION_CONFIG = {
    inboxId: 34,        // iChef Center Wpp
    assigneeId: 14,     // Melany Fulco
    teamId: 2,          // Team ventas
    label: 'demo'
};

/**
 * Crea el contacto en Chatwoot. Si el teléfono ya está registrado en otro
 * contacto (422 "Phone number has already been taken"), busca el existente
 * por dígitos como fallback.
 *
 * @param {Object} params - { name, email, phone } (phone normalizado E164)
 * @returns {Promise<Object>} - Contacto creado o existente
 */
const createContact = async ({ name, email, phone }) => {
    const payload = { name: name || 'Sin nombre' };
    if (email) payload.email = email;
    if (phone) payload.phone_number = phone;

    try {
        const resp = await chatwootClient.createContact(payload);
        const contact = resp?.payload?.contact || resp?.payload || resp;
        if (!contact?.id) throw new Error(`Chatwoot no retornó un contacto válido: ${JSON.stringify(resp)}`);
        return contact;
    } catch (err) {
        const isDuplicatePhone =
            err.response?.status === 422 &&
            err.response?.data?.message?.includes('Phone number has already been taken') &&
            phone;

        if (!isDuplicatePhone) throw err;

        console.log(`[demo-conversation] Teléfono ${phone} ya registrado, buscando contacto existente...`);
        const digits = phone.replace(/\D/g, '');
        const matches = await chatwootClient.searchContacts(digits);
        const match = matches.find(c => (c.phone_number || '').replace(/\D/g, '') === digits) || matches[0];
        if (match?.id) {
            console.log(`[demo-conversation] Contacto encontrado por teléfono duplicado: ID ${match.id}`);
            return match;
        }
        throw err;
    }
};

/**
 * Actualiza el email del contacto en Chatwoot cuando la demo trae un email
 * real y el contacto tiene email vacío o ficticio (@email.com).
 * Regla de negocio: email real > email ficticio. Nunca sobreescribe un email
 * real distinto (fill-only).
 *
 * @param {Object} contact - Contacto de Chatwoot (se muta `email` si se actualiza)
 * @param {string} email - Email real que trae la demo
 */
const updateContactEmail = async (contact, email) => {
    if (!contact?.id || !email || !isValidEmail(email)) return;

    const currentEmail = (contact.email || '').trim();
    if (currentEmail.toLowerCase() === email.toLowerCase()) return;

    if (currentEmail && !isFakeEmail(currentEmail)) {
        console.log(`[demo-conversation] Contacto ${contact.id} ya tiene email real (${currentEmail}); no se sobreescribe`);
        return;
    }

    try {
        await chatwootClient.updateContact(contact.id, { email });
        contact.email = email;
        console.log(`[demo-conversation] Email del contacto ${contact.id} actualizado: ${currentEmail || '(vacío)'} → ${email}`);
    } catch (err) {
        console.warn(`[demo-conversation] No se pudo actualizar el email del contacto ${contact.id}:`, err.message);
    }
};

/**
 * Resuelve la conversación del canal para la demo (política "reopen"):
 *   1. Reutiliza la conversación abierta más reciente del inbox.
 *   2. Si no hay abierta, reabre la cerrada más reciente del inbox.
 *   3. Si nunca existió una en el canal, crea una nueva.
 *
 * @param {number} contactId - ID del contacto en Chatwoot
 * @returns {Promise<{conversation: Object, conversationAction: string}>}
 */
const resolveConversation = async (contactId) => {
    const conversations = await chatwootClient.getConversationsByContact(contactId);
    const inboxConversations = conversations
        .filter(c => c.inbox_id === DEMO_CONVERSATION_CONFIG.inboxId)
        .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));

    // 1. Reutilizar la conversación abierta más reciente del canal
    const open = inboxConversations.find(c => c.status === 'open');
    if (open) {
        return { conversation: open, conversationAction: 'reused' };
    }

    // 2. Reabrir la conversación más reciente del canal (aunque esté cerrada)
    if (inboxConversations.length > 0) {
        const toReopen = inboxConversations[0];
        await chatwootClient.changeConversationStatus(toReopen.id, 'open');
        return { conversation: { ...toReopen, status: 'open' }, conversationAction: 'reopened' };
    }

    // 3. No existía ninguna conversación en el canal → crear una
    const resp = await chatwootClient.createConversation({
        inbox_id: DEMO_CONVERSATION_CONFIG.inboxId,
        contact_id: contactId,
        status: 'open',
        assignee_id: DEMO_CONVERSATION_CONFIG.assigneeId,
        team_id: DEMO_CONVERSATION_CONFIG.teamId
    });
    const conversation = resp?.payload || resp;
    if (!conversation?.id) throw new Error(`Chatwoot no retornó una conversación válida: ${JSON.stringify(resp)}`);
    return { conversation, conversationAction: 'created' };
};

/**
 * Agrega la etiqueta "demo" a la conversación sin pisar las existentes.
 */
const ensureDemoLabel = async (conversationId) => {
    try {
        const conv = await chatwootClient.getConversation(conversationId);
        const currentLabels = conv?.labels || [];
        if (currentLabels.includes(DEMO_CONVERSATION_CONFIG.label)) return;

        await chatwootClient.setLabels(conversationId, [...currentLabels, DEMO_CONVERSATION_CONFIG.label]);
        console.log(`[demo-conversation] Etiqueta "${DEMO_CONVERSATION_CONFIG.label}" agregada a conversación ${conversationId}`);
    } catch (err) {
        console.warn(`[demo-conversation] No se pudo agregar la etiqueta a conversación ${conversationId}:`, err.message);
    }
};

/**
 * Construye el texto de la nota privada con los detalles de la demo.
 * Los campos vacíos se omiten.
 */
const buildDemoNote = ({ name, email, phone, demo = {} }) => {
    const fields = [
        ['Nombre', name],
        ['Email', email],
        ['Teléfono', phone],
        ['Fecha y hora', demo.fechaHora],
        ['Local', demo.local],
        ['Dirección', demo.direccion],
        ['Origen', demo.sourceUrl]
    ].filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '');

    return [
        '📅 *Demo agendada*',
        '',
        ...fields.map(([label, value]) => `• *${label}:* ${value}`),
        '',
        'Contactar al cliente para confirmar la demo y hacer el seguimiento.'
    ].join('\n');
};

/**
 * Abre (o reutiliza/reabre) la conversación de seguimiento de una demo en el
 * canal WhatsApp, agrega la nota privada con los detalles y marca la
 * conversación como no leída.
 *
 * @param {Object} params
 * @param {string} params.email - Email del contacto (real o ficticio)
 * @param {string} [params.phone] - Teléfono del contacto (cualquier formato)
 * @param {string} params.name - Nombre completo del contacto
 * @param {Object} [params.demo] - Detalles de la demo
 * @param {string} [params.demo.fechaHora] - Fecha y hora (texto ya formateado)
 * @param {string} [params.demo.local] - Local de la demo
 * @param {string} [params.demo.direccion] - Dirección de la demo
 * @param {string} [params.demo.sourceUrl] - URL de origen del agendamiento
 * @returns {Promise<{contactId: number, conversationId: number, conversationAction: 'created'|'reused'|'reopened'}>}
 */
export const openDemoConversation = async ({ email, phone, name, demo = {} }) => {
    const normalizedPhone = phone ? normalizePhone(phone, 'UY') : null;

    // 1. Buscar el contacto en Chatwoot (por email y, como fallback, por teléfono)
    let contact = null;
    if (email) {
        contact = await chatwootClient.findContact({ email });
    }
    if (!contact && normalizedPhone) {
        contact = await chatwootClient.findContact({ phone_number: normalizedPhone });
    }

    // 2. Crear el contacto si no existe
    if (!contact) {
        const contactEmail = email || generateEmailFromPhone(normalizedPhone);
        contact = await createContact({ name, email: contactEmail, phone: normalizedPhone });
        console.log(`[demo-conversation] Contacto creado: ID ${contact.id}`);
    } else {
        console.log(`[demo-conversation] Contacto encontrado: ID ${contact.id}`);
    }

    // 2b. Si el contacto tenía email vacío o ficticio, actualizarlo con el real de la demo
    await updateContactEmail(contact, email);

    // 3. Resolver la conversación del canal (reutilizar abierta / reabrir cerrada / crear)
    const { conversation, conversationAction } = await resolveConversation(contact.id);
    console.log(`[demo-conversation] Conversación ${conversationAction}: ID ${conversation.id}`);

    // 4. Etiqueta "demo"
    await ensureDemoLabel(conversation.id);

    // 5. Nota privada con los detalles de la demo
    await chatwootClient.sendMessage(conversation.id, {
        content: buildDemoNote({ name, email, phone: normalizedPhone || phone, demo }),
        message_type: 'outgoing',
        private: true
    });

    // 6. Marcar como no leída para que el agente la vea
    await chatwootClient.markAsUnread(conversation.id);

    console.log(`[demo-conversation] ✓ Nota privada creada en conversación ${conversation.id}`);

    return { contactId: contact.id, conversationId: conversation.id, conversationAction };
};

export default { openDemoConversation };

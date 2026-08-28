import dotenv from 'dotenv';
import chatwootClient from '../../clients/chatwoot.client.js';
import rdStationClient from '../../clients/rdstation.client.js';

dotenv.config();

// ── Helpers de contacto ───────────────────────────────────────────────────

const findContactByEmail = async (email) => {
    const contact = await chatwootClient.findContact({ email });
    if (contact) {
        console.log(`[triggers-actions] Contacto encontrado por email: ${email} (ID ${contact.id})`);
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

    console.log(`[triggers-actions] Creando contacto en Chatwoot: ${payload.name} | email=${email} | phone=${payload.phone_number}`);
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
    console.log(`[triggers-actions] RD Station ${result.created ? 'creado' : 'actualizado'}: ${email}`);
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
        console.log(`[triggers-actions] Contacto ${contact.id} actualizado: ${JSON.stringify(updateAttrs)}`);
    }
};

// ── Helpers de conversación ───────────────────────────────────────────────

const createConversation = async (contactId, action) => {
    const resp = await chatwootClient.createConversation({
        inbox_id: action.inboxId,
        contact_id: contactId,
        status: 'open',
        assignee_id: action.assigneeId,
        team_id: action.teamId,
    });
    const conversation = resp?.payload || resp;
    if (!conversation?.id) throw new Error(`Chatwoot no retornó conversación válida: ${JSON.stringify(resp)}`);
    return conversation;
};

/**
 * Resuelve la conversación del canal para insertar la nota, según reuseMode:
 *   - 'reopen' (default): reutiliza la abierta; si hay una cerrada en el canal,
 *     la REABRE y la usa; solo crea una nueva si nunca existió una en el canal.
 *   - 'open': reutiliza solo la abierta; si no hay abierta, crea una nueva.
 *   - 'new': siempre crea una conversación nueva.
 */
const resolveConversation = async (contactId, action) => {
    const mode = action.reuseMode || 'reopen';

    if (mode === 'new') {
        const created = await createConversation(contactId, action);
        console.log(`[triggers-actions] Conversación creada: ID ${created.id}`);
        return { conversation: created, reopened: false };
    }

    const conversations = await chatwootClient.getConversationsByContact(contactId);
    const inboxConvs = conversations.filter(c => c.inbox_id === action.inboxId);
    const sorted = [...inboxConvs].sort(
        (a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0)
    );

    // 1. Reutilizar la conversación abierta más reciente del canal
    const open = sorted.find(c => c.status === 'open');
    if (open) {
        console.log(`[triggers-actions] Conversación abierta reutilizada: ID ${open.id}`);
        return { conversation: open, reopened: false };
    }

    // 2. Reabrir la conversación más reciente del canal (aunque esté cerrada)
    if (mode === 'reopen' && sorted.length > 0) {
        await chatwootClient.changeConversationStatus(sorted[0].id, 'open');
        console.log(`[triggers-actions] Conversación cerrada reabierta: ID ${sorted[0].id}`);
        return { conversation: { ...sorted[0], status: 'open' }, reopened: true };
    }

    // 3. No existía ninguna conversación en el canal → crear una
    const created = await createConversation(contactId, action);
    console.log(`[triggers-actions] Conversación creada (no existía en el canal): ID ${created.id}`);
    return { conversation: created, reopened: false };
};

const createInternalNote = async (conversationId, content) => {
    await chatwootClient.sendMessage(conversationId, {
        content,
        message_type: 'outgoing',
        private: true,
    });
    await chatwootClient.markAsUnread(conversationId);
};

// ── Acción: createConversation ────────────────────────────────────────────

/**
 * Devuelve el payload del evento más reciente del grupo (para resolver
 * el contacto). En reglas combinadas, note() recibe todos los eventos.
 */
const latestEventData = (entry) => {
    const keys = Object.keys(entry.events);
    keys.sort((a, b) => entry.events[b].lastSeenAt - entry.events[a].lastSeenAt);
    return entry.events[keys[0]].data;
};

/**
 * Ejecuta una acción definida en la regla.
 * Por ahora solo soporta `createConversation`.
 */
export const executeAction = async (rule, entry) => {
    const action = rule.action;
    if (action.type !== 'createConversation') {
        throw new Error(`Tipo de acción desconocido: ${action.type}`);
    }

    const email = entry.email;
    const latest = latestEventData(entry);

    // 1. Buscar o crear contacto en Chatwoot
    let contact = await findContactByEmail(email);
    let wasCreated = false;

    if (!contact) {
        contact = await createContactChatwoot(latest, email);
        wasCreated = true;
        console.log(`[triggers-actions] Contacto nuevo creado: ID ${contact.id}`);

        // Crear/actualizar también en RD Station
        if (action.syncRD) {
            try {
                await upsertContactRdStation(latest, email);
            } catch (err) {
                console.error(`[triggers-actions] Error sincronizando RD Station (${email}):`, err.message);
            }
        }
    } else {
        console.log(`[triggers-actions] Contacto existente: ID ${contact.id}`);
        await fillContactChatwoot(contact, latest);
    }

    // 2. Resolver la conversación del canal (reutilizar abierta / reabrir cerrada / crear si no existe)
    const { conversation } = await resolveConversation(contact.id, action);

    // 3. Nota interna con el mensaje custom de la regla
    const eventData = {};
    for (const [key, value] of Object.entries(entry.events)) {
        eventData[key] = value.data;
    }
    const content = rule.note(eventData);

    await createInternalNote(conversation.id, content);
    console.log(`[triggers-actions] ✓ Nota interna creada en conversación ${conversation.id} (regla "${rule.id}")`);

    return { contactId: contact.id, conversationId: conversation.id, contactCreated: wasCreated };
};
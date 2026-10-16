import chatwootClient from '../clients/chatwoot.client.js';
import { normalizePhone } from '../utils/phone.utils.js';
import { generateEmailFromPhone, isFakeEmail, isValidEmail } from '../utils/email.utils.js';

/**
 * Servicio: registro del contacto del Portal de Recetas en Chatwoot.
 *
 * Se invoca desde `RegisterContact` (controllers/registerContactController.js)
 * cuando el portal envía un registro nuevo. Solo registra/actualiza el
 * contacto: NO crea conversaciones, notas ni etiquetas.
 *
 * Reglas:
 *   - `tiene_ichef` se fuerza a "Sí" (todo registro del portal es usuario iChef).
 *   - `id_robot` (serial) y `nickname` (username) se completan/actualizan si vienen.
 *   - Email real > email ficticio (@email.com); nunca se pisa un email real distinto.
 *   - Nunca lanza: devuelve un resultado estructurado.
 */

/**
 * Busca el contacto en Chatwoot por email y, como fallback, por teléfono.
 */
const findContact = async (email, normalizedPhone) => {
    if (email) {
        const byEmail = await chatwootClient.findContact({ email });
        if (byEmail) return { contact: byEmail, foundBy: 'email' };
    }
    if (normalizedPhone) {
        const byPhone = await chatwootClient.findContact({ phone_number: normalizedPhone });
        if (byPhone) return { contact: byPhone, foundBy: 'phone' };
    }
    return { contact: null, foundBy: null };
};

/**
 * Crea el contacto con `tiene_ichef = "Sí"` (+ id_robot/nickname si vienen).
 * Si el teléfono ya está registrado en otro contacto (422), lo busca por
 * dígitos como fallback y devuelve el existente.
 */
const createContact = async ({ name, email, phone, serial, username }) => {
    const payload = { name: name || 'Sin nombre' };
    if (email) payload.email = email;
    if (phone) payload.phone_number = phone;

    const customAttributes = { tiene_ichef: 'Sí' };
    if (serial) customAttributes.id_robot = serial;
    if (username) customAttributes.nickname = username;
    payload.custom_attributes = customAttributes;

    try {
        const resp = await chatwootClient.createContact(payload);
        const contact = resp?.payload?.contact || resp?.payload || resp;
        if (!contact?.id) throw new Error(`Chatwoot no retornó un contacto válido: ${JSON.stringify(resp)}`);
        return { contact, created: true };
    } catch (err) {
        const isDuplicatePhone =
            err.response?.status === 422 &&
            err.response?.data?.message?.includes('Phone number has already been taken') &&
            phone;

        if (!isDuplicatePhone) throw err;

        console.log(`[portal-contact] Teléfono ${phone} ya registrado, buscando contacto existente...`);
        const digits = phone.replace(/\D/g, '');
        const matches = await chatwootClient.searchContacts(digits);
        const match = matches.find(c => (c.phone_number || '').replace(/\D/g, '') === digits) || matches[0];
        if (match?.id) {
            console.log(`[portal-contact] Contacto encontrado por teléfono duplicado: ID ${match.id}`);
            return { contact: match, created: false };
        }
        throw err;
    }
};

/**
 * Actualiza el contacto existente con merge de custom_attributes:
 *   - tiene_ichef → "Sí" (siempre)
 *   - id_robot → serial (si viene y es distinto)
 *   - nickname → username (si viene y es distinto)
 *   - email ficticio/vacío → email real (nunca pisa un email real distinto)
 */
const updateContact = async (contact, { email, serial, username }) => {
    const currentAttrs = contact.custom_attributes || {};
    const updated = {};

    const attrsToSet = {};
    if (currentAttrs.tiene_ichef !== 'Sí') {
        attrsToSet.tiene_ichef = 'Sí';
        updated.tieneIchef = true;
    }
    if (serial && currentAttrs.id_robot !== serial) {
        attrsToSet.id_robot = serial;
        updated.idRobot = true;
    }
    if (username && currentAttrs.nickname !== username) {
        attrsToSet.nickname = username;
        updated.nickname = true;
    }

    const payload = {};
    if (Object.keys(attrsToSet).length > 0) {
        payload.custom_attributes = { ...currentAttrs, ...attrsToSet };
    }

    const currentEmail = (contact.email || '').trim();
    if (email && isValidEmail(email) && currentEmail.toLowerCase() !== email.toLowerCase()) {
        if (!currentEmail || isFakeEmail(currentEmail)) {
            payload.email = email;
            updated.email = true;
        } else {
            console.log(`[portal-contact] Contacto ${contact.id} ya tiene email real (${currentEmail}); no se sobreescribe`);
        }
    }

    if (Object.keys(payload).length > 0) {
        await chatwootClient.updateContact(contact.id, payload);
        console.log(`[portal-contact] Contacto ${contact.id} actualizado: ${JSON.stringify(updated)}`);
    }

    return updated;
};

/**
 * Asegura que el contacto del registro del portal exista en Chatwoot con
 * `tiene_ichef = "Sí"` (y `id_robot`/`nickname` cuando vienen).
 *
 * @param {Object} params
 * @param {string} params.name - Nombre completo
 * @param {string} [params.email] - Email del registro (real o vacío)
 * @param {string} [params.phone] - Teléfono (cualquier formato)
 * @param {string} [params.username] - Usuario del portal (→ nickname)
 * @param {string} [params.serial] - Serial del robot (→ id_robot)
 * @returns {Promise<{ok: boolean, contactId: number|null, created: boolean, updated: Object, foundBy: string|null, reason?: string, error?: string}>}
 */
export const ensurePortalChatwootContact = async ({ name, email, phone, username, serial }) => {
    try {
        const normalizedPhone = phone ? normalizePhone(phone, 'UY') : null;

        // 1. Buscar el contacto (email → teléfono)
        const { contact: existing, foundBy } = await findContact(email, normalizedPhone);

        let contact = existing;
        let created = false;

        // 2. Crear si no existe (con fallback ante teléfono duplicado)
        if (!contact) {
            const contactEmail = email || generateEmailFromPhone(normalizedPhone);
            const result = await createContact({ name, email: contactEmail, phone: normalizedPhone, serial, username });
            contact = result.contact;
            created = result.created;
            console.log(`[portal-contact] Contacto ${created ? 'creado' : 'encontrado (tel. duplicado)'}: ID ${contact.id}`);
        } else {
            console.log(`[portal-contact] Contacto encontrado (${foundBy}): ID ${contact.id}`);
        }

        // 3. Actualizar si ya existía (tiene_ichef siempre; id_robot/nickname/email si aplica)
        const updated = created ? {} : await updateContact(contact, { email, serial, username });

        return { ok: true, contactId: contact.id, created, updated, foundBy: created ? null : foundBy };
    } catch (err) {
        console.error(`[portal-contact] ✗ Error registrando contacto en Chatwoot (${email || phone || 'sin datos'}):`, err.message);
        if (err.response?.status) console.error(`  HTTP ${err.response.status}`);
        return { ok: false, contactId: null, created: false, updated: {}, foundBy: null, reason: 'error', error: err.message };
    }
};

export default { ensurePortalChatwootContact };

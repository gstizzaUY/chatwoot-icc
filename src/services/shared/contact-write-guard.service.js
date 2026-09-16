import chatwootClient from '../../clients/chatwoot.client.js';
import fieldProtectionService, { FILL_ONLY_EXEMPT_FIELDS } from './field-protection.service.js';
import { normalizePhone, isValidPhone, detectCountry } from '../../utils/phone.utils.js';
import { isValidEmail, isFakeEmail } from '../../utils/email.utils.js';

const CHATWOOT_URL = process.env.CHATWOOT_URL || 'https://contact-center.5vsa59.easypanel.host';
const ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || '2';

/**
 * Campos de identidad que viajan en la raíz del contacto (no en custom_attributes).
 * Se usan para armar la nota de conflicto/duplicado con etiquetas legibles.
 */
const ROOT_FIELDS = ['name', 'email', 'phone_number', 'identifier'];

/**
 * Servicio guard para escrituras de contacto: normaliza teléfonos, aplica la
 * regla fill-only y detecta contactos duplicados en Chatwoot. Devuelve la
 * información a escribir más los conflictos/duplicados para notificar a un humano.
 */
class ContactWriteGuardService {
    /**
     * Normaliza la información extraída: teléfonos a E164 y emails.
     * @param {Object} extractedInfo
     * @returns {Object} Copia normalizada
     */
    normalizeExtractedInfo(extractedInfo = {}) {
        const normalized = { ...extractedInfo };

        for (const field of ['mobile_phone', 'phone']) {
            if (normalized[field]) {
                const value = normalized[field];
                normalized[field] = normalizePhone(value, detectCountry(value) || 'UY');
            }
        }

        const email = normalized.email;
        if (email && typeof email === 'string') {
            normalized.email = email.trim().toLowerCase();
        }

        return normalized;
    }

    /**
     * Busca contactos en Chatwoot que ya usan el teléfono o email detectados.
     * Excluye el contacto actual.
     *
     * @param {Object} params
     * @param {string|null} params.phone - Teléfono normalizado (E164)
     * @param {string|null} params.email - Email detectado
     * @param {number|null} params.excludeContactId - Contacto actual a excluir
     * @returns {Promise<Array>} - Contactos coincidentes
     */
    async findDuplicates({ phone, email, excludeContactId = null } = {}) {
        const duplicates = [];
        const seen = new Set(excludeContactId ? [Number(excludeContactId)] : []);

        const searches = [];
        if (phone) searches.push({ phone_number: phone });
        if (email && !isFakeEmail(email)) searches.push({ email });

        for (const filters of searches) {
            try {
                const found = await chatwootClient.findContact(filters);
                if (found && found.id && !seen.has(Number(found.id))) {
                    seen.add(Number(found.id));
                    duplicates.push(found);
                }
            } catch (error) {
                console.warn(`⚠️ Guard: error buscando duplicado (${JSON.stringify(filters)}):`, error.message);
            }
        }

        return duplicates;
    }

    /**
     * Resuelve el valor actual de un campo considerando raíz y custom_attributes.
     * Los campos de teléfono/email pueden venir de la raíz del contacto.
     */
    resolveOldValue(field, currentContact = {}) {
        const custom = currentContact.custom_attributes || {};
        const root = currentContact;

        switch (field) {
            case 'mobile_phone':
            case 'phone':
                return root.phone_number || custom.mobile_phone || custom.phone || root[field] || custom[field];
            case 'email':
                return root.email || custom.email;
            case 'firstname':
            case 'lastname':
                return root[field] || custom[field];
            default:
                return root[field] ?? custom[field];
        }
    }

    /**
     * Aplica la regla fill-only a la información detectada contra el contacto actual.
     * Los campos ya poblados con valor distinto quedan como conflicto (no se escriben).
     *
     * @param {Object} extractedInfo - Info normalizada
     * @param {Object} currentContact - Contacto actual de Chatwoot
     * @returns {{ allowed: Object, conflicts: Array<{field: string, old: any, new: any}> }}
     */
    applyFillOnly(extractedInfo, currentContact) {
        const allowed = {};
        const conflicts = [];

        for (const [field, newValue] of Object.entries(extractedInfo)) {
            if (newValue === undefined || newValue === null || newValue === '') continue;

            const oldValue = this.resolveOldValue(field, currentContact);
            const check = fieldProtectionService.checkFillOnly(field, oldValue, newValue);

            if (check.allowed) {
                allowed[field] = newValue;
            } else if (check.conflict) {
                conflicts.push({ field, old: oldValue, new: newValue });
            }
        }

        return { allowed, conflicts };
    }

    /**
     * Indica si un campo se escribe en la raíz del contacto o en custom_attributes.
     */
    isRootField(field) {
        return ROOT_FIELDS.includes(field);
    }

    /**
     * Quita de la información detectada los campos que correspondan a un contacto
     * duplicado (por teléfono o email) para no escribir válidos que ya existen.
     *
     * @param {Object} extractedInfo
     * @param {Array} duplicates
     * @returns {{ allowed: Object, duplicates: Array }}
     */
    removeDuplicatedFields(extractedInfo, duplicates) {
        if (!duplicates || duplicates.length === 0) {
            return { allowed: extractedInfo, duplicates: [], removedFields: [] };
        }

        const dupPhones = new Set(duplicates.map(c => c.phone_number).filter(Boolean));
        const dupEmails = new Set(duplicates.map(c => c.email).filter(Boolean).map(e => String(e).toLowerCase()));

        const allowed = { ...extractedInfo };
        const removedFields = [];

        if (allowed.mobile_phone && dupPhones.has(allowed.mobile_phone)) { delete allowed.mobile_phone; removedFields.push('mobile_phone'); }
        if (allowed.phone && dupPhones.has(allowed.phone)) { delete allowed.phone; removedFields.push('phone'); }
        if (allowed.email && dupEmails.has(String(allowed.email).toLowerCase())) { delete allowed.email; removedFields.push('email'); }

        return { allowed, duplicates, removedFields };
    }

    /**
     * Arma el enlace al contacto en Chatwoot.
     */
    contactLink(contactId) {
        return `${CHATWOOT_URL}/app/accounts/${ACCOUNT_ID}/contacts/${contactId}`;
    }

    /**
     * Construye el texto de la nota privada para conflictos (campo ya poblado).
     */
    buildConflictNote(conversationId, conflicts) {
        if (!conflicts || conflicts.length === 0) return null;

        const lines = conflicts.map(c => {
            const oldVal = c.old === undefined || c.old === null || c.old === '' ? '(vacío)' : c.old;
            return `- ${c.field}: valor actual "${oldVal}" | detectado en la conversación "${c.new}"`;
        });

        return [
            '[Guard de contacto] Datos de la conversación NO escritos (el campo ya tenía valor).',
            'Un humano debe decidir si corresponde actualizarlos:',
            ...lines
        ].join('\n');
    }

    /**
     * Construye el texto de la nota privada para contactos duplicados.
     */
    buildDuplicateNote(duplicates) {
        if (!duplicates || duplicates.length === 0) return null;

        const lines = duplicates.map(d => {
            const fields = [
                `ID: ${d.id}`,
                d.name ? `Nombre: ${d.name}` : null,
                d.email ? `Email: ${d.email}` : null,
                d.phone_number ? `Teléfono: ${d.phone_number}` : null,
                this.contactLink(d.id)
            ].filter(Boolean).join(' | ');
            return `- ${fields}`;
        });

        return [
            '[Guard de contacto] Posible contacto DUPLICADO detectado (mismo teléfono/email).',
            'Un humano debe revisar y fusionar manualmente:',
            ...lines
        ].join('\n');
    }

    /**
     * Envía una nota privada (mensaje interno) en la conversación y la marca no leída.
     * @param {number} conversationId
     * @param {string} content
     */
    async sendPrivateNote(conversationId, content) {
        if (!conversationId || !content) return;
        try {
            await chatwootClient.sendMessage(conversationId, {
                content,
                message_type: 'outgoing',
                private: true
            });
            await chatwootClient.markAsUnread(conversationId);
            console.log(`📝 Guard: nota privada enviada en conversación ${conversationId}`);
        } catch (error) {
            console.warn(`⚠️ Guard: no se pudo enviar la nota privada en conversación ${conversationId}:`, error.message);
        }
    }

    /**
     * Flujo completo del guard: normaliza, detecta duplicados, aplica fill-only,
     * quita campos duplicados y emite las notas privadas correspondientes.
     *
     * @param {Object} params
     * @param {number} params.conversationId
     * @param {Object} params.extractedInfo - Info detectada
     * @param {Object} params.currentContact - Contacto actual de Chatwoot
     * @returns {Promise<{ allowed: Object, conflicts: Array, duplicates: Array }>}
     */
    async run({ conversationId, extractedInfo, currentContact }) {
        const normalized = this.normalizeExtractedInfo(extractedInfo);
        const contactId = currentContact?.id || null;

        const duplicates = await this.findDuplicates({
            phone: normalized.mobile_phone || normalized.phone || null,
            email: normalized.email || null,
            excludeContactId: contactId
        });

        const { allowed: afterDuplicates, removedFields } = this.removeDuplicatedFields(normalized, duplicates);
        const { allowed, conflicts } = this.applyFillOnly(afterDuplicates, currentContact);

        const conflictNote = this.buildConflictNote(conversationId, conflicts);
        if (conflictNote) await this.sendPrivateNote(conversationId, conflictNote);

        const duplicateNote = this.buildDuplicateNote(duplicates);
        if (duplicateNote) await this.sendPrivateNote(conversationId, duplicateNote);

        return { allowed, conflicts, duplicates, removedFields };
    }
}

export default new ContactWriteGuardService();

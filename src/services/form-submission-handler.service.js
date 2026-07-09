import chatwootClient from '../clients/chatwoot.client.js';
import contactExtractionService from './contact-extraction.service.js';
import { EMAIL_CHANNELS, SYSTEM_SENDER_EMAIL } from '../constants/agent.constants.js';
import { normalizePhone } from '../utils/phone.utils.js';

/**
 * Servicio que intercepta mensajes entrantes de canales email para detectar
 * envíos desde formularios web (donde el remitente es el sistema, no la persona real).
 *
 * Caso 1 - Formulario web: el remitente es comercial@ichef.uy
 *   → Extrae datos reales del cuerpo, crea contacto y conversación nueva.
 *
 * Caso 2 - Email normal: el remitente es la persona real
 *   → No interviene, deja pasar al pipeline normal de agentes.
 */
class FormSubmissionHandlerService {

    /**
     * Verifica si el mensaje entrante es un envío de formulario web y lo procesa.
     * @param {Object} payload - Payload del webhook message_created
     * @returns {Promise<{handled: boolean, newConversationId?: number}>}
     */
    async handleIfFormSubmission(payload) {
        const inboxId = payload.conversation?.inbox_id;
        const conversationId = payload.conversation?.id;
        const content = payload.content || '';

        if (!inboxId || !EMAIL_CHANNELS.includes(inboxId)) {
            return { handled: false };
        }

        if (!content || !content.trim()) {
            return { handled: false };
        }

        const contactEmail = await this._getContactEmail(payload);
        if (!contactEmail) {
            return { handled: false };
        }

        if (contactEmail !== SYSTEM_SENDER_EMAIL) {
            console.log(`📧 Email normal detectado (${contactEmail}) - pipeline normal`);
            return { handled: false };
        }

        console.log(`📋 Formulario web detectado en inbox ${inboxId} (conv #${conversationId})`);
        console.log('   Remitente sistema:', SYSTEM_SENDER_EMAIL);

        try {
            const newConversationId = await this._processFormSubmission(payload, inboxId, conversationId, content);
            return { handled: true, newConversationId };
        } catch (error) {
            console.error('❌ Error procesando formulario web:', error.message);
            return { handled: false };
        }
    }

    async _getContactEmail(payload) {
        const contactId = payload.conversation?.contact_id
            || payload.contact?.id
            || payload.sender?.id
            || payload.contact_id;

        if (!contactId) return null;

        try {
            const contact = await chatwootClient.getContactById(contactId);
            return contact?.email?.toLowerCase() || null;
        } catch {
            return null;
        }
    }

    async _processFormSubmission(payload, inboxId, originalConvId, content) {
        const cleanedContent = this._cleanEmailBody(content);
        console.log(`   Contenido limpio: ${cleanedContent.substring(0, 150)}...`);

        const extracted = await contactExtractionService.extract(cleanedContent);
        console.log(`   Extraido: email=${extracted.email} nombre=${extracted.firstname} telefono=${extracted.phone}`);

        if (!extracted.email) {
            console.log('   ⚠️ No se pudo extraer email del formulario - se deja pasar al pipeline normal');
            await this._addFailedExtractionNote(originalConvId);
            return null;
        }

        let contact = await chatwootClient.findContact({ email: extracted.email });

        if (!contact && extracted.phone) {
            const phone = normalizePhone(extracted.phone);
            if (phone) {
                contact = await chatwootClient.findContact({ phone_number: phone });
            }
        }

        const name = [extracted.firstname, extracted.lastname].filter(Boolean).join(' ') || 'Contacto formulario';

        if (!contact) {
            try {
                const phone = normalizePhone(extracted.phone);
                const newContact = await chatwootClient.createContact({
                    name,
                    email: extracted.email,
                    ...(phone && { phone_number: phone }),
                    inbox_id: inboxId
                });
                contact = { id: newContact.payload?.contact?.id || newContact.id, name };
                console.log(`   ✅ Contacto creado: ${name} (ID: ${contact.id})`);
            } catch (error) {
                console.error(`   ❌ Error creando contacto: ${error.message}`);
                await this._addFailedExtractionNote(originalConvId);
                return null;
            }
        } else {
            console.log(`   Contacto ya existe ID: ${contact.id} (${contact.name})`);
        }

        let newConvId = null;
        try {
            const newConv = await chatwootClient.createConversation({
                inbox_id: inboxId,
                contact_id: contact.id,
                status: 'open'
            });
            newConvId = newConv.id || newConv.payload?.conversation?.id;
            console.log(`   ✅ Nueva conversacion: #${newConvId}`);
        } catch (error) {
            console.error(`   ❌ Error creando conversacion: ${error.message}`);
            await this._addFailedExtractionNote(originalConvId);
            return null;
        }

        const note = [
            '🔄 MENSAJE DESDE FORMULARIO WEB',
            '',
            '⚠️ Este mensaje fue enviado desde el formulario de contacto de la pagina web. El remitente del correo era el sistema, no la persona real.',
            '',
            '📋 CONTENIDO DEL FORMULARIO:',
            '───',
            cleanedContent,
            '───',
            '',
            `Datos detectados:`,
            `  Nombre: ${name}`,
            `  Email: ${extracted.email}`,
            `  Telefono: ${extracted.phone || '(no detectado)'}`,
        ].join('\n');

        await chatwootClient.sendMessage(newConvId, {
            content: note,
            message_type: 'outgoing',
            private: true
        });

        console.log(`   📝 Nota interna agregada en conversacion #${newConvId}`);

        await this._resolveOriginalConversation(originalConvId, contact, extracted);

        return newConvId;
    }

    async _resolveOriginalConversation(convId, realContact, extracted) {
        try {
            const note = [
                '📋 FORMULARIO WEB PROCESADO',
                '',
                `Contacto real identificado: ${realContact.name || extracted.firstname} (ID: ${realContact.id})`,
                `Email: ${extracted.email}`,
                `Telefono: ${extracted.phone || 'no detectado'}`,
                '',
                'Se creo una nueva conversacion bajo el contacto correcto para dar seguimiento.',
                'Esta conversacion se resuelve automaticamente.',
            ].join('\n');

            await chatwootClient.sendMessage(convId, {
                content: `[Agente IA] ${note}`,
                message_type: 'outgoing',
                private: true
            });

            await chatwootClient.setLabels(convId, ['formulario-web']);
            await chatwootClient.changeConversationStatus(convId, 'resolved');
            console.log(`   ✅ Conv original #${convId} procesada y resuelta`);
        } catch (error) {
            console.warn(`   ⚠️ Error resolviendo conv original: ${error.message}`);
        }
    }

    async _addFailedExtractionNote(convId) {
        try {
            await chatwootClient.sendMessage(convId, {
                content: '[Agente IA] ⚠️ No se pudo extraer automaticamente el contacto real de este mensaje. Revision manual requerida.',
                message_type: 'outgoing',
                private: true
            });
        } catch { /* ignore */ }
    }

    _cleanEmailBody(content) {
        return content
            .split('\n')
            .filter(line => {
                const trimmed = line.trim().toLowerCase();
                if (!trimmed) return false;
                if (/^(de:|para:|from:|to:|enviado:|sent:|asunto:|subject:|fecha:|date:|cc:)/.test(trimmed)) return false;
                if (trimmed.startsWith('>')) return false;
                if (trimmed.startsWith('--')) return false;
                return true;
            })
            .join('\n')
            .trim();
    }
}

export default new FormSubmissionHandlerService();

import chatwootClient from '../../clients/chatwoot.client.js';
import rdStationClient from '../../clients/rdstation.client.js';
import { mapContactChatwootToRD } from '../../mappers/contact.mapper.js';
import { generateEmailFromPhone, isValidEmail } from '../../utils/email.utils.js';
import { RD_CONVERSIONS } from '../../constants/rdstation.constants.js';
import fieldProtectionService from './field-protection.service.js';

/**
 * Servicio centralizado de sincronización CRM
 * Maneja actualizaciones coordinadas de Chatwoot y RD Station
 */
class CRMSyncService {
    /**
     * Actualiza contacto en Chatwoot con información extraída
     * 
     * @param {number} contactId - ID del contacto
     * @param {Object} currentContact - Contacto actual
     * @param {Object} extractedInfo - Información extraída
     * @param {Object} options - Opciones adicionales
     * @returns {Promise<Object>} - Resultado de actualización
     */
    async updateChatwoot(contactId, currentContact, extractedInfo, options = {}) {
        const { summary = null, agentType = null } = options;

        const updateData = {
            custom_attributes: {
                ...currentContact.custom_attributes
            }
        };

        const changes = [];

        // Helper para actualizar campo con protecciones
        const updateField = (location, field, newValue, displayName = null) => {
            if (newValue === undefined || newValue === null) return;

            const fieldName = displayName || field;
            let oldValue;

            if (location === 'root') {
                oldValue = currentContact[field];
            } else {
                oldValue = currentContact.custom_attributes?.[field];
            }

            // Validar con servicio de protección
            const validation = fieldProtectionService.validateUpdate(field, oldValue, newValue);

            if (!validation.allowed) {
                console.log(`⚠️  [Chatwoot] ${validation.reason}`);
                return;
            }

            // Aplicar actualización
            if (location === 'root') {
                updateData[field] = newValue;
            } else {
                updateData.custom_attributes[field] = newValue;
            }

            changes.push({
                field: fieldName,
                old: oldValue || 'No definido',
                new: newValue
            });
        };

        // Actualizar campos críticos siempre
        updateField('custom', 'tiene_ichef', extractedInfo.tiene_ichef, 'Tiene iChef');
        updateField('custom', 'es_cliente', extractedInfo.es_cliente, 'Es Cliente');
        updateField('custom', 'id_equipo', extractedInfo.id_equipo, 'ID Equipo');
        updateField('custom', 'stage', extractedInfo.stage, 'Etapa');

        // Actualizar campos si confianza es suficiente
        if (extractedInfo.metadata?.confidence !== 'low') {
            // Campos raíz
            updateField('root', 'name', extractedInfo.firstname ?
                `${extractedInfo.firstname}${extractedInfo.lastname ? ' ' + extractedInfo.lastname : ''}` :
                null, 'Nombre completo');
            updateField('root', 'email', extractedInfo.email && isValidEmail(extractedInfo.email) ? extractedInfo.email : null, 'Email');
            updateField('root', 'phone_number', extractedInfo.mobile_phone || extractedInfo.phone, 'Teléfono');

            // Información básica
            updateField('custom', 'email', extractedInfo.email && isValidEmail(extractedInfo.email) ? extractedInfo.email : null, 'Correo Electrónico');
            updateField('custom', 'firstname', extractedInfo.firstname, 'Nombre');
            updateField('custom', 'lastname', extractedInfo.lastname, 'Apellido');
            updateField('custom', 'company', extractedInfo.company, 'Empresa');
            updateField('custom', 'mobile_phone', extractedInfo.mobile_phone, 'Celular');
            updateField('custom', 'city', extractedInfo.city, 'Ciudad');
            updateField('custom', 'state', extractedInfo.state, 'Departamento');
            updateField('custom', 'country', extractedInfo.country, 'País');
        }

        // Lógica crítica: Si es_cliente = Sí → forzar customer
        if (extractedInfo.es_cliente === 'Sí') {
            const currentStage = currentContact.custom_attributes?.stage;

            if (currentStage !== 'customer' && currentStage !== 'cliente') {
                extractedInfo.stage = 'customer';
                updateField('custom', 'stage', 'customer', 'Etapa');
            }

            if (extractedInfo.tiene_ichef !== 'Sí') {
                extractedInfo.tiene_ichef = 'Sí';
                updateField('custom', 'tiene_ichef', 'Sí', 'Tiene iChef');
            }
        }

        // Sincronizar campos de root a custom_attributes
        if (currentContact.email && !updateData.custom_attributes.email) {
            updateData.custom_attributes.email = currentContact.email;
        }

        // Agregar resumen si existe
        if (summary) {
            updateData.custom_attributes.last_conversation_summary = summary;
            updateData.custom_attributes.last_conversation_analyzed_at = new Date().toISOString();
        }

        // Agregar metadata del agente si existe
        if (agentType) {
            updateData.custom_attributes.last_agent_type = agentType;
        }

        try {
            const updatedContact = await chatwootClient.updateContact(contactId, updateData);

            console.log(`✅ Contacto ${contactId} actualizado en Chatwoot (${changes.length} cambios)`);

            return {
                success: true,
                contact: updatedContact,
                changes
            };
        } catch (error) {
            console.error('❌ Error actualizando contacto en Chatwoot:', error.message);
            throw error;
        }
    }

    /**
     * Sincroniza contacto con RD Station
     * 
     * @param {Object} chatwootContact - Contacto de Chatwoot
     * @param {Object} extractedInfo - Información extraída
     * @param {string} originalEmail - Email original (para detectar cambios)
     * @returns {Promise<Object>} - Resultado de sincronización
     */
    async syncRDStation(chatwootContact, extractedInfo, originalEmail = null) {
        try {
            console.log(`🔄 Sincronizando con RD Station - Contacto: ${chatwootContact.name}`);

            const rdData = mapContactChatwootToRD(chatwootContact);
            let generatedEmail = null;

            // Asegurar email válido
            const hasValidEmail = extractedInfo.email && isValidEmail(extractedInfo.email);

            if (!rdData.email || rdData.email === 'null' || !isValidEmail(rdData.email)) {
                if (hasValidEmail) {
                    rdData.email = extractedInfo.email;
                } else if (chatwootContact.phone_number) {
                    generatedEmail = generateEmailFromPhone(chatwootContact.phone_number);
                    rdData.email = generatedEmail;
                } else {
                    const instagramSourceId = _getInstagramSourceId(chatwootContact);
                    if (instagramSourceId) {
                        generatedEmail = `${instagramSourceId}@email.com`;
                        rdData.email = generatedEmail;
                        console.log(`📱 Email falso generado desde Instagram source_id: ${generatedEmail}`);
                    } else {
                        throw new Error('No se puede sincronizar con RD Station: sin email válido');
                    }
                }
            }

            // Actualizar campos específicos
            if (extractedInfo.tiene_ichef) {
                rdData.cf_tiene_ichef = extractedInfo.tiene_ichef;
            }

            if (extractedInfo.id_equipo) {
                rdData.cf_id_equipo = extractedInfo.id_equipo;
            }

            console.log('📋 Payload inicial para RD Station:', JSON.stringify(rdData, null, 2));

            // Detectar cambio de email
            const emailActualizado = originalEmail &&
                originalEmail !== rdData.email &&
                originalEmail.includes('@email.com') &&
                rdData.email && !rdData.email.includes('@email.com');

            // Consultar contacto existente
            let rdContactBefore = null;
            const rdChanges = [];

            try {
                const emailParaBuscar = emailActualizado ? originalEmail : rdData.email;
                console.log(`🔍 Buscando contacto en RD Station con: ${emailParaBuscar}`);

                rdContactBefore = await rdStationClient.getContact(emailParaBuscar);

                if (rdContactBefore) {
                    console.log('📊 Contacto existente encontrado en RD Station');

                    // PROTECCIÓN: tiene_ichef y es_cliente NO pueden retroceder
                    if (rdContactBefore.cf_tiene_ichef === 'Sí') {
                        if (rdData.cf_tiene_ichef !== 'Sí') {
                            console.log(`⚠️  [RD Station] Evitando retroceso de tiene_ichef: "Sí" → "${rdData.cf_tiene_ichef}"`);
                            delete rdData.cf_tiene_ichef;
                        }
                    }

                    if (rdContactBefore.cf_es_cliente === 'Sí') {
                        if (rdData.cf_es_cliente !== 'Sí') {
                            console.log(`⚠️  [RD Station] Evitando retroceso de es_cliente: "Sí" → "${rdData.cf_es_cliente}"`);
                            delete rdData.cf_es_cliente;
                        }
                    }

                    // Comparar valores
                    Object.keys(rdData).forEach(field => {
                        if (field === 'email' || field === 'name') return;

                        const oldValue = rdContactBefore[field];
                        const newValue = rdData[field];

                        if (oldValue !== newValue) {
                            rdChanges.push({
                                field: field,
                                old: oldValue || 'No definido',
                                new: newValue
                            });
                        }
                    });

                    if (emailActualizado) {
                        rdChanges.push({
                            field: 'email',
                            old: originalEmail,
                            new: rdData.email
                        });
                    }
                }
            } catch (rdFetchError) {
                console.log('ℹ️  Contacto no existe en RD Station (será creado)');
            }

            console.log('📋 Payload final para RD Station:', JSON.stringify(rdData, null, 2));

            // Upsert en RD Station
            const previousEmail = emailActualizado ? originalEmail : null;
            const result = await rdStationClient.upsertContact(rdData, previousEmail);

            console.log(`✅ Contacto sincronizado con RD Station: ${rdData.email}`);

            // Registrar evento de conversión
            let conversionEventSent = false;
            try {
                await rdStationClient.sendConversionEvent(
                    rdData.email,
                    RD_CONVERSIONS.CONVERSATION_CLOSED,
                    {
                        tiene_ichef: extractedInfo.tiene_ichef || 'No',
                        es_cliente: extractedInfo.es_cliente || 'No',
                        conversation_id: chatwootContact.id
                    }
                );
                conversionEventSent = true;
            } catch (eventError) {
                console.error('⚠️  Error en evento RD Station:', eventError.message);
            }

            return {
                success: true,
                created: result.created,
                email: rdData.email,
                emailUpdated: result.emailUpdated || false,
                updatedFields: Object.keys(rdData).filter(k => !['email', 'name'].includes(k)),
                conversionEventSent,
                changes: rdChanges,
                generatedEmail
            };
        } catch (error) {
            console.error('❌ Error sincronizando con RD Station:', error.message);
            throw error;
        }
    }

    /**
     * Sincroniza ambos CRMs de manera coordinada
     * 
     * @param {number} contactId - ID del contacto en Chatwoot
     * @param {Object} currentContact - Contacto actual
     * @param {Object} extractedInfo - Información extraída
     * @param {Object} options - Opciones adicionales
     * @returns {Promise<Object>} - Resultados de ambas sincronizaciones
     */
    async syncBoth(contactId, currentContact, extractedInfo, options = {}) {
        const originalEmail = currentContact.email;

        try {
            // 1. Actualizar Chatwoot
            const chatwootResult = await this.updateChatwoot(
                contactId,
                currentContact,
                extractedInfo,
                options
            );

            // 2. Preparar contacto actualizado para RD
            const updatedContact = {
                ...currentContact,
                ...chatwootResult.contact,
                custom_attributes: {
                    ...currentContact.custom_attributes,
                    ...chatwootResult.contact.custom_attributes
                }
            };

            // 3. Sincronizar con RD Station
            let rdResult = null;
            try {
                rdResult = await this.syncRDStation(
                    updatedContact,
                    extractedInfo,
                    originalEmail
                );
            } catch (rdError) {
                console.error('❌ Error sincronizando con RD Station:', rdError.message);
                rdResult = {
                    success: false,
                    error: rdError.message
                };
            }

            // 4. Si se generó un email falso (Instagram, telefono), escribirlo en Chatwoot
            if (rdResult?.generatedEmail && !currentContact.email) {
                try {
                    console.log(`📧 Persistiendo email falso en Chatwoot: ${rdResult.generatedEmail}`);
                    await chatwootClient.updateContact(contactId, {
                        email: rdResult.generatedEmail,
                        custom_attributes: {
                            email: rdResult.generatedEmail
                        }
                    });
                } catch (updateError) {
                    console.warn(`⚠️ No se pudo actualizar email en Chatwoot: ${updateError.message}`);
                }
            }

            return {
                chatwoot: chatwootResult,
                rdStation: rdResult
            };
        } catch (error) {
            console.error('❌ Error en sincronización CRM:', error.message);
            throw error;
        }
    }
}

/**
 * Obtiene el source_id de Instagram del contacto si existe
 */
function _getInstagramSourceId(contact) {
    const inboxes = contact.contact_inboxes || [];
    const instagram = inboxes.find(ci => {
        const channelType = ci.inbox?.channel_type || ci.channel_type || '';
        return channelType === 'Channel::Instagram';
    });
    return instagram?.source_id || null;
}

export default new CRMSyncService();

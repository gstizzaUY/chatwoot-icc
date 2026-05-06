import chatwootClient from '../clients/chatwoot.client.js';
import rdStationClient from '../clients/rdstation.client.js';
import aiAnalysisService from './ai-analysis.service.js';
import multimediaProcessorService from './multimedia/multimedia-processor.service.js';
import {
    extractContactInfoFromMessages,
    determineLabels,
    analyzeSentiment,
    generateConversationSummary,
    validateExtractedInfo
} from '../utils/message-parser.utils.js';
import { mapContactChatwootToRD } from '../mappers/contact.mapper.js';
import { generateEmailFromPhone, isValidEmail } from '../utils/email.utils.js';
import { RD_CONVERSIONS } from '../constants/rdstation.constants.js';
import { EXCLUDED_CONTACT_IDS } from '../constants/agent.constants.js';

/**
 * Service para analizar conversaciones cerradas y actualizar información de contactos
 */
class ConversationAnalysisService {
    constructor() {
        // Cache para evitar procesamiento duplicado
        this.processingCache = new Map();
        this.cacheTimeout = 60000; // 60 segundos
    }

    /**
     * Procesa una conversación cerrada: analiza mensajes, actualiza contacto y sincroniza con RD Station
     * 
     * @param {number} conversationId - ID de la conversación en Chatwoot
     * @returns {Promise<Object>} - Resultado del procesamiento
     */
    async processClosedConversation(conversationId) {
        // Verificar si ya se está procesando esta conversación
        if (this.processingCache.has(conversationId)) {
            console.log(`⚠️ Conversación ${conversationId} ya está siendo procesada, omitiendo duplicado`);
            return {
                success: false,
                reason: 'already_processing'
            };
        }

        // Marcar como en proceso
        this.processingCache.set(conversationId, Date.now());
        
        // Limpiar cache después del timeout
        setTimeout(() => {
            this.processingCache.delete(conversationId);
        }, this.cacheTimeout);

        console.log(`📊 Iniciando análisis de conversación cerrada: ${conversationId}`);

        try {
            // 1. Obtener la conversación completa
            const conversation = await chatwootClient.getConversation(conversationId);
            
            if (!conversation) {
                throw new Error(`Conversación ${conversationId} no encontrada`);
            }

            // 2. Obtener mensajes de la conversación
            const messages = await chatwootClient.getConversationMessages(conversationId);
            
            if (!messages || messages.length === 0) {
                console.log(`⚠️  Conversación ${conversationId} no tiene mensajes, omitiendo análisis`);
                return {
                    success: false,
                    reason: 'no_messages'
                };
            }

            // DEBUG: Ver estructura real de mensajes
            if (messages.length > 0) {
                console.log('🔍 DEBUG - Muestra de mensaje:', JSON.stringify({
                    message_type: messages[0].message_type,
                    sender: messages[0].sender,
                    content: messages[0].content?.substring(0, 50),
                    private: messages[0].private,
                    incoming: messages[0].incoming,
                    outgoing: messages[0].outgoing
                }, null, 2));
            }

            // 2.1. Procesar multimedia de los mensajes (solo incoming)
            let multimediaProcessed = null;
            const hasAttachments = messages.some(msg => msg.attachments && msg.attachments.length > 0);
            
            if (hasAttachments) {
                console.log('🖼️  Detectados attachments en la conversación - procesando multimedia...');
                try {
                    multimediaProcessed = {
                        totalAudios: 0,
                        totalImages: 0,
                        extractedInfo: {},
                        transcriptions: [],
                        imageAnalysis: [],
                        fieldsUpdated: []
                    };

                    for (const msg of messages) {
                        // Solo procesar attachments de mensajes incoming (del cliente)
                        const isIncoming = 
                            msg.message_type === 0 || 
                            msg.message_type === '0' || 
                            msg.message_type === 'incoming' || 
                            msg.incoming === true;

                        if (isIncoming && msg.attachments && msg.attachments.length > 0) {
                            const result = await multimediaProcessorService.processMessageAttachments(msg);

                            if (result.hasMultimedia) {
                                // Contar multimedia procesada
                                multimediaProcessed.totalAudios += result.transcriptions.length;
                                multimediaProcessed.totalImages += result.imageAnalysis.length;

                                // Consolidar transcripciones y análisis
                                multimediaProcessed.transcriptions.push(...result.transcriptions);
                                multimediaProcessed.imageAnalysis.push(...result.imageAnalysis);

                                // Consolidar información extraída
                                Object.assign(multimediaProcessed.extractedInfo, result.extractedInfo);
                            }
                        }
                    }

                    console.log(`✅ Multimedia procesada: ${multimediaProcessed.totalAudios} audios, ${multimediaProcessed.totalImages} imágenes`);
                } catch (multimediaError) {
                    console.error('❌ Error procesando multimedia:', multimediaError.message);
                    multimediaProcessed = null; // Continuar sin multimedia
                }
            }

            // 3. Obtener contacto actual
            const contactId = conversation.meta?.sender?.id || conversation.contact_id;
            
            if (!contactId) {
                throw new Error('No se pudo identificar el contacto de la conversación');
            }

            // 3.1. Verificar si el contacto está excluido (conversaciones internas)
            if (EXCLUDED_CONTACT_IDS.includes(contactId)) {
                console.log(`🚫 Contacto ${contactId} está en lista de exclusión (conversación interna) - omitiendo análisis`);
                return {
                    success: false,
                    reason: 'excluded_contact'
                };
            }

            const currentContact = await this._getContactById(contactId);
            
            if (!currentContact) {
                throw new Error(`Contacto ${contactId} no encontrado`);
            }

            console.log(`👤 Contacto encontrado: ${currentContact.name} (${currentContact.email || 'sin email'})`);
            
            // Guardar email original (antes de actualizaciones) para detectar cambios en RD Station
            const originalEmail = currentContact.email;

            // 3.2. Obtener conversaciones previas del contacto (para contexto)
            let previousConversations = [];
            try {
                const allConversations = await chatwootClient.getConversationsByContact(contactId);
                
                // Filtrar conversaciones previas (excluir la actual)
                previousConversations = allConversations
                    .filter(conv => conv.id !== conversationId)
                    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); // Más recientes primero
                
                if (previousConversations.length > 0) {
                    console.log(`📚 Encontradas ${previousConversations.length} conversaciones previas del contacto`);
                }
            } catch (prevError) {
                console.warn('⚠️  No se pudieron obtener conversaciones previas:', prevError.message);
                // Continuar sin contexto previo
            }

            // 4. Extraer información de los mensajes (primero con IA, fallback a regex)
            let extractedInfo;
            let analysisMethod = 'regex';
            let sentimentAnalysis;

            // Intentar análisis con IA si está habilitado
            if (aiAnalysisService.isEnabled()) {
                try {
                    console.log('🤖 Intentando análisis con IA...');
                    const aiResult = await aiAnalysisService.analyzeConversation(
                        messages, 
                        currentContact,
                        previousConversations, // Pasar conversaciones previas para contexto
                        multimediaProcessed   // Pasar multimedia procesada
                    );
                    
                    extractedInfo = aiResult;
                    sentimentAnalysis = aiResult.sentiment;
                    analysisMethod = 'ai';
                    
                    console.log('✅ Análisis con IA exitoso');
                } catch (aiError) {
                    console.warn('⚠️  Análisis con IA falló, usando método de fallback (regex):', aiError.message);
                    // Continuar con método tradicional
                    extractedInfo = extractContactInfoFromMessages(messages, currentContact);
                    sentimentAnalysis = analyzeSentiment(messages);
                }
            } else {
                // Método tradicional (regex)
                console.log('📝 Usando análisis por regex (IA no habilitada)');
                extractedInfo = extractContactInfoFromMessages(messages, currentContact);
                sentimentAnalysis = analyzeSentiment(messages);
            }
            
            console.log(`🔍 Información extraída (método: ${analysisMethod}):`, {
                email: extractedInfo.email,
                tiene_ichef: extractedInfo.tiene_ichef,
                es_cliente: extractedInfo.es_cliente,
                confidence: extractedInfo.metadata?.confidence || 'unknown'
            });

            // 4.1. Consolidar información extraída de multimedia
            if (multimediaProcessed && Object.keys(multimediaProcessed.extractedInfo).length > 0) {
                console.log('🖼️  Consolidando información de multimedia:', multimediaProcessed.extractedInfo);
                
                // Priorizar información de multimedia (más específica)
                const beforeConsolidation = { ...extractedInfo };
                
                Object.entries(multimediaProcessed.extractedInfo).forEach(([key, value]) => {
                    if (value && value !== null && value !== '') {
                        const oldValue = extractedInfo[key];
                        extractedInfo[key] = value;
                        
                        // Registrar qué campos vinieron de multimedia
                        if (oldValue !== value) {
                            multimediaProcessed.fieldsUpdated.push({
                                field: key,
                                oldValue: oldValue || null,
                                newValue: value,
                                source: 'multimedia'
                            });
                        }
                    }
                });

                console.log(`✅ ${multimediaProcessed.fieldsUpdated.length} campos actualizados desde multimedia`);
            }

            // 5. Validar calidad de la información extraída
            const validation = validateExtractedInfo(extractedInfo);
            
            if (!validation.isValid) {
                console.warn(`⚠️  Información extraída con baja calidad (score: ${validation.score}):`, validation.issues);
                
                // Si la calidad es muy baja, no actualizar
                if (validation.score < 30) {
                    return {
                        success: false,
                        reason: 'low_quality_extraction',
                        validation
                    };
                }
            }

            // 6. Determinar etiquetas apropiadas
            const currentLabels = conversation.labels || [];
            const newLabels = determineLabels(extractedInfo, currentLabels);
            
            console.log(`🏷️  Etiquetas actualizadas: ${newLabels.join(', ')}`);

            // 7. Usar sentimiento (ya calculado arriba según el método)
            const sentiment = sentimentAnalysis || { sentiment: 'neutral', reason: 'No analizado' };
            console.log(`😊 Sentimiento: ${sentiment.sentiment} - ${sentiment.reason}`);

            // 8. Generar resumen (usar el de IA si existe, sino generar con regex)
            const summary = extractedInfo.summary || generateConversationSummary(messages, extractedInfo);

            // 9. Actualizar contacto en Chatwoot
            const chatwootUpdateResult = await this._updateContactInChatwoot(
                contactId,
                currentContact,
                extractedInfo,
                summary
            );

            // Combinar el contacto original con las actualizaciones
            let updatedContact = {
                ...currentContact,
                ...chatwootUpdateResult.contact,
                custom_attributes: {
                    ...currentContact.custom_attributes,
                    ...chatwootUpdateResult.contact.custom_attributes
                }
            };
            
            // Si la IA detectó un email válido, asegurarse de que esté en updatedContact
            if (extractedInfo.email && isValidEmail(extractedInfo.email)) {
                updatedContact.email = extractedInfo.email;
                if (!updatedContact.custom_attributes) {
                    updatedContact.custom_attributes = {};
                }
                updatedContact.custom_attributes.email = extractedInfo.email;
                console.log(`✅ Email detectado por IA asignado al contacto: ${extractedInfo.email}`);
            }
            
            // 9.1. Si no tiene email válido, generar uno desde el teléfono ANTES de sincronizar RD Station
            // IMPORTANTE: Solo generar si NO se detectó un email real en la conversación
            const hasValidEmail = (updatedContact.email && !updatedContact.email.includes('@email.com')) ||
                                  (extractedInfo.email && isValidEmail(extractedInfo.email));
            
            if (!hasValidEmail && updatedContact.phone_number) {
                const generatedEmail = generateEmailFromPhone(updatedContact.phone_number);
                
                if (generatedEmail) {
                    try {
                        console.log(`📧 Generando email desde teléfono (no se detectó email válido): ${generatedEmail}`);
                        
                        await chatwootClient.updateContact(contactId, {
                            email: generatedEmail,
                            custom_attributes: {
                                ...updatedContact.custom_attributes,
                                email: generatedEmail
                            }
                        });
                        
                        // Actualizar el objeto local
                        updatedContact.email = generatedEmail;
                        if (!updatedContact.custom_attributes) {
                            updatedContact.custom_attributes = {};
                        }
                        updatedContact.custom_attributes.email = generatedEmail;
                        
                        // Agregar cambio al reporte
                        chatwootUpdateResult.changes.push({
                            field: 'Email',
                            old: 'No definido',
                            new: generatedEmail
                        });
                        
                        console.log('✅ Email generado y actualizado en Chatwoot');
                    } catch (emailUpdateError) {
                        console.warn('⚠️  No se pudo actualizar email generado en Chatwoot:', emailUpdateError.message);
                    }
                }
            }

            // 10. Actualizar etiquetas en la conversación
            if (newLabels.length > 0) {
                await chatwootClient.setLabels(conversationId, newLabels);
            }

            // 11. Sincronizar con RD Station
            let rdStationUpdateResult = null;
            
            try {
                console.log('📤 Preparando sincronización con RD Station:', {
                    emailAnterior: originalEmail,
                    emailNuevo: updatedContact.email,
                    tiene_ichef: extractedInfo.tiene_ichef,
                    es_cliente: extractedInfo.es_cliente,
                    stage: extractedInfo.stage
                });
                
                rdStationUpdateResult = await this._syncToRDStation(
                    updatedContact,
                    extractedInfo,
                    originalEmail  // Pasar email original para detectar cambios
                );
            } catch (rdError) {
                console.error('❌ Error sincronizando con RD Station:', rdError.message);
                // No fallar todo el proceso si RD Station falla
                rdStationUpdateResult = {
                    success: false,
                    error: rdError.message
                };
            }

            // 11.1. Si RD Station generó email y Chatwoot aún no lo tiene, actualizarlo
            // (esto es un fallback, normalmente se hace en paso 9.1)
            if (rdStationUpdateResult?.generatedEmail && !currentContact.email && !updatedContact.email) {
                try {
                    console.log(`📧 Actualizando email desde RD Station en Chatwoot: ${rdStationUpdateResult.generatedEmail}`);
                    
                    await chatwootClient.updateContact(contactId, {
                        email: rdStationUpdateResult.generatedEmail,
                        custom_attributes: {
                            ...updatedContact.custom_attributes,
                            email: rdStationUpdateResult.generatedEmail
                        }
                    });
                    
                    // Agregar cambio al reporte
                    chatwootUpdateResult.changes.push({
                        field: 'Email',
                        old: 'No definido',
                        new: rdStationUpdateResult.generatedEmail
                    });
                    
                    console.log('✅ Email desde RD Station actualizado en Chatwoot');
                } catch (emailUpdateError) {
                    console.warn('⚠️  No se pudo actualizar email desde RD Station en Chatwoot:', emailUpdateError.message);
                }
            }

            // 12. Agregar nota interna en la conversación con el resumen
            await this._addInternalNote(conversationId, {
                summary,
                sentiment,
                extractedInfo,
                validation,
                rdStationSynced: rdStationUpdateResult?.success || false,
                chatwootChanges: chatwootUpdateResult?.changes || [],
                rdStationUpdate: rdStationUpdateResult,
                analysisMethod,
                multimediaProcessed  // Agregar información de multimedia
            });

            console.log(`✅ Conversación ${conversationId} procesada exitosamente`);

            return {
                success: true,
                conversationId,
                contactId,
                extractedInfo,
                labels: newLabels,
                sentiment,
                validation,
                chatwootUpdate: chatwootUpdateResult,
                rdStationUpdate: rdStationUpdateResult
            };

        } catch (error) {
            console.error(`❌ Error procesando conversación ${conversationId}:`, error.message);
            throw error;
        }
    }

    /**
     * Obtiene un contacto por ID de Chatwoot
     * @private
     */
    async _getContactById(contactId) {
        try {
            // Usar el método directo por ID (más confiable que el filtro)
            const contact = await chatwootClient.getContactById(contactId);
            return contact;
        } catch (error) {
            console.error('Error obteniendo contacto:', error.message);
            return null;
        }
    }

    /**
     * Actualiza el contacto en Chatwoot con la información extraída
     * @private
     */
    async _updateContactInChatwoot(contactId, currentContact, extractedInfo, summary) {
        const updateData = {
            custom_attributes: {
                ...currentContact.custom_attributes
            }
        };

        // Rastrear cambios para el reporte
        const changes = [];
        
        // Helper para actualizar campo si cambió
        const updateField = (location, field, newValue, displayName = null) => {
            // NO actualizar si el nuevo valor es undefined o null
            if (newValue === undefined || newValue === null) return;
            
            const fieldName = displayName || field;
            let oldValue;
            
            if (location === 'root') {
                oldValue = currentContact[field];
            } else {
                oldValue = currentContact.custom_attributes?.[field];
            }
            
            // Si ya tiene valor y el nuevo es null/undefined, NO actualizar
            if (oldValue && !newValue) return;
            
            // PROTECCIÓN: Evitar retroceso en stage (journey comercial)
            if (field === 'stage' && oldValue && newValue) {
                const stageHierarchy = {
                    'lead': 0,
                    'prospect': 0,
                    'marketingQualifiedLead': 1,
                    'mql': 1,
                    'salesQualifiedLead': 2,
                    'sql': 2,
                    'opportunity': 3,
                    'oportunidad': 3,
                    'customer': 4,
                    'cliente': 4
                };
                
                const oldLevel = stageHierarchy[oldValue] || 0;
                const newLevel = stageHierarchy[newValue] || 0;
                
                // Solo actualizar si avanza o se mantiene, NUNCA retroceder
                if (newLevel < oldLevel) {
                    console.log(`⚠️  Evitando retroceso de stage: ${oldValue} (nivel ${oldLevel}) → ${newValue} (nivel ${newLevel}) - Stage se mantiene`);
                    return; // NO actualizar
                }
            }
            
            // PROTECCIÓN: tiene_ichef y es_cliente NO pueden retroceder de "Sí" a "No"
            // Una vez que un contacto tiene iChef o es cliente, SIEMPRE lo es
            if ((field === 'tiene_ichef' || field === 'es_cliente') && oldValue === 'Sí') {
                if (newValue === 'No' || newValue === null || newValue === '') {
                    console.log(`⚠️  Evitando retroceso de ${fieldName || field}: "Sí" → "${newValue}" - Se mantiene "Sí"`);
                    return; // NO actualizar
                }
            }
            
            const oldValueDisplay = oldValue || 'No definido';
            
            // Comparar con null-safe
            const oldValueStr = String(oldValue || '');
            const newValueStr = String(newValue);
            
            if (oldValueStr !== newValueStr) {
                if (location === 'root') {
                    updateData[field] = newValue;
                } else {
                    updateData.custom_attributes[field] = newValue;
                }
                changes.push({ field: fieldName, old: oldValueDisplay, new: newValue });
            }
        };

        // SIEMPRE actualizar campos críticos (independiente de confianza)
        // Estos campos son fundamentales para el CRM
        updateField('custom', 'tiene_ichef', extractedInfo.tiene_ichef, 'Tiene iChef');
        updateField('custom', 'es_cliente', extractedInfo.es_cliente, 'Es Cliente');
        updateField('custom', 'id_equipo', extractedInfo.id_equipo, 'ID Equipo');
        updateField('custom', 'stage', extractedInfo.stage, 'Etapa');
        updateField('custom', 'language', extractedInfo.language, 'Idioma');
        updateField('custom', 'comments', extractedInfo.comments, 'Comentarios');
        
        // Actualizar campos solo si se extrajeron con suficiente confianza
        if (extractedInfo.metadata.confidence !== 'low') {
            
            // Campos raíz del contacto
            updateField('root', 'name', extractedInfo.firstname ? 
                `${extractedInfo.firstname}${extractedInfo.lastname ? ' ' + extractedInfo.lastname : ''}` : 
                null, 'Nombre completo');
            updateField('root', 'email', extractedInfo.email && isValidEmail(extractedInfo.email) ? extractedInfo.email : null, 'Email');
            updateField('root', 'phone_number', extractedInfo.mobile_phone || extractedInfo.phone, 'Teléfono');
            
            // Información básica
            updateField('custom', 'title', extractedInfo.title, 'Título');
            updateField('custom', 'email', extractedInfo.email && isValidEmail(extractedInfo.email) ? extractedInfo.email : null, 'Correo Electrónico');
            updateField('custom', 'firstname', extractedInfo.firstname, 'Nombre');
            updateField('custom', 'lastname', extractedInfo.lastname, 'Apellido');
            updateField('custom', 'company', extractedInfo.company, 'Empresa');
            updateField('custom', 'position', extractedInfo.position, 'Cargo');
            updateField('custom', 'mobile_phone', extractedInfo.mobile_phone, 'Celular');
            updateField('custom', 'phone', extractedInfo.phone, 'Teléfono');
            updateField('custom', 'website', extractedInfo.website, 'Página Web');
            
            // Ubicación
            updateField('custom', 'address', extractedInfo.address, 'Dirección');
            updateField('custom', 'city', extractedInfo.city, 'Ciudad');
            updateField('custom', 'state', extractedInfo.state, 'Departamento');
            updateField('custom', 'country', extractedInfo.country, 'País');
            updateField('custom', 'zip', extractedInfo.zip, 'Código Postal');
            
            // Redes sociales
            updateField('custom', 'facebook', extractedInfo.facebook, 'Facebook');
            updateField('custom', 'twitter', extractedInfo.twitter, 'Twitter');
            updateField('custom', 'linkedin', extractedInfo.linkedin, 'LinkedIn');
            updateField('custom', 'instagram', extractedInfo.instagram, 'Instagram');
            updateField('custom', 'skype', extractedInfo.skype, 'Skype');
            
            // Otros
            updateField('custom', 'status_contacto', extractedInfo.status_contacto, 'Estado Contacto');
            updateField('custom', 'client_comments', extractedInfo.client_comments, 'Comentarios Cliente');
            updateField('custom', 'cedula', extractedInfo.cedula, 'Cédula');
            updateField('custom', 'rut', extractedInfo.rut, 'RUT');
            
            // Encuesta/Preferencias
            updateField('custom', 'enc_experiencia', extractedInfo.enc_experiencia, 'Experiencia Cocina');
            updateField('custom', 'enc_gusta_cocinar', extractedInfo.enc_gusta_cocinar, 'Gusta Cocinar');
            updateField('custom', 'enc_frecuencia_cocina', extractedInfo.enc_frecuencia_cocina, 'Frecuencia Cocina');
            updateField('custom', 'enc_cantidad_personas_cocina', extractedInfo.enc_cantidad_personas_cocina, 'Personas Cocina');
            updateField('custom', 'enc_condicion_alimenticia', extractedInfo.enc_condicion_alimenticia, 'Condición Alimenticia');
            updateField('custom', 'enc_quien_cocina_casa', extractedInfo.enc_quien_cocina_casa, 'Quién Cocina');
            updateField('custom', 'enc_via_se_entero_ichef', extractedInfo.enc_via_se_entero_ichef, 'Cómo Conoció iChef');
        }
        
        // LÓGICA CRÍTICA: Si es_cliente = Sí → SIEMPRE es customer con iChef
        // Esta lógica se ejecuta ANTES de actualizar stage, para corregir si la IA se equivocó
        if (extractedInfo.es_cliente === 'Sí') {
            const currentStage = currentContact.custom_attributes?.stage;
            
            console.log('🎯 Detectado es_cliente=Sí → Forzando stage=customer y tiene_ichef=Sí');
            
            // Forzar stage = customer (incluso si la IA devolvió otro stage incorrecto)
            if (currentStage !== 'customer' && currentStage !== 'cliente') {
                // Sobrescribir el stage que la IA pudo haber devuelto
                extractedInfo.stage = 'customer';
                updateField('custom', 'stage', 'customer', 'Etapa');
            }
            
            // Forzar tiene_ichef = Sí (si compró, tiene el equipo)
            if (extractedInfo.tiene_ichef !== 'Sí') {
                extractedInfo.tiene_ichef = 'Sí';
                updateField('custom', 'tiene_ichef', 'Sí', 'Tiene iChef');
                console.log('✅ Auto-asignando tiene_ichef=Sí (detectado es_cliente=Sí)');
            }
        }


        // SINCRONIZAR campos de root a custom_attributes si existen
        // Esto asegura que campos visibles en la UI de Chatwoot se llenen con datos existentes
        if (currentContact.email && !updateData.custom_attributes.email && !currentContact.custom_attributes?.email) {
            updateData.custom_attributes.email = currentContact.email;
            console.log(`📧 Sincronizando email de root a custom_attributes: ${currentContact.email}`);
        }
        
        if (currentContact.name && !updateData.custom_attributes.name && !currentContact.custom_attributes?.name) {
            updateData.custom_attributes.name = currentContact.name;
        }
        
        if (currentContact.phone_number && !updateData.custom_attributes.phone && !currentContact.custom_attributes?.phone) {
            updateData.custom_attributes.phone = currentContact.phone_number;
        }

        // Agregar resumen de la conversación cerrada (siempre)
        updateData.custom_attributes.last_conversation_summary = summary;
        updateData.custom_attributes.last_conversation_analyzed_at = new Date().toISOString();

        try {
            const updatedContact = await chatwootClient.updateContact(contactId, updateData);
            
            console.log(`✅ Contacto ${contactId} actualizado en Chatwoot`);
            
            return {
                success: true,
                contact: updatedContact,
                changes: changes
            };

        } catch (error) {
            console.error('Error actualizando contacto en Chatwoot:', error.message);
            throw error;
        }
    }

    /**
     * Sincroniza el contacto actualizado con RD Station
     * @private
     * @param {Object} chatwootContact - Contacto actualizado de Chatwoot
     * @param {Object} extractedInfo - Información extraída de la conversación
     * @param {String} originalEmail - Email original del contacto (antes de actualizaciones)
     */
    async _syncToRDStation(chatwootContact, extractedInfo, originalEmail = null) {
        try {
            console.log(`🔄 Sincronizando con RD Station - Contacto: ${chatwootContact.name}, Email: ${chatwootContact.email}`);
            
            // Mapear contacto de Chatwoot a formato RD Station
            const rdData = mapContactChatwootToRD(chatwootContact);

            console.log(`🔄 Email mapeado para RD: ${rdData.email}`);

            // Variable para guardar email generado (para actualizar en Chatwoot después)
            let generatedEmail = null;

            // Asegurar que tiene email (obligatorio en RD Station)
            // IMPORTANTE: Solo generar si NO hay email válido detectado en la conversación
            const hasValidEmailFromConversation = extractedInfo.email && isValidEmail(extractedInfo.email);
            
            if (!rdData.email || rdData.email === 'null' || !isValidEmail(rdData.email)) {
                console.log(`⚠️ Email no válido en mapeo: '${rdData.email}'`);
                
                // Verificar si la IA detectó un email válido en la conversación
                if (hasValidEmailFromConversation) {
                    rdData.email = extractedInfo.email;
                    console.log(`✅ Usando email detectado en conversación: ${rdData.email}`);
                } else if (chatwootContact.phone_number) {
                    generatedEmail = generateEmailFromPhone(chatwootContact.phone_number);
                    rdData.email = generatedEmail;
                    console.log(`⚠️ Email generado desde teléfono para RD Station: ${rdData.email}`);
                } else {
                    console.error('❌ No hay email ni teléfono disponible para RD Station');
                    throw new Error('No se puede sincronizar con RD Station: sin email válido');
                }
            }

            // Actualizar campos específicos de la extracción
            if (extractedInfo.tiene_ichef) {
                rdData.cf_tiene_ichef = extractedInfo.tiene_ichef;
                console.log(`✅ Añadiendo tiene_ichef a RD Station: ${extractedInfo.tiene_ichef}`);
            }

            if (extractedInfo.id_equipo) {
                rdData.cf_id_equipo = extractedInfo.id_equipo;
                console.log(`✅ Añadiendo id_equipo a RD Station: ${extractedInfo.id_equipo}`);
            }

            // NO enviar lifecycle_stage - causa error 400 si no existe en RD Station
            // if (extractedInfo.es_cliente === 'Sí') {
            //     rdData.lifecycle_stage = 'Customer';
            // }

            console.log('📋 Payload inicial para RD Station:', JSON.stringify(rdData, null, 2));

            // DETECTAR CAMBIO DE EMAIL: ficticio → real
            const emailCambio = originalEmail && originalEmail !== rdData.email;
            const emailAntiguoEsFicticio = originalEmail && originalEmail.includes('@email.com');
            const emailNuevoEsReal = rdData.email && !rdData.email.includes('@email.com');
            
            const emailActualizado = emailCambio && emailAntiguoEsFicticio && emailNuevoEsReal;
            
            if (emailActualizado) {
                console.log(`🔄 Detectado cambio de email ficticio → real: ${originalEmail} → ${rdData.email}`);
            }
            
            // CONSULTAR contacto existente en RD Station para comparar cambios
            let rdContactBefore = null;
            const rdChanges = [];
            
            try {
                // Si el email cambió, buscar con el email ANTIGUO
                const emailParaBuscar = emailActualizado ? originalEmail : rdData.email;
                
                console.log(`🔍 Buscando contacto en RD Station con: ${emailParaBuscar}`);
                rdContactBefore = await rdStationClient.getContact(emailParaBuscar);
                
                if (rdContactBefore) {
                    console.log('📊 Contacto existente encontrado en RD Station, comparando cambios...');
                    
                    // PROTECCIÓN: tiene_ichef y es_cliente NO pueden retroceder de "Sí" a "No"
                    // Verificar ANTES de enviar a RD Station
                    if (rdContactBefore.cf_tiene_ichef === 'Sí') {
                        if (rdData.cf_tiene_ichef === 'No' || !rdData.cf_tiene_ichef) {
                            console.log(`⚠️  [RD Station] Evitando retroceso de tiene_ichef: "Sí" → "${rdData.cf_tiene_ichef}" - Se mantiene "Sí"`);
                            delete rdData.cf_tiene_ichef; // No enviar este campo a RD Station
                        }
                    }
                    
                    if (rdContactBefore.cf_es_cliente === 'Sí') {
                        if (rdData.cf_es_cliente === 'No' || !rdData.cf_es_cliente) {
                            console.log(`⚠️  [RD Station] Evitando retroceso de es_cliente: "Sí" → "${rdData.cf_es_cliente}" - Se mantiene "Sí"`);
                            delete rdData.cf_es_cliente; // No enviar este campo a RD Station
                        }
                    }
                    
                    // Comparar valores anteriores vs nuevos (después de protecciones)
                    Object.keys(rdData).forEach(field => {
                        // Excluir email y name de comparación
                        if (field === 'email' || field === 'name') return;
                        
                        const oldValue = rdContactBefore[field];
                        const newValue = rdData[field];
                        
                        // Solo registrar si el valor cambió
                        if (oldValue !== newValue) {
                            rdChanges.push({
                                field: field,
                                old: oldValue || 'No definido',
                                new: newValue
                            });
                        }
                    });
                    
                    // Si el email cambió, agregarlo a los cambios
                    if (emailActualizado) {
                        rdChanges.push({
                            field: 'email',
                            old: originalEmail,
                            new: rdData.email
                        });
                    }
                    
                    console.log(`🔄 Cambios detectados en RD Station: ${rdChanges.length}`);
                }
            } catch (rdFetchError) {
                console.log('ℹ️ No se pudo obtener contacto previo de RD Station (será creado):', rdFetchError.message);
            }

            // Rastrear qué campos se envían a RD Station (DESPUÉS de protecciones)
            const rdFields = Object.keys(rdData).filter(key => 
                !['email', 'name'].includes(key) && rdData[key] !== undefined
            );
            
            console.log('📋 Payload final para RD Station (después de protecciones):', JSON.stringify(rdData, null, 2));

            // Upsert en RD Station - pasar email anterior si cambió
            const previousEmail = emailActualizado ? originalEmail : null;
            const result = await rdStationClient.upsertContact(rdData, previousEmail);

            console.log(`✅ Contacto sincronizado con RD Station: ${rdData.email}`);

            // Registrar evento de conversación cerrada
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
                console.error('⚠️  Error en evento RD Station:', {
                    message: eventError.message,
                    status: eventError.response?.status,
                    data: eventError.response?.data
                });
            }

            return {
                success: true,
                created: result.created,
                email: rdData.email,
                emailUpdated: result.emailUpdated || false,
                updatedFields: rdFields,
                conversionEventSent: conversionEventSent,
                changes: rdChanges,
                generatedEmail: generatedEmail // Para actualizar en Chatwoot si se generó
            };

        } catch (error) {
            console.error('Error sincronizando con RD Station:', error.message);
            throw error;
        }
    }

    /**
     * Agrega una nota interna en la conversación con el análisis
     * @private
     */
    async _addInternalNote(conversationId, analysisData) {
        try {
            const info = analysisData.extractedInfo;
            const chatwootChanges = analysisData.chatwootChanges || [];
            const methodBadge = analysisData.analysisMethod === 'ai' ? '🤖 IA' : '📝 Regex';
            
            // ============ SECCIÓN 1: RESUMEN ============
            const resumenSection = `📋 **RESUMEN DE LA CONVERSACIÓN**\n${analysisData.summary || 'No se pudo generar resumen'}`;
            
            // ============ SECCIÓN 2: SENTIMIENTO ============
            const sentimentEmoji = analysisData.sentiment.sentiment === 'positive' ? '😊' : 
                                  analysisData.sentiment.sentiment === 'negative' ? '😞' : '😐';
            const sentimentSection = `\n\n${sentimentEmoji} **SENTIMIENTO: ${analysisData.sentiment.sentiment.toUpperCase()}**\n${analysisData.sentiment.reason}`;
            
            // ============ SECCIÓN 3: INFORMACIÓN DETECTADA ============
            // Mostrar solo información que fue actualizada o es relevante
            const detectedFields = [];
            
            // Agregar campos que fueron actualizados en Chatwoot
            const updatedFieldNames = chatwootChanges.map(c => {
                // Mapear nombre amigable a nombre técnico
                const fieldMap = {
                    'Email': 'email',
                    'Nombre': 'firstname',
                    'Apellido': 'lastname',
                    'Celular': 'mobile_phone',
                    'Teléfono': 'phone',
                    'Tiene iChef': 'tiene_ichef',
                    'Es Cliente': 'es_cliente',
                    'ID Equipo': 'id_equipo',
                    'Etapa': 'stage',
                    'Ciudad': 'city',
                    'Departamento': 'state',
                    'País': 'country',
                    'Dirección': 'address',
                    'Empresa': 'company',
                    'Cargo': 'position'
                };
                return fieldMap[c.field] || c.field.toLowerCase();
            });
            
            // Información básica (solo si fue actualizada o es nueva)
            if (info.email && (updatedFieldNames.includes('email') || info.metadata?.confidence !== 'low')) {
                detectedFields.push(`✓ Email: ${info.email}`);
            }
            if (info.firstname && (updatedFieldNames.includes('firstname') || updatedFieldNames.includes('nombre'))) {
                detectedFields.push(`✓ Nombre: ${info.firstname}`);
            }
            if (info.lastname && (updatedFieldNames.includes('lastname') || updatedFieldNames.includes('apellido'))) {
                detectedFields.push(`✓ Apellido: ${info.lastname}`);
            }
            if (info.mobile_phone && updatedFieldNames.includes('mobile_phone')) {
                detectedFields.push(`✓ Celular: ${info.mobile_phone}`);
            }
            if (info.phone && updatedFieldNames.includes('phone')) {
                detectedFields.push(`✓ Teléfono: ${info.phone}`);
            }
            
            // iChef específico
            if (info.tiene_ichef && updatedFieldNames.includes('tiene_ichef')) {
                detectedFields.push(`✓ Tiene iChef: ${info.tiene_ichef}`);
            }
            if (info.es_cliente && updatedFieldNames.includes('es_cliente')) {
                detectedFields.push(`✓ Es Cliente: ${info.es_cliente}`);
            }
            if (info.id_equipo && updatedFieldNames.includes('id_equipo')) {
                detectedFields.push(`✓ ID Equipo: ${info.id_equipo}`);
            }
            if (info.stage && updatedFieldNames.includes('stage')) {
                detectedFields.push(`✓ Etapa: ${info.stage}`);
            }
            
            // Ubicación
            if (info.city && updatedFieldNames.includes('city')) {
                detectedFields.push(`✓ Ciudad: ${info.city}`);
            }
            if (info.state && updatedFieldNames.includes('state')) {
                detectedFields.push(`✓ Departamento: ${info.state}`);
            }
            if (info.country && updatedFieldNames.includes('country')) {
                detectedFields.push(`✓ País: ${info.country}`);
            }
            if (info.address && updatedFieldNames.includes('address')) {
                detectedFields.push(`✓ Dirección: ${info.address}`);
            }
            
            // Empresa
            if (info.company && updatedFieldNames.includes('company')) {
                detectedFields.push(`✓ Empresa: ${info.company}`);
            }
            if (info.position && updatedFieldNames.includes('position')) {
                detectedFields.push(`✓ Cargo: ${info.position}`);
            }
            
            // Preferencias
            if (info.enc_experiencia && updatedFieldNames.includes('enc_experiencia')) {
                detectedFields.push(`✓ Experiencia: ${info.enc_experiencia}`);
            }
            if (info.enc_gusta_cocinar && updatedFieldNames.includes('enc_gusta_cocinar')) {
                detectedFields.push(`✓ Gusta Cocinar: ${info.enc_gusta_cocinar}`);
            }
            if (info.enc_via_se_entero_ichef && updatedFieldNames.includes('enc_via_se_entero_ichef')) {
                detectedFields.push(`✓ Conoció iChef por: ${info.enc_via_se_entero_ichef}`);
            }
            
            const infoSection = detectedFields.length > 0 
                ? `\n\n🔍 **INFORMACIÓN DETECTADA**\n${detectedFields.join('\n')}`
                : '\n\n🔍 **INFORMACIÓN DETECTADA**\n⚠️ No se detectó información nueva para actualizar';
            
            // ============ SECCIÓN 4: CAMBIOS EN CHATWOOT ============
            let chatwootSection = '';
            
            if (chatwootChanges.length > 0) {
                const changesList = chatwootChanges.map(change => 
                    `  • **${change.field}**: \`${change.old}\` → \`${change.new}\``
                ).join('\n');
                chatwootSection = `\n\n📝 **CAMPOS ACTUALIZADOS EN CHATWOOT** (${chatwootChanges.length})\n${changesList}`;
            } else {
                chatwootSection = '\n\n📝 **CAMPOS ACTUALIZADOS EN CHATWOOT**\n✓ Sin cambios (datos ya actualizados)';
            }
            
            // ============ SECCIÓN 5: SINCRONIZACIÓN CON RD STATION ============
            let rdSection = '';
            const rdUpdate = analysisData.rdStationUpdate;
            
            if (rdUpdate?.success) {
                const action = rdUpdate.created ? '✨ Contacto creado' : '🔄 Contacto actualizado';
                const rdChanges = rdUpdate.changes || [];
                
                // Nota especial si se mantuvo email ficticio por limitaciones de RD Station
                // Nota si el email fue actualizado
                let emailNote = '';
                if (rdUpdate.emailUpdated) {
                    emailNote = `\n  ✅ Email actualizado en RD Station: \`${rdUpdate.email}\``;
                }
                
                // Mostrar cambios detectados (antes → después)
                let changesText = '';
                if (rdChanges.length > 0) {
                    const changesList = rdChanges.map(change => 
                        `    • **${change.field}**: \`${change.old}\` → \`${change.new}\``
                    ).join('\n');
                    changesText = `\n  📝 Cambios detectados (${rdChanges.length}):\n${changesList}`;
                } else if (!rdUpdate.created) {
                    changesText = '\n  ℹ️  Sin cambios (datos ya actualizados)';
                }
                
                const eventText = rdUpdate.conversionEventSent 
                    ? '\n  ✓ Evento de conversión registrado' 
                    : '';
                
                rdSection = `\n\n🔄 **RD STATION**\n  ${action} (${rdUpdate.email})${emailNote}${changesText}${eventText}`;
            } else if (rdUpdate?.error) {
                // Si falló, mostrar error detallado y valores pendientes
                const errorDetails = rdUpdate.errorDetails || {};
                const statusInfo = errorDetails.status ? ` (${errorDetails.status})` : '';
                const errorData = errorDetails.data ? `\n  📋 Detalle: ${JSON.stringify(errorDetails.data)}` : '';
                
                const pendingFields = [];
                if (info.tiene_ichef) pendingFields.push(`cf_tiene_ichef: ${info.tiene_ichef}`);
                if (info.es_cliente) pendingFields.push(`cf_es_cliente: ${info.es_cliente}`);
                if (info.id_equipo) pendingFields.push(`cf_id_equipo: ${info.id_equipo}`);
                if (info.stage) pendingFields.push(`stage: ${info.stage}`);
                
                const manualUpdate = pendingFields.length > 0
                    ? `\n  ⚠️ Valores pendientes de actualización manual:\n    ${pendingFields.join('\n    ')}`
                    : '';
                
                rdSection = `\n\n🔄 **RD STATION**\n  ❌ Error${statusInfo}: ${rdUpdate.error}${errorData}${manualUpdate}`;
            } else {
                rdSection = '\n\n🔄 **RD STATION**\n  ⚠️ No sincronizado';
            }
            
            // ============ SECCIÓN 5A: MULTIMEDIA ============
            let multimediaSection = '';
            const multimedia = analysisData.multimediaProcessed;
            
            if (multimedia && (multimedia.totalAudios > 0 || multimedia.totalImages > 0)) {
                multimediaSection = `\n\n🎬 **MULTIMEDIA PROCESADA**\n`;
                
                // Audios procesados
                if (multimedia.totalAudios > 0) {
                    multimediaSection += `  🎤 **Audios transcritos: ${multimedia.totalAudios}**\n`;
                    multimedia.transcriptions.forEach((audio, i) => {
                        const duration = audio.duration ? ` (${Math.round(audio.duration)}s)` : '';
                        const preview = audio.text ? audio.text.substring(0, 100) : '[Sin texto]';
                        multimediaSection += `     ${i + 1}. ${preview}...${duration}\n`;
                    });
                }
                
                // Imágenes/documentos procesados
                if (multimedia.totalImages > 0) {
                    const withInfo = multimedia.imageAnalysis.filter(img => img.contact_info_found && !img.error);
                    multimediaSection += `\n  🖼️  **Imágenes/Documentos analizados: ${multimedia.totalImages}**\n`;
                    
                    if (withInfo.length > 0) {
                        multimediaSection += `     ✓ ${withInfo.length} con información de contacto detectada\n`;
                    }
                    
                    multimedia.imageAnalysis.forEach((img, i) => {
                        if (img.description) {
                            const preview = img.description.substring(0, 80);
                            multimediaSection += `     ${i + 1}. ${preview}...\n`;
                        }
                    });
                }
                
                // Campos actualizados desde multimedia
                if (multimedia.fieldsUpdated && multimedia.fieldsUpdated.length > 0) {
                    multimediaSection += `\n  📝 **Campos actualizados desde multimedia:**\n`;
                    multimedia.fieldsUpdated.forEach(update => {
                        const oldDisplay = update.oldValue || '(vacío)';
                        multimediaSection += `     • **${update.field}**: \`${oldDisplay}\` → \`${update.newValue}\`\n`;
                    });
                }
                
                // Resumen de información extraída
                const extractedFromMedia = multimedia.extractedInfo;
                if (extractedFromMedia && Object.keys(extractedFromMedia).length > 0) {
                    const relevantFields = [];
                    if (extractedFromMedia.firstname) relevantFields.push(`Nombre: ${extractedFromMedia.firstname}`);
                    if (extractedFromMedia.lastname) relevantFields.push(`Apellido: ${extractedFromMedia.lastname}`);
                    if (extractedFromMedia.email) relevantFields.push(`Email: ${extractedFromMedia.email}`);
                    if (extractedFromMedia.mobile_phone) relevantFields.push(`Celular: ${extractedFromMedia.mobile_phone}`);
                    if (extractedFromMedia.equipment_serial) relevantFields.push(`Serial: ${extractedFromMedia.equipment_serial}`);
                    
                    if (relevantFields.length > 0) {
                        multimediaSection += `\n  ℹ️  **Info extraída:** ${relevantFields.join(', ')}\n`;
                    }
                }
            }
            
            // ============ SECCIÓN 6: LEAD SCORING ============
            const scoringSection = `\n\n📊 **LEAD SCORING**
  📈 Interés: (A desarrollar próximamente)
  ⚡ Actividad: (A desarrollar próximamente)`;
            
            // ============ SECCIÓN 7: RECOMENDACIONES ============
            const recommendations = info.recommendations || [];
            let recSection = '';
            
            if (recommendations.length > 0) {
                const recList = recommendations.map((rec, i) => `  ${i + 1}. ${rec}`).join('\n');
                recSection = `\n\n💡 **RECOMENDACIONES**\n${recList}`;
            } else {
                // Recomendaciones automáticas basadas en el análisis
                const autoRecs = [];
                
                if (info.tiene_ichef === 'Sí' && !info.id_equipo) {
                    autoRecs.push('Solicitar número de serie del equipo para registro');
                }
                if (info.metadata?.requires_followup) {
                    autoRecs.push('Requiere seguimiento - programar contacto');
                }
                if (info.metadata?.customer_intent === 'compra') {
                    autoRecs.push('Cliente con intención de compra - priorizar seguimiento');
                }
                if (analysisData.sentiment.sentiment === 'negative') {
                    autoRecs.push('Cliente insatisfecho - contactar para resolver situación');
                }
                if (!info.email || info.email.includes('@email.com')) {
                    autoRecs.push('Solicitar email válido del contacto');
                }
                
                if (autoRecs.length > 0) {
                    const recList = autoRecs.map((rec, i) => `  ${i + 1}. ${rec}`).join('\n');
                    recSection = `\n\n💡 **RECOMENDACIONES**\n${recList}`;
                } else {
                    recSection = '\n\n💡 **RECOMENDACIONES**\n  ✓ Sin acciones pendientes';
                }
            }
            
            // ============ SECCIÓN 8: ANÁLISIS MULTI-CANAL ============
            let multiChannelSection = '';
            const multiChannel = info.metadata?.multi_channel_analysis;
            
            if (multiChannel && multiChannel.totalConversations > 0) {
                multiChannelSection = `\n\n🌐 **ANÁLISIS MULTI-CANAL**\n`;
                multiChannelSection += `  📊 Total conversaciones analizadas: ${multiChannel.totalConversations + 1}\n`;
                multiChannelSection += `  📱 Canales: ${multiChannel.channels.join(', ')}\n\n`;
                multiChannelSection += `  📝 Historial:\n`;
                const lines = multiChannel.summary.split('\n').slice(0, 5); // Primeras 5 líneas
                lines.forEach(line => {
                    if (line.trim()) {
                        multiChannelSection += `     ${line}\n`;
                    }
                });
                
                if (info.metadata?.previous_conversations_context) {
                    multiChannelSection += `\n  🔗 Relación: ${info.metadata.previous_conversations_context}`;
                }
            } else if (info.metadata?.previous_conversations_context) {
                multiChannelSection = `\n\n📚 **CONTEXTO: CONVERSACIONES ANTERIORES**\n  🔗 ${info.metadata.previous_conversations_context}`;
            }
            
            // ============ FOOTER ============
            const footer = `\n\n---\n_Análisis generado automáticamente al cerrar la conversación_`;
            
            // ============ CONSTRUIR NOTA COMPLETA ============
            const noteContent = `${resumenSection}${sentimentSection}${infoSection}${chatwootSection}${rdSection}${multimediaSection}${scoringSection}${recSection}${multiChannelSection}${footer}`;

            await chatwootClient.sendMessage(conversationId, {
                content: noteContent,
                message_type: 'outgoing',
                private: true
            });

            console.log(`📝 Nota interna agregada a conversación ${conversationId}`);

        } catch (error) {
            console.warn('⚠️  No se pudo agregar nota interna:', error.message);
            // No lanzar error, es opcional
        }
    }

    /**
     * Procesa múltiples conversaciones en lote
     * 
     * @param {Array<number>} conversationIds - Array de IDs de conversaciones
     * @returns {Promise<Object>} - Resultados del procesamiento
     */
    async processBulkConversations(conversationIds) {
        const results = {
            total: conversationIds.length,
            success: 0,
            failed: 0,
            details: []
        };

        for (const conversationId of conversationIds) {
            try {
                const result = await this.processClosedConversation(conversationId);
                
                if (result.success) {
                    results.success++;
                } else {
                    results.failed++;
                }

                results.details.push({
                    conversationId,
                    success: result.success,
                    reason: result.reason || null
                });

                // Pequeño delay entre conversaciones
                await new Promise(resolve => setTimeout(resolve, 500));

            } catch (error) {
                results.failed++;
                results.details.push({
                    conversationId,
                    success: false,
                    error: error.message
                });
            }
        }

        return results;
    }
}

export default new ConversationAnalysisService();

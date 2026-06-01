import axios from 'axios';
import dotenv from 'dotenv';
import onboardingHsmStarterPack from './onboardingHsmController.js';

dotenv.config();

const RD_STATION_CONFIG = {
    API_BASE_URL: process.env.RDSTATION_URL
};

const chatwoot_url = process.env.CHATWOOT_URL;
const api_access_token = process.env.API_ACCESS_TOKEN;

/**
 * Configuración de etapas del flujo de onboarding
 * 🔧 EDITA AQUÍ los mensajes informativos para el operador de cada etapa
 * NOTA: Estos mensajes son INTERNOS para el operador, no llegan al cliente
 */
const ETAPAS_CONFIG = {
    'starter-pack': {
        day: 0,
        type: 'hsm',
        name: 'Whatsapp Starter Pack HSM',
        description: 'Envío de HSM con guía de inicio'
    },
    '1': {
        day: 1,
        type: 'chatwoot',
        name: 'Campaña Onboarding Chatwoot',
        message: '📋 Onboarding - Cliente en la etapa D+1\n\n' +
                 '🎯 Objetivo: Primer contacto post-venta, verificar que recibió el Starter Pack y resolver dudas iniciales sobre configuración y primeras recetas.'
    },
    '7': {
        day: 7,
        type: 'chatwoot',
        name: 'Campaña Onboarding Chatwoot 2',
        message: '📋 Onboarding - Cliente en la etapa D+7\n\n' +
                 '🎯 Objetivo: Seguimiento después de una semana de uso. Consultar sobre la experiencia, recomendar recetas y funcionalidades de la app.'
    },
    '15': {
        day: 15,
        type: 'chatwoot',
        name: 'Seguimiento Post-Venta',
        message: '📋 Onboarding - Cliente en la etapa D+15\n\n' +
                 '🎯 Objetivo: Recopilar feedback sobre la experiencia hasta el momento. Identificar posibles mejoras o necesidades de soporte.'
    },
    '30': {
        day: 30,
        type: 'chatwoot',
        name: 'Campaña Onboarding Chatwoot 3',
        message: '📋 Onboarding - Cliente en la etapa D+30\n\n' +
                 '🎯 Objetivo: Seguimiento mensual. Consultar recetas favoritas, ofrecer contenido nuevo y reforzar el uso de funcionalidades avanzadas.'
    },
    '60': {
        day: 60,
        type: 'chatwoot',
        name: 'Seguimiento Extendido',
        message: '📋 Onboarding - Cliente en la etapa D+60\n\n' +
                 '🎯 Objetivo: Evaluación de experiencia a dos meses. Identificar oportunidades de mejora y asegurar satisfacción del cliente.'
    },
    '90': {
        day: 90,
        type: 'chatwoot',
        name: 'Campaña Onboarding Chatwoot 4 + Referidos',
        message: '📋 Onboarding - Cliente en la etapa D+90\n\n' +
                 '🎯 Objetivo: Seguimiento trimestral. Cliente consolidado. Presentar programa de referidos y solicitar testimonial si está satisfecho.'
    }
};

/**
 * Valida si una etapa es válida
 * @param {string} etapa - Etapa a validar
 * @returns {boolean} - True si es válida
 */
const isValidEtapa = (etapa) => {
    return etapa in ETAPAS_CONFIG;
};

/**
 * Obtiene la configuración de una etapa
 * @param {string} etapa - Etapa a consultar
 * @returns {Object|null} - Configuración de la etapa o null
 */
const getEtapaConfig = (etapa) => {
    return ETAPAS_CONFIG[etapa] || null;
};

const processLead = async (lead, etapa) => {
    const etapaConfig = getEtapaConfig(etapa);
    
    console.log(`📋 Procesando lead | ID: ${lead.id} | Nombre: ${lead.name} | Etapa: D+${etapaConfig.day} (${etapaConfig.name})`);
    
    const contactData = {
        id: lead.id || null,
        email: lead.email || null,
        phone: lead.personal_phone || lead.mobile_phone || lead.phone || null,
        name: lead.name || '',
        inbox_id: lead.inbox_id || "14",
        system_message: etapaConfig.message // Mensaje personalizado según la etapa
    };

    console.log(`🔍 Buscando contacto | ID: ${contactData.id} | Email: ${contactData.email} | Phone: ${contactData.phone}`);

    const buildPayloadItem = (key, value) => {
        if (!value) return null;
        return {
            attribute_key: key,
            filter_operator: "equal_to",
            values: [value],
            query_operator: "OR"
        };
    };

    const payload = {
        payload: [
            { value: contactData.id, key: 'id' },
            { value: contactData.email, key: 'email' },
            { value: contactData.phone, key: 'phone_number' }
        ]
            .map(item => buildPayloadItem(item.key, item.value))
            .filter(Boolean)
            .map((item, index, array) => ({
                ...item,
                query_operator: index === array.length - 1 ? null : "OR"
            }))
    };

    const filterResp = await axios.post(`${chatwoot_url}/api/v1/accounts/2/contacts/filter`, payload, {
        headers: {
            'Content-Type': 'application/json',
            'api_access_token': api_access_token,
        },
    });

    let target;
    
    if (filterResp.data.meta.count > 0) {
        // Contacto encontrado
        target = filterResp.data.payload[0];
        console.log(`✅ Contacto encontrado en Chatwoot | Lead ID: ${lead.id} | Chatwoot ID: ${target.id} | Nombre: ${target.name}`);
    } else {
        // Contacto NO encontrado - crear nuevo contacto
        console.log(`⚠️ Contacto no encontrado en Chatwoot | Lead ID: ${lead.id} | Creando nuevo contacto...`);
        
        // Preparar datos para crear el contacto
        const newContactPayload = {
            name: contactData.name
        };
        
        // Agregar email si es válido
        if (contactData.email && contactData.email.includes('@')) {
            newContactPayload.email = contactData.email;
        }
        
        // Agregar teléfono si existe
        if (contactData.phone) {
            newContactPayload.phone_number = contactData.phone;
        }
        
        // Agregar custom attributes si existen
        const customAttrs = {};
        if (lead.id) customAttrs.id = lead.id;
        if (lead.cedula) customAttrs.cedula = lead.cedula;
        if (lead.rut) customAttrs.rut = lead.rut;
        if (lead.city) customAttrs.city = lead.city;
        if (lead.country) customAttrs.country = lead.country;
        
        if (Object.keys(customAttrs).length > 0) {
            newContactPayload.custom_attributes = customAttrs;
        }
        
        try {
            const createContactResp = await axios.post(
                `${chatwoot_url}/api/v1/accounts/2/contacts`,
                newContactPayload,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'api_access_token': api_access_token,
                    },
                }
            );
            
            target = createContactResp.data.payload;
            console.log(`✅ Contacto creado en Chatwoot | Lead ID: ${lead.id} | Chatwoot ID: ${target.id} | Nombre: ${target.name}`);
        } catch (createError) {
            console.error(`❌ Error al crear contacto en Chatwoot | Lead ID: ${lead.id}:`, createError.message);
            if (createError.response?.data) {
                console.error('📋 Detalles del error:', JSON.stringify(createError.response.data, null, 2));
            }
            return {
                success: false,
                leadId: lead.id,
                leadName: lead.name,
                etapa: `D+${etapaConfig.day}`,
                etapaName: etapaConfig.name,
                message: `Error al crear contacto: ${createError.message}`
            };
        }
    }

    console.log(`💬 Creando conversación | Contacto ID: ${target.id} | Inbox: ${contactData.inbox_id} | Etapa: ${etapaConfig.name}`);

    // Crear la conversación con el contacto (encontrado o creado)
    const conversationData = {
        inbox_id: contactData.inbox_id,
        source_id: target.custom_attributes?.id || null,
        contact_id: target.id,
        status: 'open',
        assignee_id: '19',
        team_id: 4,
        message: {
            content: contactData.system_message,
            private: true,
        }
    };

    const createResp = await axios.post(`${chatwoot_url}/api/v1/accounts/2/conversations`, conversationData, {
        headers: {
            'Content-Type': 'application/json',
            'api_access_token': api_access_token,
        },
    });

    console.log(`✅ Conversación creada exitosamente | Conversación ID: ${createResp.data.id} | Lead: ${lead.name} | Etapa: D+${etapaConfig.day}`);

    return {
        success: true,
        leadId: lead.id,
        leadName: lead.name,
        conversationId: createResp.data.id,
        contactId: target.id,
        wasCreated: filterResp.data.meta.count === 0,
        etapa: `D+${etapaConfig.day}`,
        etapaName: etapaConfig.name,
        message: 'Conversación creada exitosamente'
    };
};

const onboarding = async (req, res) => {
    const requestId = Math.random().toString(36).substring(7);
    
    try {
        const { etapa } = req.params;
        console.log(`\n${'='.repeat(80)}`);
        console.log(`🚀 [${requestId}] INICIO PROCESO ONBOARDING | Etapa recibida: "${etapa}"`);
        console.log(`${'='.repeat(80)}`);
        
        // Validar etapa
        if (!isValidEtapa(etapa)) {
            const validEtapas = Object.keys(ETAPAS_CONFIG).join(', ');
            console.error(`❌ [${requestId}] Etapa inválida: "${etapa}" | Etapas válidas: ${validEtapas}`);
            return res.status(400).json({ 
                error: 'Etapa inválida',
                etapa: etapa,
                etapasValidas: Object.keys(ETAPAS_CONFIG),
                mensaje: `Las etapas válidas son: ${validEtapas}`
            });
        }

        const etapaConfig = getEtapaConfig(etapa);
        console.log(`✅ [${requestId}] Etapa válida: D+${etapaConfig.day} - ${etapaConfig.name} (${etapaConfig.type})`);
        
        // Si la etapa es "starter-pack", redirigir al controlador HSM
        if (etapa === 'starter-pack') {
            console.log(`🔀 [${requestId}] Redirigiendo a onboardingHsmStarterPack...`);
            return await onboardingHsmStarterPack(req, res);
        }
        
        console.log(`📊 [${requestId}] Datos recibidos:`, JSON.stringify(req.body, null, 2));

        const leads = req.body?.leads;
        if (!leads || !Array.isArray(leads) || leads.length === 0) {
            console.error(`❌ [${requestId}] No se recibieron leads en el body`);
            return res.status(400).json({ 
                error: 'No se recibieron leads en el body',
                requestId: requestId
            });
        }

        console.log(`📦 [${requestId}] Procesando ${leads.length} lead(s) para etapa D+${etapaConfig.day}...`);

        const results = [];
        const errors = [];
        let contactsCreated = 0;
        let contactsFound = 0;

        for (const lead of leads) {
            try {
                console.log(`\n--- [${requestId}] Lead ${lead.id} - ${lead.name} ---`);
                const result = await processLead(lead, etapa);
                
                if (result.success) {
                    results.push(result);
                    if (result.wasCreated) {
                        contactsCreated++;
                    } else {
                        contactsFound++;
                    }
                } else {
                    errors.push(result);
                }
            } catch (error) {
                console.error(`❌ [${requestId}] Error al procesar lead ${lead.id}:`, error.message);
                if (error.response?.data) {
                    console.error(`📋 [${requestId}] Detalles del error:`, JSON.stringify(error.response.data, null, 2));
                }
                errors.push({
                    success: false,
                    leadId: lead.id,
                    leadName: lead.name,
                    etapa: `D+${etapaConfig.day}`,
                    etapaName: etapaConfig.name,
                    error: error.message
                });
            }
        }

        const successCount = results.filter(r => r.success).length;
        const failureCount = results.filter(r => !r.success).length + errors.length;

        console.log(`\n${'='.repeat(80)}`);
        console.log(`📊 [${requestId}] RESUMEN PROCESO ONBOARDING`);
        console.log(`${'='.repeat(80)}`);
        console.log(`Etapa: D+${etapaConfig.day} - ${etapaConfig.name}`);
        console.log(`Total leads recibidos: ${leads.length}`);
        console.log(`✅ Exitosos: ${successCount}`);
        console.log(`❌ Fallidos: ${failureCount}`);
        console.log(`🆕 Contactos creados: ${contactsCreated}`);
        console.log(`🔍 Contactos encontrados: ${contactsFound}`);
        console.log(`${'='.repeat(80)}\n`);

        return res.status(200).json({
            requestId: requestId,
            etapa: `D+${etapaConfig.day}`,
            etapaName: etapaConfig.name,
            total: leads.length,
            processed: results.length + errors.length,
            success: successCount,
            failures: failureCount,
            stats: {
                contactsCreated: contactsCreated,
                contactsFound: contactsFound
            },
            results: [...results, ...errors]
        });

    } catch (error) {
        console.error(`❌ [${requestId}] Error general en onboarding:`, error);
        if (error.response?.data) {
            console.error(`📋 [${requestId}] Detalles del error:`, JSON.stringify(error.response.data, null, 2));
        }
        return res.status(500).json({ 
            error: error.message || 'Error interno del servidor',
            requestId: requestId
        });
    }
};

export default onboarding;
import { normalizePhone } from '../utils/phone.utils.js';
import { normalizeEmail, generateEmailFromPhone } from '../utils/email.utils.js';
import dotenv from 'dotenv';

dotenv.config();

// Obtener campos personalizados habilitados desde .env
const enabledCustomFields = process.env.RDSTATION_CUSTOM_FIELDS 
    ? process.env.RDSTATION_CUSTOM_FIELDS.split(',').map(f => f.trim())
    : ['cf_tiene_ichef']; // Solo cf_tiene_ichef por defecto

/**
 * Verifica si un campo personalizado está habilitado
 */
function isCustomFieldEnabled(fieldName) {
    return enabledCustomFields.includes(fieldName);
}

/**
 * Normaliza valores booleanos de Chatwoot a formato RD Station
 * Chatwoot puede usar "SI"/"NO" pero RD Station espera "Sí"/"No"
 */
function normalizeBooleanValue(value) {
    if (!value) return 'No';
    const normalized = value.toString().toUpperCase();
    return (normalized === 'SI' || normalized === 'SÍ' || normalized === 'YES' || normalized === 'TRUE') ? 'Sí' : 'No';
}

/**
 * Mapea un contacto de RD Station a formato Chatwoot
 * 
 * @param {Object} rdContact - Contacto desde RD Station
 * @returns {Object} - Contacto en formato Chatwoot
 */
export function mapContactRDToChatwoot(rdContact) {
    const chatwootContact = {
        name: rdContact.name || '',
        email: rdContact.email || '',
        phone_number: rdContact.mobile_phone ? normalizePhone(rdContact.mobile_phone) : null,
        
        custom_attributes: {
            // Campos estándar
            firstname: rdContact.name?.split(' ')[0] || '',
            lastname: rdContact.name?.split(' ').slice(1).join(' ') || '',
            company: rdContact.company || '',
            position: rdContact.job_title || '',
            city: rdContact.city || '',
            state: rdContact.state || '',
            country: rdContact.country || 'UY',
            
            // Campos personalizados de RD Station (cf_*)
            tiene_ichef: rdContact.cf_tiene_ichef || 'No',
            id_equipo: rdContact.cf_id_equipo || '',
            nickname: rdContact.cf_nickname || '',
            experiencia: rdContact.cf_experiencia || '',
            gusta_cocinar: rdContact.cf_gusta_cocinar || '',
            es_cliente: rdContact.cf_es_cliente || 'No',
            
            // Metadata
            rd_station_uuid: rdContact.uuid || '',
            stage: mapRDStageToInternal(rdContact.lifecycle_stage),
            score: rdContact.lead_score || 0,
            
            // Timestamp de sincronización
            last_sync_from_rd: new Date().toISOString()
        }
    };

    return chatwootContact;
}

/**
 * Mapea un contacto de Chatwoot a formato RD Station
 * 
 * @param {Object} chatwootContact - Contacto desde Chatwoot
 * @returns {Object} - Contacto en formato RD Station
 */
export function mapContactChatwootToRD(chatwootContact) {
    const attrs = chatwootContact.custom_attributes || {};
    
    // Normalizar email (puede venir como null, 'null', undefined o vacío)
    const email = chatwootContact.email && chatwootContact.email !== 'null' && chatwootContact.email.trim() !== ''
        ? chatwootContact.email.trim()
        : generateEmailFromPhone(chatwootContact.phone_number);
    
    // Nombre es obligatorio en RD Station
    const name = chatwootContact.name && chatwootContact.name.trim() !== ''
        ? chatwootContact.name.trim()
        : 'Contacto sin nombre';
    
    const rdContact = {
        name: name,
        email: email,
        
        // Teléfono: solo dígitos para RD Station
        mobile_phone: chatwootContact.phone_number 
            ? chatwootContact.phone_number.replace(/\D/g, '') 
            : '',
        
        // Campos estándar (solo si tienen valor)
        ...(attrs.company && { company: attrs.company }),
        ...(attrs.position && { job_title: attrs.position }),
        ...(attrs.city && { city: attrs.city }),
        ...(attrs.state && { state: attrs.state }),
        country: attrs.country || 'UY',
        ...(attrs.website && { website: attrs.website }),
        ...(attrs.language && { language: attrs.language }),
        ...(attrs.linkedin && { linkedin: attrs.linkedin }),
        ...(attrs.twitter && { twitter: attrs.twitter }),
        ...(attrs.facebook && { facebook: attrs.facebook }),
        ...(attrs.instagram && { instagram: attrs.instagram }),
        
        // Campos personalizados (cf_*) - solo enviar si están habilitados
        ...(isCustomFieldEnabled('cf_tiene_ichef') && { cf_tiene_ichef: normalizeBooleanValue(attrs.tiene_ichef) }),
        ...(isCustomFieldEnabled('cf_es_cliente') && { cf_es_cliente: normalizeBooleanValue(attrs.es_cliente) }),
        ...(isCustomFieldEnabled('cf_id_equipo') && attrs.id_equipo && { cf_id_equipo: attrs.id_equipo }),
        ...(isCustomFieldEnabled('cf_chatwoot_id') && { cf_chatwoot_id: chatwootContact.id?.toString() || '' }),
        ...(isCustomFieldEnabled('cf_last_sync_from_chatwoot') && { cf_last_sync_from_chatwoot: new Date().toISOString() }),
        
        // Dirección y ubicación
        ...(isCustomFieldEnabled('cf_address1') && attrs.address && { cf_address1: attrs.address }),
        ...(isCustomFieldEnabled('cf_address2') && attrs.address2 && { cf_address2: attrs.address2 }),
        ...(isCustomFieldEnabled('numero_puerta') && attrs.numero_puerta && { numero_puerta: attrs.numero_puerta }),
        ...(isCustomFieldEnabled('zip') && attrs.zip && { zip: attrs.zip }),
        
        // Identificación
        ...(isCustomFieldEnabled('cf_cedula') && attrs.cedula && { cf_cedula: attrs.cedula }),
        ...(isCustomFieldEnabled('rut') && attrs.rut && { rut: attrs.rut }),
        
        // Comentarios
        ...(isCustomFieldEnabled('cf_comments') && attrs.comments && { cf_comments: attrs.comments }),
        ...(isCustomFieldEnabled('cf_client_comments') && attrs.client_comments && { cf_client_comments: attrs.client_comments }),
        
        // Categoría y clasificación
        ...(isCustomFieldEnabled('cf_categoria_contacto') && attrs.categoria_contacto && { cf_categoria_contacto: attrs.categoria_contacto }),
        ...(isCustomFieldEnabled('status_contacto') && attrs.status_contacto && { status_contacto: attrs.status_contacto }),
        ...(isCustomFieldEnabled('stage') && attrs.stage && { stage: mapInternalStageToRD(attrs.stage) }),
        
        // Referidos
        ...(isCustomFieldEnabled('referido_por') && attrs.referido_por && { referido_por: attrs.referido_por }),
        ...(isCustomFieldEnabled('referente') && attrs.referente && { referente: attrs.referente }),
        ...(isCustomFieldEnabled('referidos') && attrs.referidos && { referidos: attrs.referidos }),
        
        // Demo y eventos
        ...(isCustomFieldEnabled('cf_demo_fecha_hora') && attrs.demo_fecha_hora && { cf_demo_fecha_hora: attrs.demo_fecha_hora }),
        ...(isCustomFieldEnabled('fuente_contacto') && attrs.fuente_contacto && { fuente_contacto: attrs.fuente_contacto }),
        
        // Cupón y pago
        ...(isCustomFieldEnabled('cf_cupon_url') && attrs.cupon_url && { cf_cupon_url: attrs.cupon_url }),
        ...(isCustomFieldEnabled('envia_cupon_despues') && attrs.envia_cupon_despues && { envia_cupon_despues: attrs.envia_cupon_despues }),
        ...(isCustomFieldEnabled('forma_pago') && attrs.forma_pago && { forma_pago: attrs.forma_pago }),
        
        // Uso y acceso
        ...(isCustomFieldEnabled('uso') && attrs.uso && { uso: attrs.uso }),
        ...(isCustomFieldEnabled('cf_enc_acesso_ichef') && attrs.enc_acesso_ichef && { cf_enc_acesso_ichef: attrs.enc_acesso_ichef }),
        ...(isCustomFieldEnabled('version_firmware') && attrs.version_firmware && { version_firmware: attrs.version_firmware }),
        
        // SDR
        ...(isCustomFieldEnabled('estado_sdr') && attrs.estado_sdr && { estado_sdr: attrs.estado_sdr }),
        
        // Encuestas - Experiencia y hábitos
        ...(isCustomFieldEnabled('enc_experiencia') && attrs.enc_experiencia && { enc_experiencia: attrs.enc_experiencia }),
        ...(isCustomFieldEnabled('enc_gusta_cocinar') && attrs.enc_gusta_cocinar && { enc_gusta_cocinar: attrs.enc_gusta_cocinar }),
        ...(isCustomFieldEnabled('enc_frecuencia_cocina') && attrs.enc_frecuencia_cocina && { enc_frecuencia_cocina: attrs.enc_frecuencia_cocina }),
        ...(isCustomFieldEnabled('enc_cantidad_personas_Cocina') && attrs.enc_cantidad_personas_cocina && { enc_cantidad_personas_Cocina: attrs.enc_cantidad_personas_cocina }),
        ...(isCustomFieldEnabled('enc_quien_cocina_casa') && attrs.enc_quien_cocina_casa && { enc_quien_cocina_casa: attrs.enc_quien_cocina_casa }),
        
        // Encuestas - Preferencias alimenticias
        ...(isCustomFieldEnabled('enc_condicion_alimenticia') && attrs.enc_condicion_alimenticia && { enc_condicion_alimenticia: attrs.enc_condicion_alimenticia }),
        ...(isCustomFieldEnabled('enc_gustos_alimenticios') && attrs.enc_gustos_alimenticios && { enc_gustos_alimenticios: attrs.enc_gustos_alimenticios }),
        
        // Encuestas - Desafíos y motivaciones
        ...(isCustomFieldEnabled('enc_mayor_desafio') && attrs.enc_mayor_desafio && { enc_mayor_desafio: attrs.enc_mayor_desafio }),
        ...(isCustomFieldEnabled('enc_via_se_entero_ichef') && attrs.enc_via_se_entero_ichef && { enc_via_se_entero_ichef: attrs.enc_via_se_entero_ichef }),
        
        // Encuestas - Familia y contexto
        ...(isCustomFieldEnabled('enc_nucleo_familiar') && attrs.enc_nucleo_familiar && { enc_nucleo_familiar: attrs.enc_nucleo_familiar }),
        ...(isCustomFieldEnabled('enc_profesional') && attrs.enc_profesional && { enc_profesional: attrs.enc_profesional }),
        
        // Encuestas - Onboarding y feedback
        ...(isCustomFieldEnabled('enc_onb_ayudarte') && attrs.enc_onb_ayudarte && { enc_onb_ayudarte: attrs.enc_onb_ayudarte }),
        ...(isCustomFieldEnabled('enc_onb_experiencia_30_dias') && attrs.enc_onb_experiencia_30_dias && { enc_onb_experiencia_30_dias: attrs.enc_onb_experiencia_30_dias }),
        ...(isCustomFieldEnabled('enc_onb_experiencia_ichef') && attrs.enc_onb_experiencia_ichef && { enc_onb_experiencia_ichef: attrs.enc_onb_experiencia_ichef }),
        ...(isCustomFieldEnabled('enc_onb_mas_te_gusto') && attrs.enc_onb_mas_te_gusto && { enc_onb_mas_te_gusto: attrs.enc_onb_mas_te_gusto }),
        ...(isCustomFieldEnabled('enc_onb_mejorar') && attrs.enc_onb_mejorar && { enc_onb_mejorar: attrs.enc_onb_mejorar }),
        ...(isCustomFieldEnabled('enc_onb_recetas_encantaron') && attrs.enc_onb_recetas_encantaron && { enc_onb_recetas_encantaron: attrs.enc_onb_recetas_encantaron }),
        ...(isCustomFieldEnabled('enc_onb_tres_recetas') && attrs.enc_onb_tres_recetas && { enc_onb_tres_recetas: attrs.enc_onb_tres_recetas }),
        ...(isCustomFieldEnabled('enc_onb_filtros') && attrs.enc_onb_filtros && { enc_onb_filtros: attrs.enc_onb_filtros }),
        ...(isCustomFieldEnabled('enc_onb_categorias_alimentos_portal') && attrs.enc_onb_categorias_alimentos_portal && { enc_onb_categorias_alimentos_portal: attrs.enc_onb_categorias_alimentos_portal }),
        
        // Encuestas - Contenido
        ...(isCustomFieldEnabled('enc_contenido_preferido') && attrs.enc_contenido_preferido && { enc_contenido_preferido: attrs.enc_contenido_preferido }),
        ...(isCustomFieldEnabled('enc_sugerencia_contenido') && attrs.enc_sugerencia_contenido && { enc_sugerencia_contenido: attrs.enc_sugerencia_contenido })
    };

    // Limpiar campos vacíos (excepto name y email que son obligatorios)
    const cleanedData = cleanEmptyFields(rdContact);

    // Eliminar campos que NO existen en RD Station (causan error 400)
    // Estos campos deben crearse primero en la plataforma de RD Station
    const { language: _, lifecycle_stage: __, ...finalData } = cleanedData;

    return finalData;
}

/**
 * Elimina campos con valores vacíos, null o undefined
 * RD Station rechaza payloads con campos vacíos
 * Mantiene siempre los campos críticos: name, email
 * 
 * @param {Object} obj
 * @returns {Object}
 */
function cleanEmptyFields(obj) {
    const cleaned = {};
    const requiredFields = ['name', 'email']; // Campos que siempre deben estar
    
    for (const [key, value] of Object.entries(obj)) {
        // Mantener campos requeridos aunque estén vacíos
        if (requiredFields.includes(key)) {
            cleaned[key] = value || '';
        }
        // Para otros campos, mantener solo si tienen valor
        else if (value !== null && value !== undefined && value !== '') {
            cleaned[key] = value;
        }
    }
    
    return cleaned;
}

/**
 * Mapea la etapa del lifecycle de RD Station a etapas internas
 * 
 * @param {string} rdStage
 * @returns {string}
 */
function mapRDStageToInternal(rdStage) {
    const stageMap = {
        'Lead': 'lead',
        'Qualified Lead': 'mql',
        'Client': 'cliente',
        'Customer': 'cliente',
        'Opportunity': 'oportunidad'
    };
    
    return stageMap[rdStage] || 'lead';
}

/**
 * Mapea etapas internas a lifecycle de RD Station
 * 
 * @param {string} internalStage
 * @returns {string}
 */
export function mapInternalStageToRD(internalStage) {
    const stageMap = {
        'lead': 'Lead',
        'mql': 'Qualified Lead',
        'sql': 'Qualified Lead',
        'oportunidad': 'Opportunity',
        'cliente': 'Customer'
    };
    
    return stageMap[internalStage] || 'Lead';
}

/**
 * Mapea un deal/oportunidad de Chatwoot a RD Station CRM
 * 
 * @param {Object} chatwootDeal
 * @param {Object} contact
 * @returns {Object}
 */
export function mapDealChatwootToRD(chatwootDeal, contact) {
    return {
        deal: {
            name: chatwootDeal.dealName || chatwootDeal.name,
            deal_stage_id: mapDealStageToRD(chatwootDeal.stage),
            amount: chatwootDeal.amount || 0,
            close_date: chatwootDeal.closeDate,
            contact_id: contact.rd_station_uuid || contact.cf_rd_station_uuid
        }
    };
}

/**
 * Mapea etapa de deal a ID de etapa en RD Station
 * 
 * @param {string} stage
 * @returns {string}
 */
function mapDealStageToRD(stage) {
    // Estos IDs deben configurarse según el pipeline de RD Station
    const stageMap = {
        'prospecting': '1',
        'qualification': '2',
        'proposal': '3',
        'negotiation': '4',
        'closed_won': '5',
        'closed_lost': '6'
    };
    
    return stageMap[stage] || '1';
}

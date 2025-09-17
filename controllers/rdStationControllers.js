import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const RD_STATION_CONFIG = {
    API_BASE_URL: process.env.RDSTATION_URL
};

/**
 * Credenciales para autenticación con RD Station API
 */
let credenciales = {
    "client_id": process.env.RD_STATION_CLIENT_ID,
    "client_secret": process.env.RD_STATION_CLIENT_SECRET,
    "access_token": "",
    "refresh_token": process.env.RD_STATION_REFRESH_TOKEN
}

/**
 * Valida si un email tiene un formato válido
 * @param {string} email - Email a validar
 * @returns {boolean} - True si el email es válido, false en caso contrario
 */
const isValidEmail = (email) => {
    return email && email.includes('@') && email.trim() !== '';
};

/**
 * Valida si un número de teléfono es válido (debe contener solo dígitos y tener al menos 7 caracteres)
 * @param {string} phone - Número de teléfono a validar
 * @returns {boolean} - True si el teléfono es válido, false en caso contrario
 */
const isValidPhone = (phone) => {
    if (!phone || phone.trim() === '') return false;

    // Limpiar el teléfono de espacios, guiones y otros caracteres no numéricos excepto +
    const cleanPhone = phone.replace(/[\s\-\(\)\+]/g, '');

    // Verificar que contenga solo dígitos y tenga al menos 7 caracteres (número mínimo válido)
    return /^\d{7,}$/.test(cleanPhone);
};

/**
 * Genera un email ficticio basado en el número de teléfono
 * @param {string} phone - Número de teléfono
 * @returns {string} - Email generado en formato <numero>@email.com
 */
const generateEmailFromPhone = (phone) => {
    const cleanPhone = phone.replace(/\D/g, '');
    return `${cleanPhone}@email.com`;
};

/**
 * Limpia un email removiendo espacios al final y otros caracteres problemáticos
 * @param {string} email - Email a limpiar
 * @returns {string} - Email limpio
 */
const cleanEmail = (email) => {
    if (!email || typeof email !== 'string') return email;
    return email.trim();
};

/**
 * Valida si un valor está dentro de las opciones permitidas para un campo específico de RD Station
 * @param {string} fieldName - Nombre del campo
 * @param {any} value - Valor a validar
 * @returns {boolean} - True si el valor es válido, false si debe omitirse
 */
const validateFieldOptions = (fieldName, value) => {
    if (!value || value === null || value === undefined || value === '' || value === 'N/A') {
        return false;
    }

    // Definir opciones válidas para cada campo problemático según los logs
    const fieldOptions = {
        'cf_enc_gustos_alimenticios': ["dulce", "salado", "ensaladas", "pastas"],
        'cf_enc_quien_cocina_casa': ["padre", "madre", "hijo/a", "abuela", "abuelo", "empleada", "otros"],
        'cf_uso': ["familiar", "restaurante", "hotel", "otros"],
        'cf_enc_condicion_alimenticia': ["ninguna", "diabético", "celiaco", "vegano", "keto", "otro"],
        'cf_enc_contenido_preferido': ["Recetas rápidas y fáciles", "Consejos culinarios", "Historias de iChef Lovers", "Otros"],
        'cf_enc_gusta_cocinar': ["si", "no"],
        'cf_enc_mayor_desafio': ["Creatividad a la hora de pensar una receta", "No tengo muchas habilidades en la cocina", "Tengo muy poco tiempo para cocinar y limpiar después", "Tengo restricciones alimentarias", "Tengo habilidades motoras reducidas"],
        'cf_enc_via_se_entero_ichef': ["amigo", "google", "facebook", "instagram", "youtube", "cine", "prensa", "publicacion"],
        'cf_enc_cantidad_personas_cocina': ["Cocino sólo para 1 persona", "Cocino para 2 personas", "Cocino para más de 3 personas por vez"],
        'cf_enc_acesso_ichef': ["si", "no"],
        'cf_enc_experiencia': ["principiante", "intermedio", "avanzado"],
        'cf_enc_frecuencia_cocina': ["diariamente", "varias veces por semana", "una vez por semana", "ocasionalmente"],
        'cf_enc_profesional': ["si", "no"],
        'cf_enc_forma_pago': ["efectivo", "tarjeta", "transferencia", "otro"],
        'cf_categoria_contacto': ["lead", "cliente", "prospecto", "otro"],
        'cf_enc_sugerencia_contenido': null // Campo de texto libre, no validar opciones
    };

    const validOptions = fieldOptions[fieldName];

    // Si el campo no está en la lista o es texto libre, permitir cualquier valor no vacío
    if (!validOptions) {
        return true;
    }

    // Verificar si el valor está en las opciones válidas
    return validOptions.includes(value);
};

/**
 * Función helper para hacer delay/pausa
 * @param {number} ms - Milisegundos a esperar
 * @returns {Promise} - Promise que se resuelve después del delay
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Configuración para manejo de rate limiting y reintentos
 */
const RETRY_CONFIG = {
    MAX_RETRIES: 5,
    INITIAL_DELAY: 1000, // 1 segundo inicial
    MAX_DELAY: 30000,    // 30 segundos máximo
    BACKOFF_MULTIPLIER: 2,
    RATE_LIMIT_DELAY: 5000 // 5 segundos adicionales para rate limit
};

/**
 * Ejecuta una función con reintentos automáticos y manejo de rate limiting
 * @param {Function} apiCall - Función que hace la llamada a la API
 * @param {string} operationName - Nombre de la operación para logging
 * @param {Object} contactData - Datos del contacto para logging de errores
 * @param {number} retryCount - Contador de reintentos actual
 * @returns {Promise<any>} - Resultado de la operación o throw error si falla completamente
 */
const executeWithRetry = async (apiCall, operationName, contactData = {}, retryCount = 0) => {
    try {
        const result = await apiCall();

        // Si llegamos aquí, la operación fue exitosa
        if (retryCount > 0) {
            console.log(`✅ ${operationName} exitoso después de ${retryCount} reintentos | ID=${contactData.id}`);
        }

        return result;

    } catch (error) {
        const isRateLimit = error.response?.status === 429;
        const isTokenExpired = error.response?.status === 401;
        const isServerError = error.response?.status >= 500;
        const shouldRetry = (isRateLimit || isTokenExpired || isServerError) && retryCount < RETRY_CONFIG.MAX_RETRIES;

        if (!shouldRetry) {
            // Si no podemos reintentar más, loggear el error final
            if (operationName === 'CREATE') {
                logContactError('CREATE', contactData, error, null, {
                    retryCount,
                    finalFailure: true
                });
            }
            throw error;
        }

        // Manejar token expirado con refresh automático
        if (isTokenExpired) {
            console.log(`🔑 Token expirado detectado, intentando refresh... | ID=${contactData.id} | Intento ${retryCount + 1}/${RETRY_CONFIG.MAX_RETRIES}`);
            
            const refreshSuccess = await refreshAccessToken();
            if (!refreshSuccess) {
                console.log(`❌ Fallo al refrescar token en intento ${retryCount + 1} | ID=${contactData.id}`);
                
                // Si es el último intento, no seguir reintentando
                if (retryCount >= RETRY_CONFIG.MAX_RETRIES - 1) {
                    throw new Error('TOKEN_REFRESH_FAILED: No se pudo refrescar el token después de múltiples intentos');
                }
                
                // Esperar más tiempo antes del siguiente intento si falló el refresh
                await delay(RETRY_CONFIG.RATE_LIMIT_DELAY);
            } else {
                console.log(`✅ Token refrescado exitosamente | ID=${contactData.id}`);
                // Reintento inmediato con token renovado
                return executeWithRetry(apiCall, operationName, contactData, retryCount + 1);
            }
        }

        // Calcular delay para el siguiente intento
        let delayMs = Math.min(
            RETRY_CONFIG.INITIAL_DELAY * Math.pow(RETRY_CONFIG.BACKOFF_MULTIPLIER, retryCount),
            RETRY_CONFIG.MAX_DELAY
        );

        // Si es rate limit, agregar delay adicional
        if (isRateLimit) {
            delayMs += RETRY_CONFIG.RATE_LIMIT_DELAY;
            console.log(`⏳ Rate limit detectado, esperando ${delayMs}ms antes del reintento ${retryCount + 1}/${RETRY_CONFIG.MAX_RETRIES} | ID=${contactData.id}`);
        } else if (isServerError) {
            console.log(`🔄 Error servidor ${error.response?.status}, esperando ${delayMs}ms antes del reintento ${retryCount + 1}/${RETRY_CONFIG.MAX_RETRIES} | ID=${contactData.id}`);
        } else {
            console.log(`🔄 Error ${error.response?.status}, esperando ${delayMs}ms antes del reintento ${retryCount + 1}/${RETRY_CONFIG.MAX_RETRIES} | ID=${contactData.id}`);
        }

        await delay(delayMs);

        // Reintento recursivo
        return executeWithRetry(apiCall, operationName, contactData, retryCount + 1);
    }
};

/**
 * Registra únicamente los errores de contactos que NO se pudieron crear
 * @param {string} operation - Tipo de operación ('CREATE', 'VALIDATION_FAILED')
 * @param {Object} contactData - Datos del contacto que causó el error
 * @param {Object} error - Objeto de error capturado
 * @param {string} [contactUuid] - UUID del contacto (solo para actualizaciones)
 * @param {Object} [additionalInfo] - Información adicional sobre el contexto del error
 */
const logContactError = (operation, contactData, error, contactUuid = null, additionalInfo = {}) => {
    try {
        // Solo loggear errores de creación fallida
        if (operation !== 'CREATE' && operation !== 'VALIDATION_FAILED') {
            return; // No loggear errores de UPDATE, SEARCH, etc.
        }

        const timestamp = new Date().toISOString();

        // Información esencial del contacto
        const contactInfo = {
            id: contactData.id || 'N/A',
            firstname: contactData.firstname || 'N/A',
            lastname: contactData.lastname || 'N/A',
            email: contactData.email || 'N/A',
            phone: contactData.phone || contactData.mobile || 'N/A',
            cedula: contactData.cedula || 'N/A'
        };

        // Información del error
        const errorInfo = {
            status: error.response?.status || 'N/A',
            message: error.message || 'Error desconocido',
            data: error.response?.data || 'N/A'
        };

        // Si el error data es HTML, simplificarlo
        if (typeof errorInfo.data === 'string' && errorInfo.data.includes('<!DOCTYPE html>')) {
            errorInfo.data = 'RD Station maintenance/error page';
        }

        // Crear log entry compacto - TODO EN UNA LÍNEA
        const logEntry = {
            timestamp,
            operation,
            contact: contactInfo,
            error: errorInfo,
            retryAttempts: additionalInfo.retryCount || 0,
            finalFailure: additionalInfo.finalFailure !== false // Por defecto true si no se especifica
        };

        // Crear el directorio de logs si no existe - usar ruta relativa robusta
        const currentDir = process.cwd();
        const isInBackendDir = currentDir.endsWith('backend');
        const logsDir = isInBackendDir
            ? path.join(currentDir, 'logs')
            : path.join(currentDir, 'backend', 'logs');

        if (!fs.existsSync(logsDir)) {
            console.log(`📁 Creando directorio de logs: ${logsDir}`);
            fs.mkdirSync(logsDir, { recursive: true });
        }

        // Archivo único para errores de creación fallida
        const logFileName = `rd-station-failed-creates-${new Date().toISOString().split('T')[0]}.log`;
        const logFilePath = path.join(logsDir, logFileName);

        // Escribir UNA LÍNEA por error (JSON compacto)
        const logLine = JSON.stringify(logEntry) + '\n';
        fs.appendFileSync(logFilePath, logLine);

    } catch (logError) {
        console.error('❌ Error al escribir log de contacto:', logError.message);
        // Fallback: al menos mostrar el error en consola
        console.error('Error original del contacto:', {
            id: contactData?.id,
            email: contactData?.email,
            error: error.message
        });
    }
};

/**
 * Refresca el token de acceso cuando ha expirado
 * @returns {Promise<boolean>} - True si el token se refrescó exitosamente, false en caso contrario
 */
const refreshAccessToken = async () => {
    try {
        console.log('🔄 Iniciando refresh del token...');
        
        // Validar que tenemos las credenciales necesarias
        if (!credenciales.client_id || !credenciales.client_secret || !credenciales.refresh_token) {
            console.error('❌ Credenciales incompletas para refresh token');
            return false;
        }

        const refreshResponse = await axios.post(
            'https://api.rd.services/auth/token',
            {
                client_id: credenciales.client_id,
                client_secret: credenciales.client_secret,
                refresh_token: credenciales.refresh_token,
                grant_type: 'refresh_token'
            },
            {
                headers: {
                    'accept': 'application/json',
                    'content-type': 'application/json'
                },
                timeout: 10000 // 10 segundos timeout
            }
        );

        if (refreshResponse.data && refreshResponse.data.access_token) {
            credenciales.access_token = refreshResponse.data.access_token;

            // También actualizamos el refresh_token si viene en la respuesta
            if (refreshResponse.data.refresh_token) {
                credenciales.refresh_token = refreshResponse.data.refresh_token;
            }

            console.log('✅ TOKEN REFRESHED SUCCESSFULLY');
            return true;
        }

        console.error('❌ Respuesta inesperada del servidor al refrescar token:', refreshResponse.data);
        return false;

    } catch (error) {
        const errorStatus = error.response?.status;
        const errorMessage = error.response?.data?.message || error.message;
        
        console.error(`❌ Error al refrescar el token de acceso:`, {
            status: errorStatus,
            message: errorMessage,
            data: error.response?.data
        });

        // Si es error 502, probablemente RD Station tiene problemas temporales
        if (errorStatus === 502) {
            console.error('🚨 RD Station parece tener problemas internos (502). Reintentaremos después.');
        }
        
        // Si es error 400, probablemente el refresh token ha expirado
        if (errorStatus === 400) {
            console.error('🚨 REFRESH TOKEN EXPIRADO - Requiere reautenticación manual');
        }

        return false;
    }
};

/**
 * Verifica si tenemos un token válido y lo refresca si es necesario
 * @returns {Promise<boolean>} - True si tenemos un token válido
 */
const ensureValidToken = async () => {
    // Si no tenemos access token, intentar refrescar
    if (!credenciales.access_token || credenciales.access_token.trim() === '') {
        console.log('🔑 No hay access token, intentando obtener uno...');
        return await refreshAccessToken();
    }
    
    return true;
};

/**
 * Busca un contacto en RD Station por email con reintentos automáticos
 * @param {string} email - Email del contacto a buscar
 * @param {Object} contactData - Datos del contacto para logging (opcional)
 * @returns {Promise<Object|null>} - Datos del contacto si existe, null si no existe
 */
const findContactByEmail = async (email, contactData = {}) => {
    // Verificar que tenemos un token válido antes de hacer la llamada
    const hasValidToken = await ensureValidToken();
    if (!hasValidToken) {
        throw new Error('TOKEN_UNAVAILABLE');
    }

    const apiCall = async () => {
        const response = await axios.get(`${RD_STATION_CONFIG.API_BASE_URL}/platform/contacts/email:${encodeURIComponent(email)}`, {
            headers: {
                'Authorization': `Bearer ${credenciales.access_token}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000 // 15 segundos timeout
        });
        return response.data.uuid ? response.data : null;
    };

    try {
        return await executeWithRetry(apiCall, 'SEARCH', contactData);
    } catch (error) {
        // Si es 404, significa que el contacto no existe
        if (error.response && error.response.status === 404) {
            return null;
        }

        // Si es error 401, el token probablemente expiró
        if (error.response && error.response.status === 401) {
            throw new Error('TOKEN_EXPIRED');
        }

        console.error('Error en findContactByEmail:', {
            status: error.response?.status,
            message: error.message
        });

        throw error;
    }
};

/**
 * Crea un nuevo contacto en RD Station con reintentos automáticos
 * @param {Object} contactData - Datos del contacto a crear
 * @returns {Promise<boolean>} - True si el contacto se creó exitosamente, false en caso contrario
 */
const createContact = async (contactData) => {
    // Función auxiliar para convertir strings booleanos específicos
    const parseBoolean = (value) => {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true';
        }
        return false;
    };

    // Función auxiliar para convertir strings a números
    const parseNumber = (value) => {
        if (typeof value === 'number') return value;
        if (typeof value === 'string') {
            const num = parseInt(value, 10);
            return isNaN(num) ? 0 : num;
        }
        return 0;
    };

    // Determinar qué teléfono usar (phone o mobile)
    const phoneToUse = contactData.phone || contactData.mobile;

    const apiCall = async () => {
        // Crear payload base
        const payload = {
            "cf_id_inconcert": contactData.id,
            "name": contactData.firstname + ' ' + contactData.lastname,
            "cf_lastname": contactData.lastname,
            "email": cleanEmail(contactData.email),
            "personal_phone": phoneToUse,
            "cf_nickname": contactData.nickname,
            "cf_cedula": contactData.cedula,
            "mobile_phone": phoneToUse,
            "cf_language": contactData.language,
            "cf_position": contactData.position,
            "cf_rut": contactData.rut,
            "cf_address1": contactData.address1,
            "cf_address2": contactData.address2,
            "cf_numero_puerta": contactData.numero_puerta,
            "city": contactData.city,
            "state": contactData.state,
            "cf_zip": contactData.zip,
            "country": contactData.country,
            "cf_demo_fecha_hora": contactData.Demo_Fecha_Hora,
            "cf_direccion_demo": contactData.direccion_demo,
            "facebook": contactData.facebook,
            "cf_instagram": contactData.instagram,
            "linkedin": contactData.linkedin,
            "twitter": contactData.twitter,
            "website": contactData.website,
            "cf_stage": contactData.stage,
            "cf_owner": contactData.owner,
            "cf_owner_name": contactData.ownerName,
            "cf_id_equipo": contactData.id_equipo,
            "cf_importado_px": parseBoolean(contactData.importado_px),
            "cf_cupon_url": contactData.cupon_url,
            "cf_envia_cupon_despues": parseBoolean(contactData.envia_cupon_despues),
            "cf_estado_sdr": contactData.estado_sdr,
            "cf_foreign_document": parseBoolean(contactData.foreignDocument),
            "cf_participo_sdr": contactData.participo_SDR,
            "cf_referente": parseBoolean(contactData.referente),
            "cf_token_invitado": contactData.token_invitado,
            "cf_fuente_contacto": contactData.fuente_contacto,
            "cf_status_contacto": contactData.status_contacto,
            "cf_client_comments": contactData.clientComments,
            "cf_comments": contactData.comments,
            "cf_custom_data": contactData.customData,
            "cf_membership": contactData.membership,
            "cf_referredatcampaignid": contactData.referredAtCampaignId,
            "cf_referredatinteractionid": contactData.referredAtInteractionId,
            "cf_referredbycontactid": contactData.referredByContactId,
            "cf_referreddate": contactData.referredDate,
            "cf_createdbycampaignid": contactData.createdByCampaignId,
            "cf_createdbyuserid": contactData.createdByUserId,
            "cf_createddate": contactData.createdDate
        };

        // Validar y agregar campos problemáticos solo si son válidos
        if (validateFieldOptions('cf_enc_gustos_alimenticios', contactData.gustos_alimenticios)) {
            payload["cf_enc_gustos_alimenticios"] = contactData.gustos_alimenticios;
        }

        if (validateFieldOptions('cf_enc_quien_cocina_casa', contactData.quien_cocina_casa)) {
            payload["cf_enc_quien_cocina_casa"] = contactData.quien_cocina_casa;
        }

        if (validateFieldOptions('cf_uso', contactData.uso)) {
            payload["cf_uso"] = contactData.uso;
        }

        if (validateFieldOptions('cf_enc_condicion_alimenticia', contactData.condicion_alimenticia)) {
            payload["cf_enc_condicion_alimenticia"] = contactData.condicion_alimenticia;
        }

        if (validateFieldOptions('cf_enc_contenido_preferido', contactData.contenido_preferido)) {
            payload["cf_enc_contenido_preferido"] = contactData.contenido_preferido;
        }

        if (validateFieldOptions('cf_enc_gusta_cocinar', contactData.gusta_cocinar)) {
            payload["cf_enc_gusta_cocinar"] = contactData.gusta_cocinar;
        }

        if (validateFieldOptions('cf_enc_mayor_desafio', contactData.mayor_desafio)) {
            payload["cf_enc_mayor_desafio"] = contactData.mayor_desafio;
        }

        if (validateFieldOptions('cf_enc_via_se_entero_ichef', contactData.via_se_entero_ichef)) {
            payload["cf_enc_via_se_entero_ichef"] = contactData.via_se_entero_ichef;
        }

        // Validar tiene_ichef con valor por defecto
        const tieneIchef = contactData.tiene_ichef;
        if (!tieneIchef || tieneIchef === null || tieneIchef === undefined || tieneIchef === '' || tieneIchef === 'N/A') {
            payload["cf_tiene_ichef"] = 'No';
        } else if (tieneIchef === 'Sí' || tieneIchef === 'No') {
            payload["cf_tiene_ichef"] = tieneIchef;
        } else {
            payload["cf_tiene_ichef"] = 'No';
        }

        if (validateFieldOptions('cf_enc_cantidad_personas_cocina', contactData.cantidad_personas_Cocina)) {
            payload["cf_enc_cantidad_personas_cocina"] = contactData.cantidad_personas_Cocina;
        }

        if (validateFieldOptions('cf_enc_acesso_ichef', contactData.acesso_ichef)) {
            payload["cf_enc_acesso_ichef"] = contactData.acesso_ichef;
        }

        if (validateFieldOptions('cf_enc_experiencia', contactData.experiencia)) {
            payload["cf_enc_experiencia"] = contactData.experiencia;
        }

        if (validateFieldOptions('cf_enc_frecuencia_cocina', contactData.frecuencia_Cocina)) {
            payload["cf_enc_frecuencia_cocina"] = contactData.frecuencia_Cocina;
        }

        if (validateFieldOptions('cf_enc_profesional', contactData.profesional)) {
            payload["cf_enc_profesional"] = contactData.profesional;
        }

        if (validateFieldOptions('cf_enc_forma_pago', contactData.forma_pago)) {
            payload["cf_enc_forma_pago"] = contactData.forma_pago;
        }

        if (validateFieldOptions('cf_categoria_contacto', contactData.categiria_contacto)) {
            payload["cf_categoria_contacto"] = contactData.categiria_contacto;
        }

        // Agregar número de núcleo familiar solo si es válido
        const nucleoFamiliar = parseNumber(contactData.nucleo_familiar);
        if (nucleoFamiliar > 0) {
            payload["cf_enc_nucleo_familiar"] = nucleoFamiliar;
        }

        // Agregar sugerencia de contenido solo si no está vacía
        const sugerenciaContenido = contactData.sugerencia_contenido;
        if (sugerenciaContenido && sugerenciaContenido !== 'N/A' && sugerenciaContenido.trim() !== '') {
            payload["cf_enc_sugerencia_contenido"] = sugerenciaContenido;
        }

        const response = await axios.post(
            `${RD_STATION_CONFIG.API_BASE_URL}/platform/contacts`,
            payload,
            {
                headers: {
                    'Authorization': `Bearer ${credenciales.access_token}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return response.data;
    };

    try {
        await executeWithRetry(apiCall, 'CREATE', contactData);
        return true;
    } catch (error) {
        // El error ya fue loggeado en executeWithRetry si fue necesario
        return false;
    }
};

/**
 * Actualiza un contacto existente en RD Station con reintentos automáticos
 * @param {string} contactUuid - UUID del contacto en RD Station
 * @param {Object} contactData - Datos del contacto a actualizar
 * @returns {Promise<boolean>} - True si el contacto se actualizó exitosamente, false en caso contrario
 */
const updateContact = async (contactUuid, contactData) => {
    // Función auxiliar para convertir strings booleanos específicos
    const parseBoolean = (value) => {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true';
        }
        return false;
    };

    // Función auxiliar para convertir strings a números
    const parseNumber = (value) => {
        if (typeof value === 'number') return value;
        if (typeof value === 'string') {
            const num = parseInt(value, 10);
            return isNaN(num) ? 0 : num;
        }
        return 0;
    };

    // Función auxiliar para validar cf_tiene_ichef
    const validateTieneIchef = (value) => {
        if (!value || value === null || value === undefined || value === '' || value === 'N/A') {
            return 'No';
        }
        return value;
    };

    // Determinar qué teléfono usar (phone o mobile)
    const phoneToUse = contactData.phone || contactData.mobile;

    // Limpiar email si está presente
    const cleanedEmail = contactData.email ? cleanEmail(contactData.email) : contactData.email;

    const apiCall = async () => {
        // Construir objeto de datos básicos
        const updateData = {
            "cf_id_inconcert": contactData.id,
            "name": contactData.firstname + ' ' + contactData.lastname,
            "cf_lastname": contactData.lastname,
            "personal_phone": phoneToUse,
            "cf_nickname": contactData.nickname,
            "cf_cedula": contactData.cedula,
            "mobile_phone": phoneToUse,
            "cf_language": contactData.language,
            "cf_position": contactData.position,
            "cf_rut": contactData.rut,
            "cf_address1": contactData.address1,
            "cf_address2": contactData.address2,
            "cf_numero_puerta": contactData.numero_puerta,
            "city": contactData.city,
            "state": contactData.state,
            "cf_zip": contactData.zip,
            "country": contactData.country,
            "cf_demo_fecha_hora": contactData.Demo_Fecha_Hora,
            "cf_direccion_demo": contactData.direccion_demo,
            "facebook": contactData.facebook,
            "cf_instagram": contactData.instagram,
            "linkedin": contactData.linkedin,
            "twitter": contactData.twitter,
            "website": contactData.website,
            "cf_stage": contactData.stage,
            "cf_owner": contactData.owner,
            "cf_owner_name": contactData.ownerName,
            "cf_id_equipo": contactData.id_equipo,
            "cf_importado_px": parseBoolean(contactData.importado_px),
            "cf_cupon_url": contactData.cupon_url,
            "cf_envia_cupon_despues": parseBoolean(contactData.envia_cupon_despues),
            "cf_estado_sdr": contactData.estado_sdr,
            "cf_foreign_document": parseBoolean(contactData.foreignDocument),
            "cf_participo_sdr": contactData.participo_SDR,
            "cf_referente": parseBoolean(contactData.referente),
            "cf_tiene_ichef": validateTieneIchef(contactData.tiene_ichef),
            "cf_token_invitado": contactData.token_invitado,
            "cf_fuente_contacto": contactData.fuente_contacto,
            "cf_status_contacto": contactData.status_contacto,
            "cf_uso": contactData.uso,
            "cf_categoria_contacto": contactData.categiria_contacto,
            "cf_client_comments": contactData.clientComments,
            "cf_comments": contactData.comments,
            "cf_custom_data": contactData.customData,
            "cf_membership": contactData.membership,
            "cf_enc_nucleo_familiar": parseNumber(contactData.nucleo_familiar),
            "cf_referredatcampaignid": contactData.referredAtCampaignId,
            "cf_referredatinteractionid": contactData.referredAtInteractionId,
            "cf_referredbycontactid": contactData.referredByContactId,
            "cf_referreddate": contactData.referredDate,
            "cf_createdbycampaignid": contactData.createdByCampaignId,
            "cf_createdbyuserid": contactData.createdByUserId,
            "cf_createddate": contactData.createdDate
        };

        // Agregar email solo si es válido
        if (cleanedEmail && cleanedEmail.includes('@') && cleanedEmail.includes('.')) {
            updateData.email = cleanedEmail;
        }

        // Validar y agregar campos con opciones específicas solo si son válidos
        if (validateFieldOptions('cf_enc_forma_pago', contactData.forma_pago)) {
            updateData.cf_enc_forma_pago = contactData.forma_pago;
        }

        if (validateFieldOptions('cf_enc_acesso_ichef', contactData.acesso_ichef)) {
            updateData.cf_enc_acesso_ichef = contactData.acesso_ichef;
        }

        if (validateFieldOptions('cf_enc_cantidad_personas_cocina', contactData.cantidad_personas_Cocina)) {
            updateData.cf_enc_cantidad_personas_cocina = contactData.cantidad_personas_Cocina;
        }

        if (validateFieldOptions('cf_enc_condicion_alimenticia', contactData.condicion_alimenticia)) {
            updateData.cf_enc_condicion_alimenticia = contactData.condicion_alimenticia;
        }

        if (validateFieldOptions('cf_enc_contenido_preferido', contactData.contenido_preferido)) {
            updateData.cf_enc_contenido_preferido = contactData.contenido_preferido;
        }

        if (validateFieldOptions('cf_enc_experiencia', contactData.experiencia)) {
            updateData.cf_enc_experiencia = contactData.experiencia;
        }

        if (validateFieldOptions('cf_enc_frecuencia_cocina', contactData.frecuencia_Cocina)) {
            updateData.cf_enc_frecuencia_cocina = contactData.frecuencia_Cocina;
        }

        if (validateFieldOptions('cf_enc_gusta_cocinar', contactData.gusta_cocinar)) {
            updateData.cf_enc_gusta_cocinar = contactData.gusta_cocinar;
        }

        if (validateFieldOptions('cf_enc_gustos_alimenticios', contactData.gustos_alimenticios)) {
            updateData.cf_enc_gustos_alimenticios = contactData.gustos_alimenticios;
        }

        if (validateFieldOptions('cf_enc_mayor_desafio', contactData.mayor_desafio)) {
            updateData.cf_enc_mayor_desafio = contactData.mayor_desafio;
        }

        if (validateFieldOptions('cf_enc_profesional', contactData.profesional)) {
            updateData.cf_enc_profesional = contactData.profesional;
        }

        if (validateFieldOptions('cf_enc_sugerencia_contenido', contactData.sugerencia_contenido)) {
            updateData.cf_enc_sugerencia_contenido = contactData.sugerencia_contenido;
        }

        if (validateFieldOptions('cf_enc_via_se_entero_ichef', contactData.via_se_entero_ichef)) {
            updateData.cf_enc_via_se_entero_ichef = contactData.via_se_entero_ichef;
        }

        if (validateFieldOptions('cf_enc_quien_cocina_casa', contactData.quien_cocina_casa)) {
            updateData.cf_enc_quien_cocina_casa = contactData.quien_cocina_casa;
        }

        const response = await axios.patch(
            `${RD_STATION_CONFIG.API_BASE_URL}/platform/contacts/uuid:${contactUuid}`,
            updateData,
            {
                headers: {
                    'Authorization': `Bearer ${credenciales.access_token}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return response.data;
    };

    try {
        await executeWithRetry(apiCall, 'UPDATE', contactData);
        return true;
    } catch (error) {
        console.log(`❌ Error al actualizar contacto | ID=${contactData?.id} | ${error.message}`);
        return false;
    }
};

/**
 * Importa contactos a RD Station desde Inconcert
 * Valida la información del contacto, verifica si ya existe en RD Station
 * y lo crea si no existe. Maneja automáticamente la renovación de tokens.
 * 
 * @async
 * @function importarContactos
 * @param {Object} req - Objeto de solicitud de Express
 * @param {Object} req.body - Cuerpo de la solicitud
 * @param {Object} req.body.contact - Datos del contacto a importar
 * @param {string} [req.body.contact.email] - Email del contacto
 * @param {string} [req.body.contact.phone] - Teléfono del contacto
 * @param {Object} res - Objeto de respuesta de Express
 * @returns {Promise<Object>} Respuesta JSON con el resultado de la operación
 * 
 * @throws {400} - Si el contacto no tiene email ni teléfono válido
 * @throws {500} - Si ocurre un error interno del servidor
 */
const importarContactos = async (req, res) => {
    try {
        const contactoImportar = req.body;

        // Validar estructura del objeto de entrada
        if (!contactoImportar || !contactoImportar.contact) {
            console.log(`❌ ERROR: Estructura inválida`);
            return res.status(400).json({
                success: false,
                statusCode: 400,
                error: 'Estructura de datos inválida. Se requiere el objeto "contact".',
                details: 'El request debe contener un objeto con la estructura: { "contact": { ... } }'
            });
        }

        const { contact } = contactoImportar;

        // Log mínimo de contacto recibido
        const contactInfo = {
            id: contact?.id || 'N/A',
            nombre: contact?.firstname || 'N/A',
            apellido: contact?.lastname || 'N/A',
            email: contact?.email || 'vacío',
            telefono: contact?.phone || contact?.mobile || 'N/A'
        };
        console.log(`📩 Recibido: ID=${contactInfo.id} | ${contactInfo.nombre} ${contactInfo.apellido} | ${contactInfo.email} | ${contactInfo.telefono}`);

        // Validar y procesar email/teléfono
        if (!isValidEmail(contact.email)) {
            // Verificar teléfono principal o móvil
            const phoneToValidate = contact.phone || contact.mobile;
            if (!isValidPhone(phoneToValidate)) {
                // Crear un error simulado para el logging
                const validationError = {
                    response: {
                        status: 400,
                        statusText: 'Bad Request',
                        data: {
                            message: 'Contacto sin email válido ni teléfono válido',
                            validation_details: {
                                email: contact.email || 'vacío',
                                phone: contact.phone || 'null',
                                mobile: contact.mobile || 'null'
                            }
                        }
                    },
                    message: 'Validación fallida: El contacto debe tener un email válido o un número de teléfono válido'
                };

                // Registrar el error de validación en el log
                logContactError('VALIDATION_FAILED', contact, validationError);
                console.log(`❌ VALIDACIÓN FALLIDA: ID=${contactInfo.id} | Sin email ni teléfono válido`);

                return res.status(400).json({
                    success: false,
                    statusCode: 400,
                    error: 'El contacto debe tener un email válido o un número de teléfono válido (mínimo 7 dígitos).',
                    contact: {
                        id: contactInfo.id,
                        email: contact.email || 'vacío',
                        phone: contact.phone || 'null',
                        mobile: contact.mobile || 'null'
                    }
                });
            }
            // Generar email ficticio basado en el número de teléfono disponible
            contact.email = generateEmailFromPhone(phoneToValidate);
            console.log(`🔄 Email generado: ID=${contactInfo.id} | ${contact.email}`);
        }

        // Buscar el contacto en RD Station
        let existingContact = null;
        let tokenRefreshed = false;

        try {
            existingContact = await findContactByEmail(contact.email, contact);
        } catch (error) {
            if (error.message === 'TOKEN_EXPIRED' && !tokenRefreshed) {
                console.log(`🔄 Token expirado, refrescando... | ID=${contactInfo.id}`);

                const refreshSuccess = await refreshAccessToken();
                if (!refreshSuccess) {
                    console.log(`❌ ERROR: No se pudo refrescar token | ID=${contactInfo.id}`);
                    return res.status(401).json({
                        success: false,
                        statusCode: 401,
                        error: 'No se pudo refrescar el token de acceso.',
                        details: 'Token expirado y no se pudo renovar. Verificar credenciales.'
                    });
                }

                tokenRefreshed = true;

                // Reintentar búsqueda con token renovado
                try {
                    existingContact = await findContactByEmail(contact.email, contact);
                } catch (retryError) {
                    console.log(`❌ ERROR: Segundo intento fallido | ID=${contactInfo.id} | ${retryError.message}`);
                    return res.status(500).json({
                        success: false,
                        statusCode: 500,
                        error: 'Error al verificar existencia del contacto en RD Station después de refrescar token.',
                        details: process.env.NODE_ENV === 'development' ? retryError.message : undefined
                    });
                }
            } else {
                console.log(`❌ ERROR: Búsqueda fallida | ID=${contactInfo.id} | ${error.message}`);
                return res.status(500).json({
                    success: false,
                    statusCode: 500,
                    error: 'Error al buscar contacto en RD Station.',
                    details: process.env.NODE_ENV === 'development' ? error.message : undefined
                });
            }
        }

        // Si el contacto ya existe, actualizarlo
        if (existingContact) {
            const updateSuccess = await updateContact(existingContact.uuid, contact);
            if (!updateSuccess) {
                console.log(`❌ ERROR ACTUALIZACIÓN: ID=${contactInfo.id} | ${contactInfo.email}`);
                return res.status(500).json({
                    success: false,
                    action: 'UPDATE',
                    statusCode: 500,
                    error: 'Error al actualizar el contacto en RD Station.',
                    contact: {
                        id: contactInfo.id,
                        email: contact.email,
                        uuid: existingContact.uuid
                    }
                });
            }

            console.log(`✅ ACTUALIZADO: ID=${contactInfo.id} | ${contactInfo.email} | UUID=${existingContact.uuid}`);
            return res.status(200).json({
                success: true,
                action: 'UPDATE',
                statusCode: 200,
                message: 'Contacto actualizado exitosamente en RD Station.',
                contact: {
                    id: contactInfo.id,
                    email: contact.email,
                    uuid: existingContact.uuid
                },
                tokenRefreshed: tokenRefreshed
            });
        }

        // Si no existe, crear nuevo contacto
        const createSuccess = await createContact(contact);
        if (!createSuccess) {
            console.log(`❌ ERROR CREACIÓN: ID=${contactInfo.id} | ${contactInfo.email}`);
            return res.status(500).json({
                success: false,
                action: 'CREATE',
                statusCode: 500,
                error: 'Error al crear el contacto en RD Station.',
                contact: {
                    id: contactInfo.id,
                    email: contact.email
                }
            });
        }

        console.log(`✅ CREADO: ID=${contactInfo.id} | ${contactInfo.email}`);
        return res.status(201).json({
            success: true,
            action: 'CREATE',
            statusCode: 201,
            message: 'Contacto creado exitosamente en RD Station.',
            contact: {
                id: contactInfo.id,
                email: contact.email
            },
            tokenRefreshed: tokenRefreshed
        });

    } catch (error) {
        console.error('Error inesperado en importarContactos:', error);
        return res.status(500).json({
            success: false,
            statusCode: 500,
            error: 'Error interno del servidor.',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};


const actualizarContacto = async (req, res) => {
    try {
        // Actualiza un contacto cuando se actualiza en inconcert
        const contacto = req.body.eventData || req.body;
        const datosPersonalizados = contacto.customData;
        const custom_data = JSON.parse(datosPersonalizados || '{}');

        console.log('Actualizar un Contacto', contacto);
        console.log('Custom Data', custom_data);

        // Función auxiliar para convertir strings booleanos específicos
        const parseBoolean = (value) => {
            if (typeof value === 'boolean') return value;
            if (typeof value === 'string') {
                return value.toLowerCase() === 'true';
            }
            return false;
        };

        // Función auxiliar para convertir strings a números
        const parseNumber = (value) => {
            if (typeof value === 'number') return value;
            if (typeof value === 'string') {
                const num = parseInt(value, 10);
                return isNaN(num) ? 0 : num;
            }
            return 0;
        };

        // Función auxiliar para validar cf_tiene_ichef
        const validateTieneIchef = (value) => {
            if (!value || value === null || value === undefined || value === '' || value === 'N/A') {
                return 'No';
            }
            return value;
        };

        // Buscamos el contacto por email en RD Station si tiene email, sino lo construimos con el teléfono
        const email = contacto.email || generateEmailFromPhone(contacto.phone || contacto.mobile);
        if (!email || !isValidEmail(email)) {
            console.log(`❌ ERROR: Contacto sin email válido | ID=${contacto.id}`);
            return res.status(400).json({
                success: false,
                statusCode: 400,
                error: 'El contacto debe tener un email válido o un número de teléfono válido (mínimo 7 dígitos).',
                contact: {
                    id: contacto.id,
                    email: email || 'vacío',
                    phone: contacto.phone || contacto.mobile || 'N/A'
                }
            });
        }

        // Buscar el contacto en RD Station
        let existingContact = null;
        let tokenRefreshed = false;

        try {
            existingContact = await findContactByEmail(email, contacto);
        } catch (error) {
            if (error.message === 'TOKEN_EXPIRED' && !tokenRefreshed) {
                console.log(`🔄 Token expirado, refrescando... | ID=${contacto.id}`);

                const refreshSuccess = await refreshAccessToken();
                if (!refreshSuccess) {
                    console.log(`❌ ERROR: No se pudo refrescar token | ID=${contacto.id}`);
                    return res.status(401).json({
                        success: false,
                        statusCode: 401,
                        error: 'No se pudo refrescar el token de acceso.',
                        details: 'Token expirado y no se pudo renovar. Verificar credenciales.'
                    });
                }

                tokenRefreshed = true;

                // Reintentar búsqueda con token renovado
                try {
                    existingContact = await findContactByEmail(email, contacto);
                } catch (retryError) {
                    console.log(`❌ ERROR: Segundo intento fallido | ID=${contacto.id} | ${retryError.message}`);
                    return res.status(500).json({
                        success: false,
                        statusCode: 500,
                        error: 'Error al verificar existencia del contacto en RD Station después de refrescar token.',
                        details: process.env.NODE_ENV === 'development' ? retryError.message : undefined
                    });
                }
            } else {
                console.log(`❌ ERROR: Búsqueda fallida | ID=${contacto.id} | ${error.message}`);
                return res.status(500).json({
                    success: false,
                    statusCode: 500,
                    error: 'Error al buscar contacto en RD Station.',
                    details: process.env.NODE_ENV === 'development' ? error.message : undefined
                });
            }
        }

        if (!existingContact) {
            console.log(`❌ ERROR: Contacto no encontrado en RD Station | ID=${contacto.id} | Email=${email}`);
            return res.status(404).json({
                success: false,
                statusCode: 404,
                error: 'Contacto no encontrado en RD Station.',
                contact: {
                    id: contacto.id,
                    email: email
                }
            });
        }

        // Determinar qué teléfono usar (phone o mobile)
        const phoneToUse = contacto.phone || contacto.mobile;

        // Mapear correctamente los datos del webhook a la estructura esperada por updateContact
        const contactoParaActualizar = {
            id: contacto.id,
            firstname: contacto.firstname,
            lastname: contacto.lastname,
            email: email,
            phone: phoneToUse,
            mobile: contacto.mobile,
            nickname: custom_data.nickname || contacto.nickname,
            cedula: custom_data.cedula || contacto.cedula,
            language: contacto.language,
            position: contacto.position,
            rut: custom_data.rut || contacto.rut,
            address1: contacto.address1,
            address2: contacto.address2,
            numero_puerta: custom_data.numero_puerta,
            city: contacto.city,
            state: contacto.state,
            zip: contacto.zip,
            country: contacto.country,
            Demo_Fecha_Hora: custom_data.Demo_Fecha_Hora,
            direccion_demo: custom_data.direccion_demo,
            facebook: contacto.facebook,
            instagram: custom_data.instagram || contacto.instagram,
            linkedin: contacto.linkedin,
            twitter: contacto.twitter,
            website: contacto.website,
            stage: contacto.stage,
            owner: contacto.owner,
            ownerName: custom_data.ownerName,
            id_equipo: custom_data.id_equipo,
            importado_px: custom_data.importado_px,
            cupon_url: custom_data.cupon_url,
            envia_cupon_despues: custom_data.envia_cupon_despues,
            estado_sdr: custom_data.estado_sdr,
            foreignDocument: custom_data.foreignDocument,
            participo_SDR: custom_data.participo_SDR,
            referente: custom_data.referente,
            tiene_ichef: custom_data.tiene_ichef,
            token_invitado: custom_data.token_invitado,
            fuente_contacto: custom_data.fuente_contacto,
            status_contacto: custom_data.status_contacto,
            uso: custom_data.uso,
            categiria_contacto: custom_data.categiria_contacto,
            clientComments: contacto.clientComments,
            comments: contacto.comments,
            customData: contacto.customData,
            membership: contacto.membership,
            nucleo_familiar: custom_data.nucleo_familiar,
            referredAtCampaignId: contacto.referredAtCampaignId,
            referredAtInteractionId: contacto.referredAtInteractionId,
            referredByContactId: contacto.referredByContactId,
            referredDate: contacto.referredDate,
            createdByCampaignId: contacto.createdByCampaignId,
            createdByUserId: contacto.createdByUserId,
            createdDate: contacto.createdDate,
            // Campos de encuesta
            forma_pago: custom_data.forma_pago,
            acesso_ichef: custom_data.acesso_ichef,
            cantidad_personas_Cocina: custom_data.cantidad_personas_Cocina,
            condicion_alimenticia: custom_data.condicion_alimenticia,
            contenido_preferido: custom_data.contenido_preferido,
            experiencia: custom_data.experiencia,
            frecuencia_Cocina: custom_data.frecuencia_Cocina,
            gusta_cocinar: custom_data.gusta_cocinar,
            gustos_alimenticios: custom_data.gustos_alimenticios,
            mayor_desafio: custom_data.mayor_desafio,
            profesional: custom_data.profesional,
            sugerencia_contenido: custom_data.sugerencia_contenido,
            via_se_entero_ichef: custom_data.via_se_entero_ichef,
            quien_cocina_casa: custom_data.quien_cocina_casa
        };

        // Actualizar el contacto usando la función existente que ya tiene todas las validaciones
        const updateSuccess = await updateContact(existingContact.uuid, contactoParaActualizar);
        if (!updateSuccess) {
            console.log(`❌ ERROR ACTUALIZACIÓN: ID=${contacto.id} | ${email}`);
            return res.status(500).json({
                success: false,
                statusCode: 500,
                error: 'Error al actualizar el contacto en RD Station.',
                contact: {
                    id: contacto.id,
                    email: email,
                    uuid: existingContact.uuid
                }
            });
        }

        console.log(`✅ ACTUALIZADO: ID=${contacto.id} | ${email} | UUID=${existingContact.uuid}`);
        return res.status(200).json({
            success: true,
            statusCode: 200,
            message: 'Contacto actualizado exitosamente en RD Station.',
            contact: {
                id: contacto.id,
                email: email,
                uuid: existingContact.uuid
            },
            tokenRefreshed: tokenRefreshed
        });

    } catch (error) {
        console.error('Error inesperado al actualizar contacto:', error);
        return res.status(500).json({
            success: false,
            statusCode: 500,
            error: 'Error interno del servidor.',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};


/**
 * Crea un evento de conversión en RD Station
 * @param {string} email - Email del contacto
 * @param {string} eventName - Nombre del evento (demo, demo-antel, etc.)
 * @param {Object} eventData - Datos adicionales del evento
 * @returns {Promise<boolean>} - True si el evento se creó exitosamente
 */
const createConversionEvent = async (email, eventName, eventData = {}) => {
    const apiCall = async () => {
        // Estructura correcta según la documentación de RD Station
        const payload = {
            event_type: "CONVERSION",
            event_family: "CDP",
            payload: {
                conversion_identifier: eventName,
                name: eventData.name || '',
                email: email,
                personal_phone: eventData.phone || '',
                mobile_phone: eventData.phone || '',
                state: eventData.state || '',
                city: eventData.city || '',
                // Campos personalizados del demo
                cf_fecha_demo: eventData.date || '',
                cf_horario_demo: eventData.timeslot || '',
                cf_local_demo: eventData.local_demo || '',
                cf_direccion_demo: eventData.direccion_demo || '',
                cf_source_url: eventData.source_url || '',
                cf_calendar_id: eventData.calendar_id || '',
                // Campos adicionales recomendados
                available_for_mailing: true,
                // legal_bases: [
                //     {
                //         category: "communications",
                //         type: "consent", 
                //         status: "granted"
                //     }
                // ]
                traffic_source: eventData.source_url || ''
            }
        };

        // URL con parámetro event_type según documentación
        const response = await axios.post(
            `${RD_STATION_CONFIG.API_BASE_URL}/platform/events?event_type=conversion`,
            payload,
            {
                headers: {
                    'Authorization': `Bearer ${credenciales.access_token}`,
                    'Content-Type': 'application/json',
                    'accept': 'application/json'
                }
            }
        );
        return response.data;
    };

    try {
        const result = await executeWithRetry(apiCall, 'CONVERSION_EVENT', { email, eventName });
        console.log(`✅ Evento de conversión creado exitosamente: ${eventName} para ${email}`);
        return true;
    } catch (error) {
        console.error(`❌ Error al crear evento de conversión | Email=${email} | Evento=${eventName}`);
        console.error(`❌ Status: ${error.response?.status} | Data:`, error.response?.data);
        console.error(`❌ Message: ${error.message}`);
        return false;
    }
};

/**
 * Registra un demo desde el sistema de agendamiento
 * Busca o crea el contacto y registra el evento de conversión correspondiente
 * @param {Object} req - Objeto de solicitud de Express
 * @param {Object} res - Objeto de respuesta de Express
 */
const registrarDemo = async (req, res) => {
    try {
        const demoData = req.body;

        console.log('📩 Demo recibido:', {
            email: demoData.email,
            name: demoData.name,
            date: demoData.date,
            timeslot: demoData.timeslot,
            source_url: demoData.source_url
        });

        // Validar datos requeridos
        if (!demoData.email || !demoData.name || !demoData.date) {
            return res.status(400).json({
                success: false,
                statusCode: 400,
                error: 'Faltan datos requeridos: email, name y date son obligatorios.'
            });
        }

        // Determinar el tipo de evento basado en la URL
        let eventName = 'demo'; // default
        if (demoData.source_url && demoData.source_url.includes('demo-antel')) {
            eventName = 'demo-antel';
        }

        console.log(`📋 Evento determinado: ${eventName}`);

        // Preparar datos del contacto para buscar/crear
        const contactData = {
            email: cleanEmail(demoData.email),
            firstname: demoData.name,
            lastname: demoData.lastname || '',
            phone: demoData.phone,
            state: demoData.state,
            city: demoData.city,
            Demo_Fecha_Hora: `${demoData.date} ${demoData.timeslot}`,
            direccion_demo: demoData.direccion_demo
        };

        let existingContact = null;
        let tokenRefreshed = false;
        let emailToUse = contactData.email;

        // Validar email principal
        if (!isValidEmail(contactData.email)) {
            console.log(`⚠️ Email inválido: ${contactData.email}`);

            // Si hay teléfono, generar email ficticio
            if (isValidPhone(contactData.phone)) {
                emailToUse = generateEmailFromPhone(contactData.phone);
                contactData.email = emailToUse;
                console.log(`🔄 Email generado desde teléfono: ${emailToUse}`);
            } else {
                return res.status(400).json({
                    success: false,
                    statusCode: 400,
                    error: 'Email inválido y no se puede generar desde teléfono.'
                });
            }
        }

        // Buscar contacto existente
        try {
            existingContact = await findContactByEmail(emailToUse, contactData);
        } catch (error) {
            if (error.message === 'TOKEN_EXPIRED' && !tokenRefreshed) {
                console.log(`🔄 Token expirado, refrescando...`);

                const refreshSuccess = await refreshAccessToken();
                if (!refreshSuccess) {
                    return res.status(401).json({
                        success: false,
                        statusCode: 401,
                        error: 'No se pudo refrescar el token de acceso.'
                    });
                }

                tokenRefreshed = true;

                // Reintentar búsqueda
                try {
                    existingContact = await findContactByEmail(emailToUse, contactData);
                } catch (retryError) {
                    console.log(`❌ Error en segundo intento de búsqueda: ${retryError.message}`);
                }
            }
        }

        let contactAction = '';

        // Actualizar o crear contacto
        if (existingContact) {
            const updateSuccess = await updateContact(existingContact.uuid, contactData);
            if (updateSuccess) {
                console.log(`✅ CONTACTO ACTUALIZADO: ${emailToUse}`);
                contactAction = 'UPDATED';
            } else {
                console.log(`⚠️ Error al actualizar contacto: ${emailToUse}`);
                contactAction = 'UPDATE_FAILED';
            }
        } else {
            const createSuccess = await createContact(contactData);
            if (createSuccess) {
                console.log(`✅ CONTACTO CREADO: ${emailToUse}`);
                contactAction = 'CREATED';
            } else {
                console.log(`❌ Error al crear contacto: ${emailToUse}`);
                return res.status(500).json({
                    success: false,
                    statusCode: 500,
                    error: 'No se pudo crear el contacto en RD Station.'
                });
            }
        }

        // Crear evento de conversión
        console.log(`📅 Intentando crear evento de conversión: ${eventName} para ${emailToUse}`);
        const eventSuccess = await createConversionEvent(emailToUse, eventName, {
            name: `${demoData.name} ${demoData.lastname || ''}`.trim(),
            email: emailToUse,
            phone: demoData.phone,
            date: demoData.date,
            timeslot: demoData.timeslot,
            local_demo: demoData.local_demo,
            direccion_demo: demoData.direccion_demo,
            state: demoData.state,
            city: demoData.city,
            source_url: demoData.source_url,
            calendar_id: demoData.calendar_id
        });

        const responseData = {
            success: true,
            statusCode: 200,
            message: 'Demo registrado exitosamente.',
            data: {
                email: emailToUse,
                contactAction: contactAction,
                eventName: eventName,
                eventCreated: eventSuccess,
                tokenRefreshed: tokenRefreshed
            }
        };

        // Si el evento falló pero el contacto se procesó bien, aún considerarlo exitoso pero con advertencia
        if (!eventSuccess) {
            console.log(`⚠️ ADVERTENCIA: Contacto procesado pero evento falló: ${eventName} para ${emailToUse}`);
            responseData.message = 'Contacto procesado exitosamente, pero hubo un problema al registrar el evento de conversión.';
            responseData.warning = 'El evento de conversión no se pudo crear. Revisar configuración de eventos en RD Station.';
        } else {
            console.log(`✅ DEMO COMPLETAMENTE REGISTRADO: Contacto ${contactAction} + Evento ${eventName} para ${emailToUse}`);
        }

        return res.status(200).json(responseData);

    } catch (error) {
        console.error('Error inesperado en registrarDemo:', error);
        return res.status(500).json({
            success: false,
            statusCode: 500,
            error: 'Error interno del servidor.',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};


export {
    importarContactos,
    isValidEmail,
    isValidPhone,
    generateEmailFromPhone,
    refreshAccessToken,
    findContactByEmail,
    createContact,
    updateContact,
    actualizarContacto,
    logContactError,
    createConversionEvent,
    registrarDemo

};
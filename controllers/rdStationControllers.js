import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const RD_STATION_CONFIG = {
    API_BASE_URL: process.env.RDSTATION_URL
};

const CHATWOOT_CONFIG = {
    BASE_URL: process.env.CHATWOOT_URL,
    API_TOKEN: process.env.API_ACCESS_TOKEN,
    ACCOUNT_ID: 2
};

/**
 * Circuit breaker para evitar reintentos cuando RD Station está caído
 */
const circuitBreaker = {
    isOpen: false,
    failureCount: 0,
    lastFailureTime: null,
    failureThreshold: 5, // Después de 5 fallos consecutivos del servidor
    resetTimeout: 300000, // 5 minutos en milisegundos

    /**
     * Verifica si el circuit breaker permite hacer la petición
     */
    canMakeRequest() {
        if (!this.isOpen) {
            return true;
        }

        // Si han pasado más de resetTimeout minutos, reiniciar el circuit breaker
        const now = Date.now();
        if (this.lastFailureTime && (now - this.lastFailureTime) > this.resetTimeout) {
            console.log('🔄 Circuit breaker reseteado después de período de espera');
            this.reset();
            return true;
        }

        return false;
    },

    /**
     * Registra un fallo del servidor (5xx)
     */
    recordServerFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();

        if (this.failureCount >= this.failureThreshold) {
            this.isOpen = true;
            console.log(`🚨 Circuit breaker ABIERTO después de ${this.failureCount} fallos del servidor. Esperando ${this.resetTimeout / 1000 / 60} minutos antes de reintentar.`);
        }
    },

    /**
     * Registra un éxito y resetea el contador si es necesario
     */
    recordSuccess() {
        if (this.failureCount > 0) {
            console.log('✅ Circuit breaker: Operación exitosa, reseteando contador de fallos');
        }
        this.reset();
    },

    /**
     * Resetea el circuit breaker
     */
    reset() {
        this.isOpen = false;
        this.failureCount = 0;
        this.lastFailureTime = null;
    }
};

/**
 * Credenciales para autenticación con RD Station API
 */
let credenciales = {
    "client_id": process.env.RDSTATION_CLIENT_ID,
    "client_secret": process.env.RDSTATION_CLIENT_SECRET,
    "access_token": "",
    "refresh_token": process.env.RDSTATION_REFRESH_TOKEN
}

/**
 * Función para validar e inicializar las credenciales de RD Station
 * @returns {boolean} - True si las credenciales están configuradas correctamente
 */
const initializeCredentials = () => {
    const missing = [];
    const present = [];

    // Verificar cada credencial
    if (!process.env.RDSTATION_CLIENT_ID) {
        missing.push('RDSTATION_CLIENT_ID');
    } else {
        present.push('RDSTATION_CLIENT_ID');
        credenciales.client_id = process.env.RDSTATION_CLIENT_ID;
    }

    if (!process.env.RDSTATION_CLIENT_SECRET) {
        missing.push('RDSTATION_CLIENT_SECRET');
    } else {
        present.push('RDSTATION_CLIENT_SECRET');
        credenciales.client_secret = process.env.RDSTATION_CLIENT_SECRET;
    }

    if (!process.env.RDSTATION_REFRESH_TOKEN) {
        missing.push('RDSTATION_REFRESH_TOKEN');
    } else {
        present.push('RDSTATION_REFRESH_TOKEN');
        credenciales.refresh_token = process.env.RDSTATION_REFRESH_TOKEN;
    }

    if (!process.env.RDSTATION_URL) {
        missing.push('RDSTATION_URL');
    } else {
        present.push('RDSTATION_URL');
    }

    // Log del estado de las credenciales
    if (missing.length > 0) {
        console.error('🚨 CONFIGURACIÓN INCOMPLETA DE RD STATION:');
        console.error(`❌ Variables faltantes: ${missing.join(', ')}`);
        if (present.length > 0) {
            console.error(`✅ Variables presentes: ${present.join(', ')}`);
        }
        console.error('💡 Acción requerida: Verificar archivo .env o variables de entorno del sistema');
        return false;
    } else {
        // console.log('✅ Credenciales de RD Station configuradas correctamente');
        // console.log(`🔗 API URL: ${process.env.RDSTATION_URL}`);
        // Solo mostrar los primeros y últimos caracteres por seguridad
        const maskCredential = (str) => {
            if (!str || str.length < 8) return '[MASKED]';
            return str.substring(0, 4) + '...' + str.substring(str.length - 4);
        };
        // console.log(`🔑 Client ID: ${maskCredential(credenciales.client_id)}`);
        // console.log(`🔑 Refresh Token: ${maskCredential(credenciales.refresh_token)}`);
        return true;
    }
};

/**
 * Función para obtener el estado actual de las credenciales
 * @returns {Object} - Estado de las credenciales
 */
const getCredentialsStatus = () => {
    return {
        hasClientId: !!credenciales.client_id,
        hasClientSecret: !!credenciales.client_secret,
        hasRefreshToken: !!credenciales.refresh_token,
        hasAccessToken: !!credenciales.access_token,
        apiUrl: process.env.RDSTATION_URL || 'NOT_SET'
    };
};

// Inicializar credenciales al cargar el módulo
const credentialsValid = initializeCredentials();

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
 * Busca un contacto en Chatwoot por ID, email o teléfono
 * @param {Object} searchData - Datos para buscar (id, email, phone)
 * @returns {Promise<Object|null>} - Contacto encontrado o null
 */
const findChatwootContact = async (searchData) => {
    try {
        // Usar el endpoint GET /contacts/search que es más confiable que el filter
        let query = searchData.email || searchData.phone || "";
        if (!query) return null;

        const url = `${CHATWOOT_CONFIG.BASE_URL}/api/v1/accounts/${CHATWOOT_CONFIG.ACCOUNT_ID}/contacts/search?q=${encodeURIComponent(query)}`;

        console.log(`🔍 Buscando contacto en Chatwoot: q=${query}`);

        const response = await axios.get(url, {
            headers: {
                'Content-Type': 'application/json',
                'api_access_token': CHATWOOT_CONFIG.API_TOKEN,
            },
        });

        const contacts = response.data?.payload || [];
        console.log(`   Resultados: ${contacts.length} contacto(s)`);

        if (contacts.length === 0) return null;

        // Si hay múltiples, buscar coincidencia exacta por email
        if (searchData.email && contacts.length > 1) {
            const exact = contacts.find(c => c.email?.toLowerCase() === searchData.email.toLowerCase());
            if (exact) return exact;
        }

        return contacts[0];
    } catch (error) {
        console.error('Error al buscar contacto en Chatwoot:', error.message);
        return null;
    }
};

/**
 * Crea un nuevo contacto en Chatwoot
 * @param {Object} contactData - Datos del contacto a crear
 * @returns {Promise<Object|null>} - Contacto creado o null si falla
 */
const createChatwootContact = async (contactData) => {
    try {
        const phoneToUse = contactData.phone || contactData.mobile;
        const fullName = `${contactData.firstname || ''} ${contactData.lastname || ''}`.trim();

        // Validar datos mínimos requeridos
        if (!fullName || fullName === '') {
            console.error(`❌ Error: nombre es requerido para crear contacto en Chatwoot`);
            return null;
        }

        // Construir payload básico
        const chatwootPayload = {
            name: fullName
        };

        // Agregar email solo si es válido
        if (contactData.email && isValidEmail(contactData.email)) {
            chatwootPayload.email = contactData.email;
        }

        // Agregar teléfono solo si es válido y en formato E.164
        if (phoneToUse && isValidPhone(phoneToUse)) {
            const normalizedPhone = normalizeUruguayanPhone(phoneToUse);
            if (normalizedPhone) {
                // Chatwoot requiere formato E.164 con el signo +
                chatwootPayload.phone_number = `+${normalizedPhone}`;
            }
        }

        // Construir custom_attributes solo con valores válidos
        const customAttrs = {};
        if (contactData.id) customAttrs.id = contactData.id;
        if (contactData.cedula) customAttrs.cedula = contactData.cedula;
        if (contactData.rut) customAttrs.rut = contactData.rut;
        if (contactData.city) customAttrs.city = contactData.city;
        if (contactData.country) customAttrs.country = contactData.country;
        if (contactData.state) customAttrs.state = contactData.state;
        if (contactData.address1) customAttrs.address1 = contactData.address1;
        if (contactData.stage) customAttrs.stage = contactData.stage;
        if (contactData.ownerName) customAttrs.owner_name = contactData.ownerName;
        if (contactData.local_demo) customAttrs.local_demo = contactData.local_demo;
        if (contactData.Demo_Fecha_Hora) customAttrs.demo_fecha_hora = contactData.Demo_Fecha_Hora;

        if (Object.keys(customAttrs).length > 0) {
            chatwootPayload.custom_attributes = customAttrs;
        }

        const response = await axios.post(
            `${CHATWOOT_CONFIG.BASE_URL}/api/v1/accounts/${CHATWOOT_CONFIG.ACCOUNT_ID}/contacts`,
            chatwootPayload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'api_access_token': CHATWOOT_CONFIG.API_TOKEN,
                },
            }
        );

        const identifier = contactData.id || contactData.email || phoneToUse;
        console.log(`✅ Contacto creado en Chatwoot | Identificador=${identifier}`);
        return response.data.payload;
    } catch (error) {
        const identifier = contactData.id || contactData.email || contactData.phone;
        console.error(`❌ Error al crear contacto en Chatwoot | Identificador=${identifier}:`, error.message);
        if (error.response?.data) {
            console.error(`   Detalles del error:`, JSON.stringify(error.response.data));
        }
        return null;
    }
};

/**
 * Actualiza un contacto existente en Chatwoot
 * @param {string} chatwootContactId - ID del contacto en Chatwoot
 * @param {Object} contactData - Datos del contacto a actualizar
 * @returns {Promise<boolean>} - True si se actualizó exitosamente
 */
const updateChatwootContact = async (chatwootContactId, contactData) => {
    try {
        const phoneToUse = contactData.phone || contactData.mobile;
        const fullName = `${contactData.firstname || ''} ${contactData.lastname || ''}`.trim();

        // Construir payload
        const chatwootPayload = {};

        if (fullName) chatwootPayload.name = fullName;
        if (contactData.email && isValidEmail(contactData.email)) {
            chatwootPayload.email = contactData.email;
        }
        if (phoneToUse && isValidPhone(phoneToUse)) {
            const normalizedPhone = normalizeUruguayanPhone(phoneToUse);
            if (normalizedPhone) {
                // Chatwoot requiere formato E.164 con el signo +
                chatwootPayload.phone_number = `+${normalizedPhone}`;
            }
        }

        // Construir custom_attributes solo con valores válidos
        const customAttrs = {};
        if (contactData.id) customAttrs.id = contactData.id;
        if (contactData.cedula) customAttrs.cedula = contactData.cedula;
        if (contactData.rut) customAttrs.rut = contactData.rut;
        if (contactData.city) customAttrs.city = contactData.city;
        if (contactData.country) customAttrs.country = contactData.country;
        if (contactData.state) customAttrs.state = contactData.state;
        if (contactData.address1) customAttrs.address1 = contactData.address1;
        if (contactData.stage) customAttrs.stage = contactData.stage;
        if (contactData.ownerName) customAttrs.owner_name = contactData.ownerName;
        if (contactData.local_demo) customAttrs.local_demo = contactData.local_demo;
        if (contactData.Demo_Fecha_Hora) customAttrs.demo_fecha_hora = contactData.Demo_Fecha_Hora;

        if (Object.keys(customAttrs).length > 0) {
            chatwootPayload.custom_attributes = customAttrs;
        }

        await axios.put(
            `${CHATWOOT_CONFIG.BASE_URL}/api/v1/accounts/${CHATWOOT_CONFIG.ACCOUNT_ID}/contacts/${chatwootContactId}`,
            chatwootPayload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'api_access_token': CHATWOOT_CONFIG.API_TOKEN,
                },
            }
        );

        const identifier = contactData.id || contactData.email || phoneToUse;
        console.log(`✅ Contacto actualizado en Chatwoot | Identificador=${identifier} | Chatwoot ID=${chatwootContactId}`);
        return true;
    } catch (error) {
        const identifier = contactData.id || contactData.email || contactData.phone;
        console.error(`❌ Error al actualizar contacto en Chatwoot | Identificador=${identifier}:`, error.message);
        if (error.response?.data) {
            console.error(`   Detalles del error:`, JSON.stringify(error.response.data));
        }
        return false;
    }
};

/**
 * Sincroniza un contacto con Chatwoot (crear o actualizar)
 * @param {Object} contactData - Datos del contacto
 * @returns {Promise<void>}
 */
const syncContactToChatwoot = async (contactData) => {
    try {
        // Buscar si el contacto existe en Chatwoot
        const existingContact = await findChatwootContact({
            id: contactData.id,
            email: contactData.email,
            phone: contactData.phone || contactData.mobile
        });

        if (existingContact) {
            // Actualizar contacto existente
            await updateChatwootContact(existingContact.id, contactData);
        } else {
            // Crear nuevo contacto
            await createChatwootContact(contactData);
        }
    } catch (error) {
        console.error(`Error al sincronizar contacto con Chatwoot | ID=${contactData.id}:`, error.message);
    }
};

/**
 * Control de concurrencia para refresh token
 */
let refreshTokenPromise = null;

/**
 * Wrapper que maneja automáticamente el refresh del token cuando es necesario
 * @param {Function} apiCall - Función que hace la llamada a la API
 * @param {string} operationName - Nombre de la operación para logging
 * @param {Object} contactData - Datos del contacto para logging
 * @returns {Promise<any>} - Resultado de la operación
 */
const executeWithAutoRefresh = async (apiCall, operationName, contactData = {}) => {
    try {
        // Intentar la operación original
        const result = await apiCall();
        return result;
    } catch (error) {
        const isTokenExpired = error.response?.status === 401;

        if (!isTokenExpired) {
            // Si no es error de token, propagar el error
            throw error;
        }

        // console.log(`🔄 Token expirado detectado en ${operationName} | ID=${contactData.id} | Intentando refresh automático...`);

        // Manejar concurrencia: si ya hay un refresh en progreso, esperar a que termine
        if (refreshTokenPromise) {
            console.log(`⏳ Refresh ya en progreso, esperando... | ID=${contactData.id}`);
            try {
                await refreshTokenPromise;
            } catch (refreshError) {
                console.log(`❌ Refresh concurrente falló | ID=${contactData.id}`);
                throw error; // Throw el error original
            }
        } else {
            // Iniciar nuevo refresh
            refreshTokenPromise = refreshAccessToken();

            try {
                const refreshSuccess = await refreshTokenPromise;

                if (!refreshSuccess) {
                    console.log(`❌ No se pudo refrescar token para ${operationName} | ID=${contactData.id}`);
                    throw error; // Throw el error original
                }

                console.log(`✅ Token refrescado exitosamente para ${operationName} | ID=${contactData.id}`);
            } catch (refreshError) {
                console.log(`❌ Error durante refresh para ${operationName} | ID=${contactData.id}`);
                throw error; // Throw el error original
            } finally {
                // Limpiar la promesa de refresh
                refreshTokenPromise = null;
            }
        }

        // Reintentar la operación original con el token actualizado
        // console.log(`🔄 Reintentando ${operationName} con token actualizado | ID=${contactData.id}`);

        try {
            const result = await apiCall();
            console.log(`✅ ${operationName} exitoso después de refresh de token | ID=${contactData.id}`);
            return result;
        } catch (retryError) {
            console.log(`❌ ${operationName} falló después de refresh de token | ID=${contactData.id} | ${retryError.response?.status}`);
            throw retryError;
        }
    }
};

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
 * Ejecuta una función con reintentos automáticos, auto-refresh de token y manejo de rate limiting
 * @param {Function} apiCall - Función que hace la llamada a la API
 * @param {string} operationName - Nombre de la operación para logging
 * @param {Object} contactData - Datos del contacto para logging de errores
 * @param {number} retryCount - Contador de reintentos actual
 * @returns {Promise<any>} - Resultado de la operación o throw error si falla completamente
 */
const executeWithRetry = async (apiCall, operationName, contactData = {}, retryCount = 0) => {
    try {
        // Usar executeWithAutoRefresh para manejar automáticamente el refresh del token
        const result = await executeWithAutoRefresh(apiCall, operationName, contactData);

        // Si llegamos aquí, la operación fue exitosa
        if (retryCount > 0) {
            console.log(`✅ ${operationName} exitoso después de ${retryCount} reintentos | ID=${contactData.id}`);
        }

        return result;

    } catch (error) {
        const isRateLimit = error.response?.status === 429;
        const isServerError = error.response?.status >= 500;
        const isClientError = error.response?.status >= 400 && error.response?.status < 500;

        // No reintentar para errores de cliente (400-499) excepto 429
        // El 401 ya se maneja en executeWithAutoRefresh
        if (isClientError && !isRateLimit) {
            console.log(`❌ ${operationName} ERROR CLIENTE: ${error.response?.status} | ID=${contactData.id} | No se reintentará`);
            throw error;
        }

        const shouldRetry = (isRateLimit || isServerError) && retryCount < RETRY_CONFIG.MAX_RETRIES;

        if (!shouldRetry) {
            // Log detallado del fallo final
            if (isServerError) {
                console.log(`❌ ${operationName} FALLO FINAL: Error del servidor (${error.response?.status}) después de ${retryCount} reintentos | ID=${contactData.id}`);
            } else if (retryCount >= RETRY_CONFIG.MAX_RETRIES) {
                console.log(`❌ ${operationName} FALLO FINAL: Máximo de reintentos alcanzado (${retryCount}/${RETRY_CONFIG.MAX_RETRIES}) | ID=${contactData.id}`);
            }
            throw error;
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
        } else {
            console.log(`🔄 Error ${error.response?.status}, esperando ${delayMs}ms antes del reintento ${retryCount + 1}/${RETRY_CONFIG.MAX_RETRIES} | ID=${contactData.id}`);
        }

        await delay(delayMs);

        // Reintento recursivo
        return executeWithRetry(apiCall, operationName, contactData, retryCount + 1);
    }
};

/**
 * Refresca el token de acceso cuando ha expirado
 * Implementa exactamente el flujo descrito en: https://developers.rdstation.com/reference/atualizar-access-token
 * @returns {Promise<boolean>} - True si el token se refrescó exitosamente, false en caso contrario
 */
const refreshAccessToken = async () => {
    try {
        // Verificar circuit breaker antes de intentar
        if (!circuitBreaker.canMakeRequest()) {
            const timeToWait = Math.ceil((circuitBreaker.resetTimeout - (Date.now() - circuitBreaker.lastFailureTime)) / 1000 / 60);
            console.error(`🚨 REFRESH TOKEN BLOQUEADO: Circuit breaker abierto. Intenta en ${timeToWait} minutos.`);
            return false;
        }

        // Validar que tenemos las credenciales necesarias
        const credStatus = getCredentialsStatus();
        if (!credStatus.hasClientId || !credStatus.hasClientSecret || !credStatus.hasRefreshToken) {
            console.error('❌ REFRESH TOKEN ERROR: Credenciales incompletas', credStatus);
            console.error('🔧 Verificar variables de entorno: RDSTATION_CLIENT_ID, RDSTATION_CLIENT_SECRET, RDSTATION_REFRESH_TOKEN');

            // Re-intentar cargar credenciales por si acaso
            const reloadSuccess = initializeCredentials();
            if (!reloadSuccess) {
                console.error('💥 No se pueden cargar las credenciales después de reintento');
                return false;
            }

            // Verificar nuevamente después del reload
            const newCredStatus = getCredentialsStatus();
            if (!newCredStatus.hasClientId || !newCredStatus.hasClientSecret || !newCredStatus.hasRefreshToken) {
                console.error('❌ REFRESH TOKEN ERROR: Credenciales siguen incompletas después de reload', newCredStatus);
                return false;
            }
        }

        console.log('🔄 Intentando refrescar token de acceso...');

        // Construir el payload exactamente como especifica la documentación
        const requestBody = {
            client_id: credenciales.client_id,
            client_secret: credenciales.client_secret,
            refresh_token: credenciales.refresh_token,
            grant_type: 'refresh_token' // Este campo es obligatorio según la documentación
        };

        console.log('🔗 Enviando request a RD Station auth endpoint...');

        const refreshResponse = await axios.post(
            'https://api.rd.services/auth/token',
            requestBody,
            {
                headers: {
                    'accept': 'application/json',
                    'content-type': 'application/json'
                },
                timeout: 15000 // 15 segundos de timeout
            }
        );

        // Verificar que la respuesta contiene los datos esperados
        if (!refreshResponse.data) {
            console.error('❌ REFRESH TOKEN ERROR: Respuesta vacía del servidor');
            return false;
        }

        const { access_token, refresh_token, expires_in } = refreshResponse.data;

        if (!access_token) {
            console.error('❌ REFRESH TOKEN ERROR: No se recibió access_token en la respuesta', refreshResponse.data);
            return false;
        }

        // Actualizar las credenciales
        credenciales.access_token = access_token;

        // Actualizar refresh_token si se proporciona uno nuevo
        if (refresh_token) {
            credenciales.refresh_token = refresh_token;
            console.log('🔄 Refresh token actualizado');
        }

        // Log información sobre expiración si está disponible
        if (expires_in) {
            const expirationTime = new Date(Date.now() + (expires_in * 1000));
            // console.log(`⏰ Nuevo token expira en ${expires_in} segundos (${expirationTime.toLocaleString()})`);
        }

        // Registrar éxito en circuit breaker
        circuitBreaker.recordSuccess();
        console.log('✅ TOKEN REFRESHED SUCCESSFULLY');
        return true;

    } catch (error) {
        const status = error.response?.status;
        const errorData = error.response?.data;
        const errorMessage = error.message;

        // Registrar fallos del servidor en el circuit breaker
        if (status >= 500 && status < 600) {
            circuitBreaker.recordServerFailure();
        }

        // Logging detallado según el tipo de error
        if (status >= 500 && status < 600) {
            console.error(`❌ REFRESH TOKEN ERROR: Error del servidor de RD Station (${status})`, {
                status,
                message: errorMessage,
                data: errorData,
                circuitBreakerFailures: circuitBreaker.failureCount
            });
            console.error('🚨 El servidor de RD Station está experimentando problemas. Intenta más tarde.');
        } else if (status === 401) {
            console.error('❌ REFRESH TOKEN ERROR: Credenciales inválidas (401)', {
                message: errorMessage,
                data: errorData
            });
            console.error('🔑 El refresh_token puede haber expirado o las credenciales son incorrectas.');
            console.error('💡 Acción requerida: Verificar refresh_token, client_id y client_secret en variables de entorno.');
        } else if (status === 400) {
            console.error('❌ REFRESH TOKEN ERROR: Request inválido (400)', {
                message: errorMessage,
                data: errorData
            });
            console.error('📝 Verificar que el formato del request sea correcto según la documentación.');
        } else if (error.code === 'ECONNABORTED') {
            console.error('❌ REFRESH TOKEN ERROR: Timeout al conectar con RD Station', {
                message: errorMessage
            });
        } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            console.error('❌ REFRESH TOKEN ERROR: No se puede conectar con RD Station', {
                code: error.code,
                message: errorMessage
            });
        } else {
            console.error('❌ REFRESH TOKEN ERROR: Error desconocido', {
                status,
                code: error.code,
                message: errorMessage,
                data: errorData
            });
        }

        return false;
    }
};

/**
 * Busca un contacto en RD Station por email con reintentos automáticos
 * @param {string} email - Email del contacto a buscar
 * @param {Object} contactData - Datos del contacto para logging (opcional)
 * @returns {Promise<Object|null>} - Datos del contacto si existe, null si no existe
 */
const findContactByEmail = async (email, contactData = {}) => {
    const apiCall = async () => {
        const response = await axios.get(`${RD_STATION_CONFIG.API_BASE_URL}/platform/contacts/email:${encodeURIComponent(email)}`, {
            headers: {
                'Authorization': `Bearer ${credenciales.access_token}`,
                'Content-Type': 'application/json'
            }
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
            "cf_createddate": contactData.createdDate,
            "cf_local_demo": contactData.local_demo,
            "cf_demo_fecha_hora_utc": contactData.demo_fecha_hora_utc
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

        // Sincronizar con Chatwoot después de crear en RD Station
        await syncContactToChatwoot(contactData);

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
            "cf_createddate": contactData.createdDate,
            "cf_local_demo": contactData.local_demo,
            "cf_demo_fecha_hora_utc": contactData.demo_fecha_hora_utc
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

        // Sincronizar con Chatwoot después de actualizar en RD Station
        await syncContactToChatwoot(contactData);

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
        // Verificar credenciales antes de procesar
        if (!credentialsValid) {
            console.log(`❌ ERROR: Credenciales de RD Station no configuradas`);
            return res.status(500).json({
                success: false,
                statusCode: 500,
                error: 'Configuración de RD Station incompleta. Verificar variables de entorno.',
                credentialsStatus: getCredentialsStatus()
            });
        }

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

        // Extraer datos personalizados del customData si existe
        let custom_data = {};
        try {
            if (contact.customData && typeof contact.customData === 'string') {
                custom_data = JSON.parse(contact.customData);
                console.log('📋 DEBUG: Custom Data extraído:', custom_data);
            }
        } catch (error) {
            console.log('⚠️ WARN: Error al parsear customData:', error.message);
            custom_data = {};
        }

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

        try {
            existingContact = await findContactByEmail(contact.email, contact);
        } catch (error) {
            console.log(`❌ ERROR: Búsqueda fallida | ID=${contactInfo.id} | ${error.message}`);
            return res.status(500).json({
                success: false,
                statusCode: 500,
                error: 'Error al buscar contacto en RD Station.',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
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

            // Verificar si este contacto viene específicamente de un registro de demo ACTUAL/FUTURO
            // Solo registrar evento si tiene TANTO Demo_Fecha_Hora COMO source_url Y la fecha es reciente/futura
            let eventCreated = false;
            if (contact.Demo_Fecha_Hora && contact.source_url && contact.Demo_Fecha_Hora.trim() !== '' && contact.source_url.trim() !== '') {

                // Validar que la fecha de demo es reciente o futura (no demos pasadas)
                const demoDateStr = contact.Demo_Fecha_Hora.split(' ')[0]; // Extraer solo la fecha
                const demoDate = new Date(demoDateStr);
                const today = new Date();
                const yesterday = new Date(today);
                yesterday.setDate(today.getDate() - 1);

                // Solo procesar si la demo es de ayer en adelante (permite demos del día anterior por diferencias de zona horaria)
                if (demoDate >= yesterday) {
                    console.log(`📅 DEBUG: Detectado actualización por registro de DEMO ACTUAL/FUTURO (${demoDateStr}), registrando evento de conversión...`);
                    console.log(`📅 DEBUG: Demo_Fecha_Hora: ${contact.Demo_Fecha_Hora}`);
                    console.log(`📅 DEBUG: source_url: ${contact.source_url}`);

                    // Determinar tipo de evento basado en la URL de origen
                    let eventName = 'demo'; // default
                    if (contact.source_url && contact.source_url.includes('demo-antel')) {
                        eventName = 'demo-antel';
                    }

                    console.log(`📅 DEBUG: Registrando evento: ${eventName} para ${contact.email}`);

                    const eventSuccess = await createConversionEvent(contact.email, eventName, {
                        name: `${contact.firstname || ''} ${contact.lastname || ''}`.trim(),
                        email: contact.email,
                        phone: contact.phone || contact.mobile,
                        date: contact.Demo_Fecha_Hora ? contact.Demo_Fecha_Hora.split(' ')[0] : '',
                        timeslot: contact.Demo_Fecha_Hora ? contact.Demo_Fecha_Hora.split(' ')[1] : '',
                        local_demo: contact.local_demo || '',
                        direccion_demo: contact.direccion_demo || '',
                        state: contact.state || '',
                        city: contact.city || '',
                        source_url: contact.source_url || '',
                        calendar_id: contact.calendar_id || ''
                    });

                    eventCreated = eventSuccess;
                    console.log(`📅 DEBUG: Resultado del evento: ${eventSuccess ? 'SUCCESS' : 'FAILED'}`);
                } else {
                    console.log(`📋 DEBUG: Demo PASADA detectada en actualización (${demoDateStr}) - NO se registra evento de conversión para evitar duplicados`);
                }
            } else {
                console.log(`📋 DEBUG: Contacto actualizado sin datos de demo válidos - NO se registra evento de conversión`);
                if (!contact.Demo_Fecha_Hora || contact.Demo_Fecha_Hora.trim() === '') {
                    console.log(`📋 DEBUG: - Sin Demo_Fecha_Hora`);
                }
                if (!contact.source_url || contact.source_url.trim() === '') {
                    console.log(`📋 DEBUG: - Sin source_url`);
                }
            }

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
                eventCreated: eventCreated
            });
        }

        // Enriquecer objeto contact con datos del custom_data para createContact
        const enrichedContact = {
            ...contact,
            Demo_Fecha_Hora: contact.Demo_Fecha_Hora || custom_data.Demo_Fecha_Hora,
            local_demo: contact.local_demo || custom_data.local_demo,
            direccion_demo: contact.direccion_demo || custom_data.direccion_demo,
            source_url: contact.source_url || custom_data.source_url,
            calendar_id: contact.calendar_id || custom_data.calendar_id
        };

        // Si no existe, crear nuevo contacto
        const createSuccess = await createContact(enrichedContact);
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

        // Verificar si este contacto viene específicamente de un registro de demo ACTUAL/FUTURO
        // Registrar evento si tiene Demo_Fecha_Hora válida Y la fecha es actual/futura
        let eventCreated = false;

        // Buscar Demo_Fecha_Hora en el enrichedContact
        const demoFechaHora = enrichedContact.Demo_Fecha_Hora;

        if (demoFechaHora && demoFechaHora.trim() !== '') {

            // Función para parsear fechas en diferentes formatos
            const parseDemoDate = (dateStr) => {
                if (!dateStr) return null;

                // Intentar diferentes formatos de fecha
                const cleanDate = dateStr.trim();

                // Formato dd/mm/yyyy
                if (cleanDate.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
                    const [day, month, year] = cleanDate.split('/');
                    return new Date(year, month - 1, day); // month es 0-indexed
                }

                // Formato dd-mm-yyyy
                if (cleanDate.match(/^\d{1,2}-\d{1,2}-\d{4}$/)) {
                    const [day, month, year] = cleanDate.split('-');
                    return new Date(year, month - 1, day); // month es 0-indexed
                }

                // Formato yyyy-mm-dd (ISO)
                if (cleanDate.match(/^\d{4}-\d{1,2}-\d{1,2}$/)) {
                    return new Date(cleanDate);
                }

                // Formato ISO con hora (2025-09-30T11:00:00.000)
                if (cleanDate.match(/^\d{4}-\d{1,2}-\d{1,2}T/)) {
                    return new Date(cleanDate);
                }

                // Intentar parsing directo como fallback
                const fallbackDate = new Date(cleanDate);
                return isNaN(fallbackDate.getTime()) ? null : fallbackDate;
            };

            // Extraer la fecha (puede venir con formato ISO completo con hora)
            const demoDateStr = demoFechaHora.includes('T') ?
                demoFechaHora.split('T')[0] :
                demoFechaHora.split(' ')[0];

            const demoDate = parseDemoDate(demoFechaHora);

            // Normalizar fechas para comparar solo día, mes y año (sin hora)
            const today = new Date();
            const todayNormalized = new Date(today.getFullYear(), today.getMonth(), today.getDate());

            console.log(`📅 DEBUG: Parseando fecha de demo - Input: "${demoFechaHora}", Extracted date: "${demoDateStr}", Parsed: ${demoDate}, Valid: ${demoDate !== null && !isNaN(demoDate.getTime())}`);

            // Solo procesar si la demo es de HOY en adelante (no permitir fechas pasadas)
            if (demoDate && !isNaN(demoDate.getTime()) && demoDate >= todayNormalized) {
                console.log(`📅 DEBUG: Detectado registro de DEMO ACTUAL/FUTURO (${demoDateStr}), registrando evento de conversión...`);
                console.log(`📅 DEBUG: Demo_Fecha_Hora: ${demoFechaHora}`);
                console.log(`📅 DEBUG: source_url: ${enrichedContact.source_url || 'N/A'}`);

                // Determinar tipo de evento basado en la URL de origen (si existe)
                let eventName = 'demo'; // default
                const sourceUrl = enrichedContact.source_url;
                if (sourceUrl && sourceUrl.includes('demo-antel')) {
                    eventName = 'demo-antel';
                }

                console.log(`📅 DEBUG: Registrando evento: ${eventName} para ${contact.email}`);

                // Extraer fecha y hora para el evento
                let eventDate = demoDateStr;
                let eventTime = '';

                if (demoFechaHora.includes('T')) {
                    // Formato ISO: 2025-09-30T11:00:00.000
                    const dateObj = new Date(demoFechaHora);
                    eventTime = dateObj.toTimeString().substring(0, 5); // HH:MM
                } else if (demoFechaHora.includes(' ')) {
                    // Formato con espacio: 2025-09-30 11:00
                    eventTime = demoFechaHora.split(' ')[1] || '';
                }

                const eventSuccess = await createConversionEvent(contact.email, eventName, {
                    name: `${contact.firstname || ''} ${contact.lastname || ''}`.trim(),
                    email: contact.email,
                    phone: contact.phone || contact.mobile,
                    date: eventDate,
                    timeslot: eventTime,
                    local_demo: enrichedContact.local_demo || '',
                    direccion_demo: enrichedContact.direccion_demo || '',
                    state: contact.state || '',
                    city: contact.city || '',
                    source_url: sourceUrl || '',
                    calendar_id: enrichedContact.calendar_id || ''
                });

                eventCreated = eventSuccess;
                console.log(`📅 DEBUG: Resultado del evento: ${eventSuccess ? 'SUCCESS' : 'FAILED'}`);
            } else {
                if (demoDate && !isNaN(demoDate.getTime())) {
                    console.log(`📋 DEBUG: Demo PASADA detectada (${demoDateStr}, parsed: ${demoDate.toISOString().split('T')[0]}) - NO se registra evento de conversión para evitar duplicados`);
                } else {
                    console.log(`📋 DEBUG: Fecha de demo INVÁLIDA detectada (${demoDateStr}) - NO se registra evento de conversión`);
                }
            }
        } else {
            console.log(`📋 DEBUG: Contacto creado sin datos de demo válidos - NO se registra evento de conversión`);
            if (!demoFechaHora || demoFechaHora.trim() === '') {
                console.log(`📋 DEBUG: - Sin Demo_Fecha_Hora válida (contact: ${!!contact.Demo_Fecha_Hora}, custom_data: ${!!custom_data.Demo_Fecha_Hora})`);
            }
        }

        return res.status(201).json({
            success: true,
            action: 'CREATE',
            statusCode: 201,
            message: 'Contacto creado exitosamente en RD Station.',
            contact: {
                id: contactInfo.id,
                email: contact.email
            },
            eventCreated: eventCreated
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
        // Verificar credenciales antes de procesar
        if (!credentialsValid) {
            console.log(`❌ ERROR: Credenciales de RD Station no configuradas`);
            return res.status(500).json({
                success: false,
                statusCode: 500,
                error: 'Configuración de RD Station incompleta. Verificar variables de entorno.',
                credentialsStatus: getCredentialsStatus()
            });
        }

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

        try {
            existingContact = await findContactByEmail(email, contacto);
        } catch (error) {
            console.log(`❌ ERROR: Búsqueda fallida | ID=${contacto.id} | ${error.message}`);
            return res.status(500).json({
                success: false,
                statusCode: 500,
                error: 'Error al buscar contacto en RD Station.',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }

        if (!existingContact) {
            console.log(`📝 Contacto no encontrado en RD Station | ID=${contacto.id} | Email=${email}. Creando nuevo contacto...`);

            // Si no existe el contacto, crearlo
            try {
                // Preparar datos para crear nuevo contacto
                const phoneToUse = contacto.phone || contacto.mobile;

                const nuevoContacto = {
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
                    skype: contacto.skype,
                    googlePlus: contacto.googlePlus,
                    website: contacto.website,
                    cf_tem_ichef: validateTieneIchef(custom_data.tiene_ichef),
                    cf_score: parseNumber(contacto.score),
                    cf_stage: contacto.stage,
                    cf_owner: contacto.owner,
                    cf_participo_sdr: custom_data.participo_SDR || '',
                    cf_estado_sdr: custom_data.estado_sdr || '',
                    cf_local_demo: custom_data.local_demo,
                    cf_fecha_ag_demo: custom_data.fecha_ag_demo,
                    cf_horario_demo: custom_data.horario_demo,
                    cf_phone_local: custom_data.phoneLocal,
                    cf_phone_international: custom_data.phoneInternational,
                    cf_mobile_local: custom_data.mobileLocal,
                    cf_mobile_international: custom_data.mobileInternational,
                    importadoRD: "true"
                };

                // Crear el contacto usando la función createContact existente
                const createdContact = await createContact(nuevoContacto);

                if (createdContact) {
                    console.log(`✅ Contacto creado exitosamente en RD Station | ID=${contacto.id} | Email=${email}`);
                    return res.status(201).json({
                        success: true,
                        statusCode: 201,
                        action: 'created',
                        message: 'Contacto creado exitosamente en RD Station.',
                        contact: {
                            id: contacto.id,
                            email: email,
                            rd_station_id: createdContact.uuid
                        }
                    });
                } else {
                    throw new Error('No se pudo crear el contacto en RD Station');
                }
            } catch (createError) {
                console.log(`❌ ERROR: No se pudo crear contacto en RD Station | ID=${contacto.id} | Error=${createError.message}`);
                return res.status(500).json({
                    success: false,
                    statusCode: 500,
                    error: 'Error al crear contacto en RD Station.',
                    details: process.env.NODE_ENV === 'development' ? createError.message : undefined,
                    contact: {
                        id: contacto.id,
                        email: email
                    }
                });
            }
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

        // Verificar si hay datos de demo para crear evento de conversión
        let eventCreated = false;
        if (custom_data.Demo_Fecha_Hora && custom_data.Demo_Fecha_Hora.trim() !== '') {

            // Función para parsear fechas en diferentes formatos
            const parseDemoDate = (dateStr) => {
                if (!dateStr) return null;

                // Intentar diferentes formatos de fecha
                const cleanDate = dateStr.trim();

                // Formato dd/mm/yyyy
                if (cleanDate.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
                    const [day, month, year] = cleanDate.split('/');
                    return new Date(year, month - 1, day); // month es 0-indexed
                }

                // Formato dd-mm-yyyy
                if (cleanDate.match(/^\d{1,2}-\d{1,2}-\d{4}$/)) {
                    const [day, month, year] = cleanDate.split('-');
                    return new Date(year, month - 1, day); // month es 0-indexed
                }

                // Formato yyyy-mm-dd (ISO)
                if (cleanDate.match(/^\d{4}-\d{1,2}-\d{1,2}$/)) {
                    return new Date(cleanDate);
                }

                // Formato ISO con hora (2025-09-30T11:00:00.000)
                if (cleanDate.match(/^\d{4}-\d{1,2}-\d{1,2}T/)) {
                    return new Date(cleanDate);
                }

                // Intentar parsing directo como fallback
                const fallbackDate = new Date(cleanDate);
                return isNaN(fallbackDate.getTime()) ? null : fallbackDate;
            };

            // Extraer la fecha (puede venir con formato ISO completo con hora)
            const demoDateStr = custom_data.Demo_Fecha_Hora.includes('T') ?
                custom_data.Demo_Fecha_Hora.split('T')[0] :
                custom_data.Demo_Fecha_Hora.split(' ')[0];

            const demoDate = parseDemoDate(custom_data.Demo_Fecha_Hora);

            // Normalizar fechas para comparar solo día, mes y año (sin hora)
            const today = new Date();
            const todayNormalized = new Date(today.getFullYear(), today.getMonth(), today.getDate());

            console.log(`📅 DEBUG: Verificando demo en actualización - Input: "${custom_data.Demo_Fecha_Hora}", Extracted date: "${demoDateStr}", Parsed: ${demoDate}, Valid: ${demoDate !== null && !isNaN(demoDate.getTime())}`);

            // Solo procesar si la demo es de HOY en adelante (no permitir fechas pasadas)
            if (demoDate && !isNaN(demoDate.getTime()) && demoDate >= todayNormalized) {
                console.log(`📅 DEBUG: Detectado DEMO ACTUAL/FUTURO en actualización (${demoDateStr}), registrando evento de conversión...`);
                console.log(`📅 DEBUG: Demo_Fecha_Hora: ${custom_data.Demo_Fecha_Hora}`);
                console.log(`📅 DEBUG: local_demo: ${custom_data.local_demo || 'N/A'}`);

                // Determinar tipo de evento (por defecto demo)
                let eventName = 'demo';

                console.log(`📅 DEBUG: Registrando evento: ${eventName} para ${email}`);

                // Extraer fecha y hora para el evento
                let eventDate = demoDateStr;
                let eventTime = '';

                if (custom_data.Demo_Fecha_Hora.includes('T')) {
                    // Formato ISO: 2025-09-30T11:00:00.000
                    const dateObj = new Date(custom_data.Demo_Fecha_Hora);
                    eventTime = dateObj.toTimeString().substring(0, 5); // HH:MM
                } else if (custom_data.Demo_Fecha_Hora.includes(' ')) {
                    // Formato con espacio: 2025-09-30 11:00
                    eventTime = custom_data.Demo_Fecha_Hora.split(' ')[1] || '';
                }

                const eventSuccess = await createConversionEvent(email, eventName, {
                    name: `${contacto.firstname || ''} ${contacto.lastname || ''}`.trim(),
                    email: email,
                    phone: contacto.phone || contacto.mobile,
                    date: eventDate,
                    timeslot: eventTime,
                    local_demo: custom_data.local_demo || '',
                    direccion_demo: custom_data.direccion_demo || '',
                    state: contacto.state || '',
                    city: contacto.city || '',
                    source_url: '', // No requerido para actualizaciones
                    calendar_id: ''
                });

                eventCreated = eventSuccess;
                console.log(`📅 DEBUG: Resultado del evento en actualización: ${eventSuccess ? 'SUCCESS' : 'FAILED'}`);
            } else {
                if (demoDate && !isNaN(demoDate.getTime())) {
                    console.log(`📋 DEBUG: Demo PASADA detectada en actualización (${demoDateStr}, parsed: ${demoDate.toISOString().split('T')[0]}) - NO se registra evento de conversión`);
                } else {
                    console.log(`📋 DEBUG: Fecha de demo INVÁLIDA detectada en actualización (${custom_data.Demo_Fecha_Hora}) - NO se registra evento de conversión`);
                }
            }
        } else {
            console.log(`📋 DEBUG: Contacto actualizado sin datos de demo válidos - NO se registra evento de conversión`);
        }

        console.log(`✅ ACTUALIZADO: ID=${contacto.id} | ${email} | UUID=${existingContact.uuid}${eventCreated ? ' | EVENTO CREADO' : ''}`);
        return res.status(200).json({
            success: true,
            statusCode: 200,
            message: 'Contacto actualizado exitosamente en RD Station.',
            contact: {
                id: contacto.id,
                email: email,
                uuid: existingContact.uuid
            },
            eventCreated: eventCreated
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
    console.log(`🔧 DEBUG: Iniciando createConversionEvent`);
    console.log(`📧 Email: ${email}`);
    console.log(`🎯 Event Name: ${eventName}`);
    console.log(`📊 Event Data:`, JSON.stringify(eventData, null, 2));

    // Verificar credenciales antes de proceder
    if (!credentialsValid) {
        console.error(`❌ DEBUG: Credenciales de RD Station no válidas`);
        return false;
    }

    if (!credenciales.access_token) {
        console.log(`⚠️ DEBUG: Access token no disponible, intentando renovar...`);

        try {
            const refreshSuccess = await refreshAccessToken();
            if (!refreshSuccess) {
                console.error(`❌ DEBUG: No se pudo renovar el access token`);
                return false;
            }
            console.log(`✅ DEBUG: Access token renovado exitosamente`);
        } catch (error) {
            console.error(`❌ DEBUG: Error al renovar access token:`, error.message);
            return false;
        }
    }

    const apiCall = async () => {
        // Estructura correcta según la documentación oficial de RD Station
        const payload = {
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
            traffic_source: eventData.source_url || '',
            // Bases legales de consentimiento
            legal_bases: [
                {
                    category: "communications",
                    type: "consent",
                    status: "granted"
                }
            ]
        };


        // URL correcta según documentación
        const response = await axios.post(
            `${RD_STATION_CONFIG.API_BASE_URL}/platform/events`,
            {
                event_type: "CONVERSION",
                event_family: "CDP",
                payload: payload
            },
            {
                headers: {
                    'Authorization': `Bearer ${credenciales.access_token}`,
                    'Content-Type': 'application/json',
                    'accept': 'application/json'
                }
            }
        );

        console.log(`✅ DEBUG: Respuesta de RD Station:`, {
            status: response.status,
            statusText: response.statusText,
            data: response.data
        });

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
        console.error(`❌ Full error:`, error);
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
        // Verificar credenciales antes de procesar
        if (!credentialsValid) {
            console.log(`❌ ERROR: Credenciales de RD Station no configuradas`);
            return res.status(500).json({
                success: false,
                statusCode: 500,
                error: 'Configuración de RD Station incompleta. Verificar variables de entorno.',
                credentialsStatus: getCredentialsStatus()
            });
        }

        const demoData = req.body;
        const demo_fecha_hora_utc = demoData.Demo_Fecha_Hora || null;

        console.log('📩 Demo recibido:', {
            email: demoData.email,
            name: demoData.name,
            date: demoData.date,
            timeslot: demoData.timeslot,
            source_url: demoData.source_url,
            demoFechaHora: demoData.Demo_Fecha_Hora,
            localDemo: demoData.local_demo,
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

        // Formatear demoFechaHora a formato legible en español
        // La fecha viene en hora LOCAL de Uruguay, no hacer conversión de zona horaria
        if (demoData.Demo_Fecha_Hora) {
            // Parsear la fecha asumiendo que ya está en hora local
            const dateStr = demoData.Demo_Fecha_Hora;
            const date = new Date(dateStr);

            // Extraer componentes de fecha sin conversión de zona horaria
            const year = date.getFullYear();
            const month = date.getMonth();
            const day = date.getDate();
            const hours = date.getHours();
            const minutes = date.getMinutes();

            // Nombres de meses en español
            const monthNames = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

            // Formatear manualmente para evitar conversiones de zona horaria
            const formattedDate = `${day} de ${monthNames[month]} de ${year} a las ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
            demoData.Demo_Fecha_Hora = formattedDate;
            console.log(`📅 Demo_Fecha_Hora formateada: ${demoData.Demo_Fecha_Hora}`);
        }


        // Preparar datos del contacto para buscar/crear
        const contactData = {
            email: cleanEmail(demoData.email),
            firstname: demoData.name,
            lastname: demoData.lastname || '',
            phone: demoData.phone,
            state: demoData.state,
            city: demoData.city,
            Demo_Fecha_Hora: demoData.Demo_Fecha_Hora,
            demo_fecha_hora_utc: demo_fecha_hora_utc,
            direccion_demo: demoData.direccion_demo,
            local_demo: demoData.local_demo,
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
            console.log(`❌ Error en búsqueda de contacto: ${error.message}`);
            // Continuar con la creación si no se puede buscar
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
        console.log(`📅 DEBUG: Iniciando creación de evento de conversión`);
        console.log(`📅 DEBUG: eventName=${eventName}`);
        console.log(`📅 DEBUG: emailToUse=${emailToUse}`);
        console.log(`📅 DEBUG: contactAction=${contactAction}`);

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

        console.log(`📅 DEBUG: Resultado del evento de conversión: ${eventSuccess ? 'SUCCESS' : 'FAILED'}`);

        const responseData = {
            success: true,
            statusCode: 200,
            message: 'Demo registrado exitosamente.',
            data: {
                email: emailToUse,
                contactAction: contactAction,
                eventName: eventName,
                eventCreated: eventSuccess
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


/**
 * Función para obtener el estado del circuit breaker (útil para debugging)
 * @returns {Object} - Estado actual del circuit breaker
 */
const getCircuitBreakerStatus = () => {
    const now = Date.now();
    const timeToReset = circuitBreaker.lastFailureTime ?
        Math.max(0, circuitBreaker.resetTimeout - (now - circuitBreaker.lastFailureTime)) : 0;

    return {
        isOpen: circuitBreaker.isOpen,
        failureCount: circuitBreaker.failureCount,
        lastFailureTime: circuitBreaker.lastFailureTime,
        timeToResetMs: timeToReset,
        timeToResetMinutes: Math.ceil(timeToReset / 1000 / 60),
        canMakeRequest: circuitBreaker.canMakeRequest()
    };
};

/**
 * Función para resetear manualmente el circuit breaker (útil para testing/debugging)
 */
const resetCircuitBreaker = () => {
    console.log('🔄 Circuit breaker reseteado manualmente');
    circuitBreaker.reset();
};

/**
 * Función de test para el endpoint de eventos de conversión
 * @param {Object} req - Objeto de solicitud de Express
 * @param {Object} res - Objeto de respuesta de Express
 */
const testConversionEvent = async (req, res) => {
    try {
        console.log('🧪 TEST: Iniciando prueba de evento de conversión');

        // Datos de prueba
        const testEmail = 'test@rdstation.com';
        const testEventName = 'demo-test';
        const testEventData = {
            name: 'Usuario de Prueba',
            phone: '+59899123456',
            date: '2025-01-15',
            timeslot: '14:00',
            source_url: 'https://test.com/demo',
            state: 'Montevideo',
            city: 'Montevideo'
        };

        console.log('🧪 TEST: Verificando credenciales...');
        const credStatus = getCredentialsStatus();
        console.log('🧪 TEST: Estado de credenciales:', credStatus);

        if (!credentialsValid) {
            return res.status(500).json({
                success: false,
                error: 'Credenciales no válidas',
                credentialsStatus: credStatus
            });
        }

        console.log('🧪 TEST: Llamando a createConversionEvent...');
        const result = await createConversionEvent(testEmail, testEventName, testEventData);

        return res.status(200).json({
            success: true,
            message: 'Test de evento de conversión completado',
            result: result,
            testData: {
                email: testEmail,
                eventName: testEventName,
                eventData: testEventData
            }
        });

    } catch (error) {
        console.error('🧪 TEST: Error durante la prueba:', error);
        return res.status(500).json({
            success: false,
            error: 'Error durante el test',
            details: error.message
        });
    }
};

/**
 * Normaliza un número de teléfono uruguayo al formato internacional
 * @param {string} phone - Número de teléfono sin formato
 * @returns {string|null} - Número normalizado con prefijo internacional o null si es inválido
 */
const normalizeUruguayanPhone = (phone) => {
    if (!phone) return null;

    // Limpiar el teléfono de todo excepto dígitos
    let cleanPhone = phone.replace(/\D/g, '');

    // Si ya tiene el código de país, validar longitud
    if (cleanPhone.startsWith('598')) {
        // Uruguay: +598 + 8 o 9 dígitos = 11 o 12 dígitos totales
        if (cleanPhone.length === 11 || cleanPhone.length === 12) {
            return cleanPhone;
        }
        return null; // Formato inválido
    }

    // Si es un número uruguayo sin código de país
    // Celulares: 09X XXXXXX (9 dígitos) -> +598 9X XXXXXX
    // Fijos: 0X XXX XXXX (9 dígitos) -> +598 X XXX XXXX
    if (cleanPhone.length === 9 && cleanPhone.startsWith('0')) {
        return '598' + cleanPhone.substring(1); // Quitar el 0 inicial y agregar 598
    }

    // Si tiene 8 dígitos y empieza con 9 (celular sin el 0)
    if (cleanPhone.length === 8 && cleanPhone.startsWith('9')) {
        return '598' + cleanPhone;
    }

    // Si tiene 8 dígitos y NO empieza con 9 (fijo sin el 0)
    if (cleanPhone.length === 8 && !cleanPhone.startsWith('9')) {
        return '598' + cleanPhone;
    }

    // Otros casos: intentar agregar 598 si tiene una longitud razonable
    if (cleanPhone.length >= 8 && cleanPhone.length <= 9) {
        return '598' + cleanPhone;
    }

    console.log(`⚠️ Número de teléfono con formato no reconocido: ${phone}`);
    return null;
};


const actualizacionFirmwareNh2025101735 = async (req, res) => {
    const reqId = Math.random().toString(36).substring(7);

    // --- Configuración e Identificación ---
    const CHATWOOT_BASE_URL = process.env.CHATWOOT_URL;
    const CHATWOOT_TOKEN = process.env.API_ACCESS_TOKEN;
    const CHATWOOT_ACCOUNT_ID = 2;

    // Procesar identificación única
    let dataEntry = req.body;
    if (dataEntry.leads && Array.isArray(dataEntry.leads) && dataEntry.leads.length > 0) {
        dataEntry = dataEntry.leads[0];
    } else if (dataEntry.contact) {
        dataEntry = dataEntry.contact;
    }

    const rawPhone = dataEntry.mobile_phone || dataEntry.personal_phone || dataEntry.tele_movil || dataEntry.phone || dataEntry.phone_number || '';
    const cleanPhone = normalizeUruguayanPhone(rawPhone);
    const rawEmail = dataEntry.email || '';

    // Validar que el número de teléfono sea válido
    if (!cleanPhone) {
        console.log(`❌ [${reqId}] Número de teléfono inválido: ${rawPhone}`);
        return res.status(400).json({
            success: false,
            message: 'Número de teléfono inválido o formato no reconocido',
            phone: rawPhone
        });
    }

    // Identificador único para el bloqueo (teléfono es lo más confiable para WhatsApp)
    const lockKey = cleanPhone || rawEmail;

    console.log(`🚀 [${reqId}] REQUEST PROCESANDO - Tel: ${rawPhone} → ${cleanPhone}`);

    if (!lockKey) {
        return res.status(400).json({ message: 'No se pudo identificar un ID único (Teléfono o Email)' });
    }

    // --- NIVEL 1: BLOQUEO ATÓMICO DE SISTEMA DE ARCHIVOS (File System Lock) ---
    // Este bloqueo funciona entre procesos y reinicios, mucho más robusto que la memoria RAM.
    const locksDir = path.join(__dirname, '../locks_temp');
    if (!fs.existsSync(locksDir)) {
        try { fs.mkdirSync(locksDir, { recursive: true }); } catch (e) { }
    }

    const lockFilePath = path.join(locksDir, `lock_${lockKey}.lock`);
    let hasLock = false;
    let keepLock = false; // Flag para mantener el lock en caso de éxito

    try {
        // 'wx' flag = Open file for writing. The file is created (if it does not exist) or fails (if it exists).
        // Esta operación es ATÓMICA en el sistema operativo.
        fs.writeFileSync(lockFilePath, JSON.stringify({ pid: process.pid, time: Date.now() }), { flag: 'wx' });
        hasLock = true;
        console.log(`🔒 [${reqId}] Lock de archivo adquirido exitosamente.`);
    } catch (err) {
        if (err.code === 'EEXIST') {
            // El archivo ya existe. Verificar si es viejo (stale lock).
            try {
                const stats = fs.statSync(lockFilePath);
                const now = Date.now();
                const lockAge = now - stats.mtimeMs;

                // AUMENTADO A 60 MINUTOS (3600000 ms) para evitar reintentos de webhook
                if (lockAge > 3600000) {
                    console.warn(`♻️ [${reqId}] Lock expirado (${Math.round(lockAge / 60000)}min). Reclamando...`);
                    try {
                        fs.unlinkSync(lockFilePath); // Borrar
                        fs.writeFileSync(lockFilePath, JSON.stringify({ pid: process.pid, time: Date.now() }), { flag: 'wx' }); // Re-escribir
                        hasLock = true;
                    } catch (retryErr) {
                        console.warn(`⚠️ [${reqId}] Falló reclamo de lock: ${retryErr.message}`);
                        return res.status(200).json({ success: true, message: 'Procesado concurrentemente (race lost on retry).', skipped: true });
                    }
                } else {
                    console.warn(`🔒 [BLOCK FS] [${reqId}] Proceso bloqueado por archivo lock existente (${Math.round(lockAge / 1000)}s old).`);
                    return res.status(200).json({ success: true, message: 'Solicitud bloqueada por concurrencia (File Lock).', skipped: true });
                }
            } catch (statErr) {
                // Error leyendo stat, asumimos bloqueado para seguridad
                return res.status(200).json({ success: true, message: 'Error verificando lock.', skipped: true });
            }
        } else {
            console.error(`❌ [${reqId}] Error de sistema de archivos: ${err.message}`);
            return res.status(500).json({ message: 'Error interno de filesystem' });
        }
    }

    // SI LLEGAMOS AQUÍ, TENEMOS EL LOCK EXCLUSIVO 🔒

    try {
        if (!CHATWOOT_BASE_URL || !CHATWOOT_TOKEN) throw new Error('Faltan variables de entorno Chatwoot');

        const chatwootApi = axios.create({
            baseURL: `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}`,
            headers: { 'api_access_token': CHATWOOT_TOKEN, 'Content-Type': 'application/json' }
        });

        // 1. Buscar Contacto
        let contact = null;
        console.log(`🔎 [${reqId}] Buscando contacto...`);

        // Búsqueda robusta (primero ID externo si existe en data, luego phone, luego email)
        if (cleanPhone) {
            const searchRes = await chatwootApi.get(`/contacts/search`, { params: { q: cleanPhone } });
            if (searchRes.data.payload?.length > 0) contact = searchRes.data.payload[0];
        }
        if (!contact && rawEmail) {
            const searchRes = await chatwootApi.get(`/contacts/search`, { params: { q: rawEmail } });
            if (searchRes.data.payload?.length > 0) contact = searchRes.data.payload[0];
        }

        // Si no se encuentra, CREAR el contacto
        if (!contact) {
            console.log(`📝 [${reqId}] Contacto no encontrado. Creando nuevo contacto...`);

            const newContactData = {
                name: dataEntry.name || dataEntry.nombre || `Usuario ${cleanPhone}`,
                phone_number: cleanPhone ? `+${cleanPhone}` : undefined,
                email: rawEmail || undefined,
                identifier: cleanPhone || rawEmail
            };

            // Eliminar campos undefined
            Object.keys(newContactData).forEach(key =>
                newContactData[key] === undefined && delete newContactData[key]
            );

            try {
                const createResp = await chatwootApi.post(`/contacts`, newContactData);
                contact = createResp.data?.payload || createResp.data;
                console.log(`✅ [${reqId}] Contacto creado exitosamente: ID ${contact.id}`);
            } catch (createErr) {
                console.error(`❌ [${reqId}] Error al crear contacto: ${createErr.message}`);
                return res.status(500).json({
                    message: 'Error al crear contacto en Chatwoot',
                    error: createErr.message
                });
            }
        }

        // 2. Verificar Etiquetas Persistentes
        const checkContactReq = await chatwootApi.get(`/contacts/${contact.id}`);
        const initialLabels = checkContactReq.data.payload?.labels || checkContactReq.data?.labels || [];

        if (initialLabels.includes('msg_firmware_sent')) {
            console.log(`⏭️ [${reqId}] Contacto ya tiene etiqueta 'msg_firmware_sent'.`);
            return res.status(200).json({ success: true, message: 'Ya procesado anteriormente.', skipped: true });
        }

        // 3. Enviar WhatsApp (Evolution API)
        const whatsappMessage = "🚀 ¡iChef se actualiza y cocina sin límites!\n\nEstamos lanzando una nueva actualización de iChef, que llegará automáticamente a tu robot en los próximos días.\nLa gran novedad: ¡ahora tendrás autonomía total de uso sin depender de internet! 🌐❌\n\n✅ Cocina donde quieras y cuando quieras.\n✅ Mejor rendimiento y mayor estabilidad.\n✅ 100% independiente.\n\n📡 ¿Qué tenés que hacer?\nSolo asegurarte de que tu robot esté conectado al Wi-Fi y no esté operando durante unos minutos.\nCuando la actualización esté disponible, aparecerá un mensaje en pantalla para instalarla.\n\n👉 Si el mensaje no aparece, ingresá en Configuración → Actualización del Sistema.\nSi allí figura una actualización disponible, presioná Actualización inmediata para comenzar la instalación.\n\n¡Liberá todo el potencial de tu cocina con iChef! 👨‍🍳🔥\n\n📞 ¿Necesitás ayuda?\nContactá a nuestro Servicio de Asistencia al Usuario: *097 107 658*";

        console.log(`📤 [${reqId}] Enviando mensaje Evolution a ${cleanPhone}...`);
        try {
            await axios.post('https://evolution-evolution.5vsa59.easypanel.host/message/sendText/iChef%20Center%20Wpp', {
                number: cleanPhone, text: whatsappMessage
            }, { headers: { 'apikey': '49C2506BEDA7-46A6-8EC3-C8ABD1EA0551' } });
            console.log(`✅ [${reqId}] Mensaje enviado.`);
        } catch (evolutionErr) {
            console.error(`❌ [${reqId}] Error al enviar mensaje de WhatsApp: ${evolutionErr.message}`);
            console.error(`📞 [${reqId}] Número utilizado: ${cleanPhone}`);
            if (evolutionErr.response?.data) {
                console.error(`📋 [${reqId}] Respuesta de Evolution:`, JSON.stringify(evolutionErr.response.data, null, 2));
            }
            throw evolutionErr; // Re-lanzar para que sea manejado en el catch principal
        }

        // 4. Gestión de Conversación (Anti-Duplicados)
        // BUSCAR primero si ya existe una conversación abierta en este inbox para no crear duplicados
        let conversation = null;
        try {
            const convSearch = await chatwootApi.get(`/contacts/${contact.id}/conversations`);
            const existingConvs = convSearch.data.payload || convSearch.data || [];
            // Buscar una abierta en el inbox 41
            conversation = existingConvs.find(c => c.inbox_id === 41 && c.status === 'open');
        } catch (ignored) { }

        if (conversation) {
            console.log(`♻️ [${reqId}] Usando conversación existente ID: ${conversation.id}`);
        } else {
            console.log(`🆕 [${reqId}] Creando nueva conversación...`);
            const convRes = await chatwootApi.post('/conversations', {
                contact_id: contact.id,
                inbox_id: 41,
                assignee_id: 19,
                team_id: 4,
                status: 'open'
            });
            conversation = convRes.data;
        }

        // 5. Agregar mensaje interno/saliente a la conversación
        try {
            await chatwootApi.post(`/conversations/${conversation.id}/messages`, {
                content: "Contactar y asistir en la actualización del firmware. Versión instalada: NH-20250415.26 Versión a actualizar: NH-20251017.35",
                message_type: 'outgoing', // O 'private' si es nota interna
                private: false
            });
        } catch (msgErr) { console.error(`⚠️ [${reqId}] Error creando mensaje: ${msgErr.message}`); }

        // 6. Finalizar Etiquetas
        // Conservar todas las etiquetas existentes y agregar solo las que faltan
        const tagsToAdd = ['tiene_ichef', 'msg_firmware_sent'];
        const newLabels = [...new Set([...initialLabels, ...tagsToAdd])]; // Unión sin duplicados

        console.log(`🏷️ [${reqId}] Etiquetas existentes: ${initialLabels.join(', ') || 'ninguna'}`);
        console.log(`🏷️ [${reqId}] Etiquetas finales: ${newLabels.join(', ')}`);

        await chatwootApi.post(`/contacts/${contact.id}/labels`, { labels: newLabels });

        // Para la conversación, solo agregar las nuevas etiquetas sin sobrescribir
        await chatwootApi.post(`/conversations/${conversation.id}/labels`, { labels: tagsToAdd });

        // Marcar éxito y programar liberación del lock después de 2 minutos
        keepLock = true;
        console.log(`🔒 [${reqId}] Proceso exitoso. Lock se liberará automáticamente en 2 minutos.`);

        // Liberar el lock automáticamente después de 2 minutos para evitar bloqueos permanentes
        setTimeout(() => {
            try {
                if (fs.existsSync(lockFilePath)) {
                    fs.unlinkSync(lockFilePath);
                    console.log(`🔓 [${reqId}] Lock liberado automáticamente después de timeout (2 min).`);
                }
            } catch (cleanupErr) {
                console.error(`⚠️ [${reqId}] Error al liberar lock automáticamente:`, cleanupErr.message);
            }
        }, 120000); // 2 minutos

        res.status(200).json({ success: true, contactId: contact.id });

    } catch (error) {
        console.error(`❌ [${reqId}] Error General: ${error.message}`);
        console.error(`📋 [${reqId}] Stack:`, error.stack);
        if (error.response) {
            console.error(`📋 [${reqId}] Response status: ${error.response.status}`);
            console.error(`📋 [${reqId}] Response data:`, JSON.stringify(error.response.data, null, 2));
        }
        res.status(500).json({
            success: false,
            error: error.message,
            details: error.response?.data
        });
    } finally {
        // En el bloque finally, solo liberamos el lock si NO hubo éxito (para permitir reintentos en caso de error)
        try {
            if (hasLock && !keepLock && fs.existsSync(lockFilePath)) {
                fs.unlinkSync(lockFilePath);
                console.log(`🔓 [${reqId}] Lock de archivo liberado (ERROR o FALLO).`);
            }
        } catch (cleanupErr) {
            console.error(`⚠️ [${reqId}] Error liberando lock: ${cleanupErr.message}`);
        }
    }
};



/**
 * Normaliza un número de teléfono al formato internacional con doble cero y con plus
 * Ejemplo: '+598 097 090 046' -> { doubleZero: '0059897090046', plus: '+59897090046' }
 * @param {string} phone - Número de teléfono en cualquier formato
 * @returns {Object|null} - Objeto con formatos { doubleZero: '00598XXXXXXXX', plus: '+598XXXXXXXX' } o null si es inválido
 */
const normalizePhoneToDoubleZero = (phone) => {
    if (!phone) return null;

    // Limpiar el teléfono de todo excepto dígitos
    let cleanPhone = phone.replace(/\D/g, '');

    // Si ya tiene el formato completo 00598XXXXXXXX (13 dígitos empezando con 00598)
    if (cleanPhone.startsWith('00598') && cleanPhone.length >= 12 && cleanPhone.length <= 13) {
        const localNumber = cleanPhone.substring(5); // Remover 00598
        return {
            doubleZero: cleanPhone,
            plus: '+598' + localNumber
        };
    }

    // Si empieza con 598 (formato internacional sin los ceros)
    if (cleanPhone.startsWith('598')) {
        cleanPhone = cleanPhone.substring(3); // Remover el 598
    }

    // Si empieza con 0 (formato local uruguayo)
    if (cleanPhone.startsWith('0') && cleanPhone.length === 9) {
        cleanPhone = cleanPhone.substring(1); // Remover el 0 inicial
    }

    // Ahora cleanPhone debería tener 8 dígitos (el número local sin prefijos)
    // Devolver ambos formatos
    if (cleanPhone.length === 8) {
        return {
            doubleZero: '00598' + cleanPhone,
            plus: '+598' + cleanPhone
        };
    }

    // Si tiene 9 dígitos, ya está en formato local completo (ej: 097090046)
    if (cleanPhone.length === 9) {
        return {
            doubleZero: '00598' + cleanPhone,
            plus: '+598' + cleanPhone
        };
    }

    console.log(`⚠️ No se pudo normalizar el teléfono: ${phone} -> ${cleanPhone}`);
    return null;
};

const expoDgusto = async (req, res) => {

    console.log('═══════════════════════════════════════════════════════════');
    console.log('🎯 ENDPOINT: /api/rd-station/expo-dgusto INVOCADO');
    console.log('⏰ Timestamp:', new Date().toISOString());
    console.log('═══════════════════════════════════════════════════════════');
    console.log('Datos recibidos en /api/rd-station:', req.body);
    const datos_contacto = req.body;

    // Validar que existan leads
    if (!datos_contacto.leads || !Array.isArray(datos_contacto.leads) || datos_contacto.leads.length === 0) {
        console.error('❌ ERROR: No se encontraron leads en los datos recibidos');
        console.error('   Body keys:', Object.keys(datos_contacto));
        return res.status(400).json({
            success: false,
            error: 'No se encontraron leads en los datos recibidos'
        });
    }

    console.log(`✅ Leads detectados: ${datos_contacto.leads.length} lead(s)`);

    const lead = datos_contacto.leads[0];

    // Extraer y normalizar el teléfono
    const rawPhone = lead.mobile_phone || lead.personal_phone || lead.phone;
    const normalizedPhones = normalizePhoneToDoubleZero(rawPhone);

    console.log(`📞 Teléfono original: ${rawPhone}`);
    if (normalizedPhones) {
        console.log(`📞 Teléfono formato 00: ${normalizedPhones.doubleZero}`);
        console.log(`📞 Teléfono formato +: ${normalizedPhones.plus}`);
    }

    // Log de información adicional
    console.log('📧 Email:', lead.email);
    console.log('👤 Nombre:', lead.name);
    console.log('🆔 UUID:', lead.uuid);
    console.log('first_conversion', lead.first_conversion);
    console.log('last_conversion', lead.last_conversion);
    console.log('custom_fields', lead.custom_fields);


    // Procesar el lead en el portal de recetas si corresponde
    const lastConversion = lead.last_conversion || lead.first_conversion;
    const conversionIdentifier = lastConversion?.content?.conversion_identifier || 
                                 lastConversion?.content?.event_identifier ||
                                 lastConversion?.source;

    console.log(`🔍 Conversion Identifier: "${conversionIdentifier}"`);
    
    if (conversionIdentifier !== 'ichef-portal-de-recetas-gratuito') {
        console.log(`ℹ️  Este lead NO es del Portal de Recetas`);
        console.log(`   No se requiere registro adicional`);
    }

    // Solo procesar si es del portal de recetas
    if (conversionIdentifier === 'ichef-portal-de-recetas-gratuito') {
        console.log('🍳 Lead del Portal de Recetas detectado - Iniciando registro...');
        console.log(`📋 Lead ID: ${lead.id} | Email: ${lead.email} | UUID: ${lead.uuid}`);

        if (!normalizedPhones) {
            console.error('❌ No se pudo normalizar el teléfono para el portal de recetas');
            console.error(`   Teléfono original: ${rawPhone}`);
            return res.status(400).json({
                success: false,
                error: 'No se pudo normalizar el número de teléfono',
                phone: rawPhone
            });
        }

        // Dividir el nombre en nombre y apellido
        const fullName = lead.name || '';
        const nameParts = fullName.trim().split(' ');
        const nombre = nameParts[0] || '';
        const apellido = nameParts.slice(1).join(' ') || '';

        console.log(`👤 Nombre completo: "${fullName}" → Nombre: "${nombre}" | Apellido: "${apellido}"`);

        // Preparar los datos para la API del portal
        // IMPORTANTE: clientId tiene un límite de 8 caracteres en el Portal
        const clientIdOriginal = String(lead.id);
        const clientIdTruncated = clientIdOriginal.substring(0, 8);
        
        const portalData = {
            nombre: nombre,
            apellido: apellido,
            cellphone: normalizedPhones.plus, // Usar formato +598XXXXXXXX
            email: lead.email,
            clientId: clientIdTruncated
        };

        if (clientIdOriginal.length > 8) {
            console.log(`⚠️ Client ID truncado: "${clientIdOriginal}" → "${clientIdTruncated}" (máx 8 caracteres)`);
        }

        console.log('📤 Enviando datos al Portal de Recetas:', JSON.stringify(portalData, null, 2));
        console.log(`🔗 URL: https://www.ichef.uy:8443/ICHEF-WAR/usuarios/register_guest`);

        try {
            // Llamar a la API del portal de recetas
            console.log(`⏳ Iniciando petición HTTP POST...`);
            const startTime = Date.now();
            
            const portalResponse = await axios.post(
                'https://www.ichef.uy:8443/ICHEF-WAR/usuarios/register_guest',
                portalData,
                {
                    headers: {
                        'Content-Type': 'application/json; charset=UTF-8'
                    },
                    timeout: 15000 // 15 segundos de timeout
                }
            );

            const duration = Date.now() - startTime;
            console.log(`✅ Respuesta recibida del Portal en ${duration}ms`);
            console.log('📥 Status Code:', portalResponse.status);
            console.log('📥 Respuesta del Portal de Recetas:', JSON.stringify(portalResponse.data, null, 2));

            // Verificar si el registro fue exitoso
            if (portalResponse.data.code === 200) {
                console.log(`✅ ¡REGISTRO EXITOSO EN PORTAL DE RECETAS!`);
                console.log(`   Lead ID: ${lead.id}`);
                console.log(`   Email: ${lead.email}`);
                console.log(`   User ID Portal: ${portalResponse.data.message}`);
                console.log('═══════════════════════════════════════════════════════════');
                
                // Enviar respuesta exitosa con información del portal
                return res.status(200).json({
                    success: true,
                    message: 'Lead procesado y registrado en Portal de Recetas exitosamente',
                    data: {
                        email: lead.email,
                        name: lead.name,
                        phone_original: rawPhone,
                        phone_normalized_00: normalizedPhones.doubleZero,
                        phone_normalized_plus: normalizedPhones.plus,
                        uuid: lead.uuid,
                        portal_registration: {
                            success: true,
                            user_id: portalResponse.data.message,
                            message: 'Usuario registrado en Portal de Recetas'
                        }
                    }
                });
            } else {
                console.error(`⚠️ Respuesta no exitosa del Portal de Recetas`);
                console.error(`   Code recibido: ${portalResponse.data.code}`);
                console.error(`   Message: ${portalResponse.data.message}`);
                console.error(`   Lead ID: ${lead.id}`);
                console.error(`   Email: ${lead.email}`);
                console.log('═══════════════════════════════════════════════════════════');
                
                // Enviar respuesta con advertencia
                return res.status(200).json({
                    success: true,
                    message: 'Lead procesado pero hubo un problema al registrar en Portal de Recetas',
                    data: {
                        email: lead.email,
                        name: lead.name,
                        phone_original: rawPhone,
                        phone_normalized_00: normalizedPhones.doubleZero,
                        phone_normalized_plus: normalizedPhones.plus,
                        uuid: lead.uuid,
                        portal_registration: {
                            success: false,
                            code: portalResponse.data.code,
                            message: portalResponse.data.message,
                            errors: portalResponse.data.errors
                        }
                    }
                });
            }
        } catch (portalError) {
            console.error('❌ ERROR AL LLAMAR A LA API DEL PORTAL DE RECETAS');
            console.error(`   Lead ID: ${lead.id}`);
            console.error(`   Email: ${lead.email}`);
            console.error(`   Teléfono: ${normalizedPhones.plus}`);
            console.error(`   Error Message: ${portalError.message}`);
            
            if (portalError.response) {
                console.error(`   HTTP Status: ${portalError.response.status}`);
                console.error(`   Response Headers:`, portalError.response.headers);
                console.error(`   Response Data:`, JSON.stringify(portalError.response.data, null, 2));
                
                // Analizar el tipo de error
                if (portalError.response.status === 400) {
                    console.error(`   ⚠️ Error 400 - Bad Request`);
                    console.error(`   Posibles causas:`);
                    console.error(`     - Email o teléfono ya registrado`);
                    console.error(`     - Formato de datos inválido`);
                    console.error(`     - Validación de campos fallida`);
                } else if (portalError.response.status === 500) {
                    console.error(`   ⚠️ Error 500 - Error del servidor del Portal`);
                }
            } else if (portalError.request) {
                console.error(`   ⚠️ No se recibió respuesta del servidor`);
                console.error(`   Request enviado pero sin respuesta`);
            } else {
                console.error(`   ⚠️ Error al configurar la petición`);
            }

            // A pesar del error en el portal, el lead fue recibido correctamente
            // No fallar completamente, solo reportar el error
            console.log('═══════════════════════════════════════════════════════════');
            return res.status(200).json({
                success: true,
                message: 'Lead recibido pero error al registrar en Portal de Recetas',
                data: {
                    email: lead.email,
                    name: lead.name,
                    phone_original: rawPhone,
                    phone_normalized_00: normalizedPhones.doubleZero,
                    phone_normalized_plus: normalizedPhones.plus,
                    uuid: lead.uuid,
                    portal_registration: {
                        success: false,
                        error: portalError.message,
                        status: portalError.response?.status,
                        details: portalError.response?.data
                    }
                }
            });
        }
    }



    if (!normalizedPhones) {
        console.error('❌ ERROR: No se pudo normalizar el teléfono');
        console.error(`   Teléfono recibido: ${rawPhone}`);
        return res.status(400).json({
            success: false,
            error: 'No se pudo normalizar el número de teléfono',
            phone: rawPhone
        });
    }


    // Enviar respuesta exitosa
    console.log('✅ Lead procesado exitosamente (no requiere registro en Portal)');
    console.log(`   Email: ${lead.email}`);
    console.log(`   UUID: ${lead.uuid}`);
    console.log('═══════════════════════════════════════════════════════════');
    
    res.status(200).json({
        success: true,
        message: 'Datos recibidos y procesados correctamente',
        data: {
            email: lead.email,
            name: lead.name,
            phone_original: rawPhone,
            phone_normalized_00: normalizedPhones.doubleZero,
            phone_normalized_plus: normalizedPhones.plus,
            uuid: lead.uuid
        }
    });
};

/**
 * Procesa leads del popup de la landing iChef x Tonga Reyno
 * Crea/actualiza contacto en RD Station y Chatwoot, y dispara evento de conversión
 */
const leadPopupTonga = async (req, res) => {
    const CONVERSION_EVENT = "conversion-popup-ichefxtongareyno";

    try {
        if (!credentialsValid) {
            return res.status(500).json({
                success: false,
                error: "Configuración de RD Station incompleta."
            });
        }

        const { nombre, email, celular } = req.body;

        console.log("📩 Lead popup Tonga recibido:", { nombre, email, celular });

        if (!nombre || !email || !celular) {
            return res.status(400).json({
                success: false,
                error: "Faltan datos requeridos: nombre, email y celular son obligatorios."
            });
        }

        // Dividir nombre completo en firstname y lastname
        const nameParts = (nombre || "").trim().split(" ");
        const firstname = nameParts[0] || "";
        const lastname = nameParts.slice(1).join(" ") || "";

        // Normalizar teléfono
        const normalizedPhone = normalizeUruguayanPhone(celular);
        const phoneForRD = celular;

        // Validar email
        let emailToUse = cleanEmail(email);
        if (!isValidEmail(emailToUse)) {
            console.log(`⚠️ Email inválido: ${emailToUse}, intentando generar desde teléfono`);
            if (isValidPhone(celular)) {
                emailToUse = generateEmailFromPhone(celular);
            } else {
                return res.status(400).json({
                    success: false,
                    error: "Email inválido y no se puede generar desde teléfono."
                });
            }
        }

        const contactData = {
            email: emailToUse,
            firstname: firstname,
            lastname: lastname,
            phone: phoneForRD,
            mobile: phoneForRD,
            cf_fuente_contacto: "popup-ichefxtongareyno",
        };

        // Buscar contacto existente en RD Station
        let existingContact = null;
        try {
            existingContact = await findContactByEmail(emailToUse, contactData);
        } catch (error) {
            console.log(`❌ Error buscando contacto: ${error.message}`);
        }

        let contactAction = "";
        if (existingContact) {
            console.log(`✅ Contacto EXISTE: ${emailToUse} (uuid: ${existingContact.uuid})`);
            const updateSuccess = await updateContact(existingContact.uuid, contactData);
            contactAction = updateSuccess ? "UPDATED" : "UPDATE_FAILED";
        } else {
            console.log(`🆕 Contacto NUEVO: ${emailToUse}`);
            const createSuccess = await createContact(contactData);
            if (!createSuccess) {
                return res.status(500).json({
                    success: false,
                    error: "No se pudo crear el contacto en RD Station."
                });
            }
            contactAction = "CREATED";
        }

        // Disparar evento de conversión
        const eventSuccess = await createConversionEvent(emailToUse, CONVERSION_EVENT, {
            name: `${firstname} ${lastname}`.trim(),
            email: emailToUse,
            phone: phoneForRD,
            source_url: "https://ichef.com.uy/ichefxtongareyno",
        });

        const responseData = {
            success: true,
            message: "Contacto procesado exitosamente.",
            data: {
                email: emailToUse,
                contactAction: contactAction,
                eventName: CONVERSION_EVENT,
                eventCreated: eventSuccess,
            },
        };

        if (!eventSuccess) {
            responseData.message = "Contacto procesado pero el evento de conversión falló.";
            responseData.warning = "El evento de conversión no se pudo crear.";
        }

        return res.status(200).json(responseData);
    } catch (error) {
        console.error("Error en leadPopupTonga:", error);
        return res.status(500).json({
            success: false,
            error: "Error interno del servidor.",
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
    createConversionEvent,
    registrarDemo,
    getCircuitBreakerStatus,
    resetCircuitBreaker,
    getCredentialsStatus,
    initializeCredentials,
    testConversionEvent,
    actualizacionFirmwareNh2025101735,
    normalizeUruguayanPhone,
    normalizePhoneToDoubleZero,
    expoDgusto,
    leadPopupTonga
};
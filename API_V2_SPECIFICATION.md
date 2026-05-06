# 📋 ESPECIFICACIÓN TÉCNICA - API V2 CHATWOOT-RD STATION

## 🎯 OBJETIVO DEL DOCUMENTO

Este documento proporciona una especificación completa y detallada para desarrollar la **versión 2** de la API de integración entre Chatwoot y RD Station. El objetivo principal es crear una aplicación **ordenada, mantenible y escalable** con código reutilizable, arquitectura limpia y mejores prácticas de desarrollo.

---

## 📊 CONTEXTO DEL PROYECTO ACTUAL (V1)

### Propósito
API REST que conecta y sincroniza datos entre:
- **Chatwoot** (Customer Service Platform)
- **RD Station** (CRM y Marketing Automation)
- **Evolution API** (WhatsApp Business)

### Stack Tecnológico Actual
```json
{
  "runtime": "Node.js",
  "framework": "Express 4.21.2",
  "http-client": "Axios 1.7.9",
  "excel": "ExcelJS 4.4.0",
  "config": "dotenv 16.4.7",
  "cors": "cors 2.8.5",
  "logging": "morgan 1.10.0",
  "dev": "nodemon 3.1.9"
}
```

### Problemas Identificados en V1

#### 🔴 Críticos
1. **Código duplicado** - Más de 300 líneas de código repetido en múltiples controladores
2. **Sin estructura modular** - Funciones mezcladas con lógica de negocio
3. **Rutas desorganizadas** - 9 archivos de rutas sin convención clara
4. **Sin validación de entrada** - Endpoints públicos sin autenticación
5. **Error handling inconsistente** - Manejo de errores diferente en cada controlador

#### 🟡 Importantes
6. **Sin tests** - Cero cobertura de pruebas
7. **Sin documentación API** - No existe OpenAPI/Swagger
8. **Hardcoded values** - URLs y tokens mezclados con código
9. **Sin rate limiting** - Vulnerable a ataques DoS
10. **Sin caché** - Búsquedas repetidas de inboxes/teams

---

## 🏗️ ARQUITECTURA PROPUESTA PARA V2

### Principios de Diseño

1. **Separación de Responsabilidades** (Single Responsibility Principle)
2. **DRY** (Don't Repeat Yourself)
3. **RESTful API Design** con convenciones claras
4. **Error Handling Centralizado**
5. **Middleware Pattern** para autenticación, validación y logging
6. **Service Layer Pattern** para lógica de negocio
7. **Repository Pattern** para acceso a APIs externas

### Estructura de Carpetas Propuesta

```
backend/
├── src/
│   ├── config/                     # Configuración centralizada
│   │   ├── index.js                # Exporta toda la config
│   │   ├── chatwoot.config.js      # Config de Chatwoot
│   │   ├── rdstation.config.js     # Config de RD Station
│   │   └── evolution.config.js     # Config de Evolution API
│   │
│   ├── middleware/                 # Middleware reutilizable
│   │   ├── auth.middleware.js      # Autenticación de API Keys
│   │   ├── validator.middleware.js # Validación de schemas
│   │   ├── error.middleware.js     # Manejo centralizado de errores
│   │   ├── ratelimit.middleware.js # Rate limiting
│   │   └── logger.middleware.js    # Logging estructurado
│   │
│   ├── utils/                      # Utilidades reutilizables
│   │   ├── phone.utils.js          # Normalización de teléfonos
│   │   ├── email.utils.js          # Generación y validación de emails
│   │   ├── date.utils.js           # Formateo de fechas
│   │   ├── validator.utils.js      # Validaciones comunes
│   │   ├── cache.utils.js          # Sistema de caché simple
│   │   └── retry.utils.js          # Lógica de reintentos
│   │
│   ├── services/                   # Lógica de negocio (Service Layer)
│   │   ├── contact.service.js      # CRUD de contactos (lógica)
│   │   ├── conversation.service.js # Gestión de conversaciones
│   │   ├── deal.service.js         # Gestión de deals/oportunidades
│   │   ├── campaign.service.js     # Campañas y onboarding
│   │   ├── sync.service.js         # Sincronización entre plataformas
│   │   └── export.service.js       # Exportación de datos
│   │
│   ├── clients/                    # Clientes API (Repository Pattern)
│   │   ├── chatwoot.client.js      # Cliente HTTP para Chatwoot
│   │   ├── rdstation.client.js     # Cliente HTTP para RD Station
│   │   ├── evolution.client.js     # Cliente HTTP para Evolution
│   │   └── base.client.js          # Cliente base con circuit breaker
│   │
│   ├── controllers/                # Controladores (orquestación)
│   │   ├── contact.controller.js   # Endpoints de contactos
│   │   ├── conversation.controller.js
│   │   ├── deal.controller.js
│   │   ├── campaign.controller.js
│   │   ├── export.controller.js
│   │   └── webhook.controller.js   # Webhooks de plataformas externas
│   │
│   ├── routes/                     # Definición de rutas
│   │   ├── index.js                # Router principal
│   │   ├── v2/                     # Versión 2 de la API
│   │   │   ├── contact.routes.js
│   │   │   ├── conversation.routes.js
│   │   │   ├── deal.routes.js
│   │   │   ├── campaign.routes.js
│   │   │   ├── export.routes.js
│   │   │   └── webhook.routes.js
│   │   └── v1/                     # Legacy (mantener temporalmente)
│   │
│   ├── models/                     # Definición de estructuras de datos
│   │   ├── contact.model.js        # Schema de contacto
│   │   ├── deal.model.js           # Schema de deal
│   │   └── conversation.model.js   # Schema de conversación
│   │
│   ├── validators/                 # Schemas de validación
│   │   ├── contact.validator.js    # Validaciones de contacto
│   │   ├── deal.validator.js
│   │   └── campaign.validator.js
│   │
│   ├── constants/                  # Constantes de la aplicación
│   │   ├── http.constants.js       # Códigos HTTP, mensajes
│   │   ├── chatwoot.constants.js   # IDs de inboxes, teams
│   │   ├── rdstation.constants.js  # Event types, field options
│   │   └── stages.constants.js     # Mapeo de stages/etapas
│   │
│   └── app.js                      # Configuración de Express
│
├── tests/                          # Tests unitarios e integración
│   ├── unit/
│   │   ├── utils/
│   │   ├── services/
│   │   └── clients/
│   └── integration/
│       └── routes/
│
├── docs/                           # Documentación
│   ├── api/                        # Documentación OpenAPI
│   │   └── openapi.yaml
│   ├── guides/                     # Guías de uso
│   └── architecture.md             # Arquitectura técnica
│
├── logs/                           # Logs de la aplicación
├── exports/                        # Archivos exportados
├── .env.example                    # Template de variables de entorno
├── .gitignore
├── package.json
└── README.md
```

---

## 🔧 MÓDULOS REUTILIZABLES DETALLADOS

### 1. Phone Utils (`utils/phone.utils.js`)

**Propósito:** Centralizar toda la lógica de normalización y formateo de números telefónicos.

**Funcionalidades:**
```javascript
/**
 * Normaliza un número de teléfono a formato E164 (+código_país + número)
 * Soporta múltiples países de América Latina
 * 
 * @param {string} phone - Número de teléfono en cualquier formato
 * @param {string} country - Código ISO del país (UY, AR, BR, etc.)
 * @returns {string|null} - Número en formato E164 o null si inválido
 * 
 * @example
 * normalizePhone('099 123 456', 'UY') // '+59899123456'
 * normalizePhone('598 99 123 456', 'UY') // '+59899123456'
 * normalizePhone('+598 99 123 456') // '+59899123456'
 */
function normalizePhone(phone, country = 'UY') {
    // Implementación
}

/**
 * Normaliza específicamente para WhatsApp (formato sin +)
 * 
 * @param {string} phone - Número de teléfono
 * @returns {string|null} - Número sin el prefijo + (ej: '59899123456')
 * 
 * @example
 * normalizeWhatsAppNumber('+598 99 123 456') // '59899123456'
 */
function normalizeWhatsAppNumber(phone) {
    const normalized = normalizePhone(phone);
    return normalized ? normalized.replace('+', '') : null;
}

/**
 * Valida si un número de teléfono es válido
 * 
 * @param {string} phone - Número a validar
 * @returns {boolean}
 */
function isValidPhone(phone) {
    if (!phone || typeof phone !== 'string') return false;
    const cleanPhone = phone.replace(/\D/g, '');
    return /^\d{7,15}$/.test(cleanPhone);
}

/**
 * Detecta el país del número de teléfono basándose en el código
 * 
 * @param {string} phone - Número de teléfono
 * @returns {string|null} - Código ISO del país o null
 * 
 * @example
 * detectCountry('+59899123456') // 'UY'
 * detectCountry('+5491112345678') // 'AR'
 */
function detectCountry(phone) {
    // Implementación
}

// Constantes
const COUNTRY_CODES = {
    'UY': '598',
    'AR': '54',
    'BR': '55',
    'CL': '56',
    'CO': '57',
    'PE': '51',
    'EC': '593',
    'BO': '591',
    'PY': '595',
    'VE': '58'
};

module.exports = {
    normalizePhone,
    normalizeWhatsAppNumber,
    isValidPhone,
    detectCountry,
    COUNTRY_CODES
};
```

**Casos de Uso:**
- Importar contactos desde InConcert → formatear a E164 para Chatwoot
- Enviar mensajes por WhatsApp → formatear sin `+` para Evolution API
- Registrar en RD Station → solo dígitos sin formato

---

### 2. Email Utils (`utils/email.utils.js`)

**Propósito:** Generación y validación de emails.

```javascript
/**
 * Genera un email ficticio basado en el número de teléfono
 * Usado cuando el contacto no tiene email en Chatwoot (campo obligatorio en RD Station)
 * 
 * @param {string} phone - Número de teléfono
 * @param {string} domain - Dominio para el email (default: 'email.com')
 * @returns {string} - Email generado
 * 
 * @example
 * generateEmailFromPhone('+598 99 123 456') // '59899123456@email.com'
 * generateEmailFromPhone('099 123 456', 'ichef.com.uy') // '59899123456@ichef.com.uy'
 */
function generateEmailFromPhone(phone, domain = 'email.com') {
    const cleanPhone = phone.replace(/\D/g, '');
    return `${cleanPhone}@${domain}`;
}

/**
 * Valida si un email tiene formato válido
 * 
 * @param {string} email - Email a validar
 * @returns {boolean}
 * 
 * @example
 * isValidEmail('test@example.com') // true
 * isValidEmail('invalid-email') // false
 */
function isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
}

/**
 * Normaliza un email (lowercase, trim)
 * 
 * @param {string} email
 * @returns {string}
 */
function normalizeEmail(email) {
    return email.trim().toLowerCase();
}

/**
 * Verifica si un email es generado (ficticio) o real
 * 
 * @param {string} email
 * @returns {boolean} - true si es email ficticio
 * 
 * @example
 * isFakeEmail('59899123456@email.com') // true
 * isFakeEmail('usuario@gmail.com') // false
 */
function isFakeEmail(email) {
    return /@email\.com$/.test(email);
}

module.exports = {
    generateEmailFromPhone,
    isValidEmail,
    normalizeEmail,
    isFakeEmail
};
```

---

### 3. Chatwoot Client (`clients/chatwoot.client.js`)

**Propósito:** Cliente HTTP centralizado para todas las operaciones con Chatwoot API.

```javascript
import axios from 'axios';
import { chatwootConfig } from '../config/chatwoot.config.js';
import { CacheManager } from '../utils/cache.utils.js';
import { retryWithBackoff } from '../utils/retry.utils.js';

class ChatwootClient {
    constructor() {
        this.client = axios.create({
            baseURL: `${chatwootConfig.url}/api/v1/accounts/${chatwootConfig.accountId}`,
            headers: {
                'Content-Type': 'application/json',
                'api_access_token': chatwootConfig.apiToken
            },
            timeout: 30000
        });

        this.cache = new CacheManager();

        // Interceptor para logging
        this.client.interceptors.response.use(
            response => response,
            error => {
                console.error('Chatwoot API Error:', {
                    url: error.config?.url,
                    method: error.config?.method,
                    status: error.response?.status,
                    data: error.response?.data
                });
                throw error;
            }
        );
    }

    // ==================== CONTACTOS ====================

    /**
     * Busca un contacto por ID, email o teléfono
     * 
     * @param {Object} filters - { id, email, phone_number }
     * @returns {Promise<Object|null>} - Contacto encontrado o null
     */
    async findContact(filters) {
        const payload = this._buildFilterPayload(filters);
        
        try {
            const response = await this.client.post('/contacts/filter', payload);
            
            if (response.data.meta.count > 0) {
                return response.data.payload[0];
            }
            return null;
        } catch (error) {
            console.error('Error buscando contacto:', filters, error.message);
            return null;
        }
    }

    /**
     * Crea un nuevo contacto en Chatwoot
     * 
     * @param {Object} contactData - Datos del contacto
     * @returns {Promise<Object>} - Contacto creado
     */
    async createContact(contactData) {
        try {
            const response = await retryWithBackoff(
                () => this.client.post('/contacts', contactData),
                { maxRetries: 3 }
            );
            return response.data;
        } catch (error) {
            console.error('Error creando contacto:', error.message);
            throw error;
        }
    }

    /**
     * Actualiza un contacto existente
     * 
     * @param {number} contactId - ID del contacto
     * @param {Object} updateData - Datos a actualizar
     * @returns {Promise<Object>} - Contacto actualizado
     */
    async updateContact(contactId, updateData) {
        try {
            const response = await this.client.put(`/contacts/${contactId}`, updateData);
            return response.data;
        } catch (error) {
            console.error(`Error actualizando contacto ${contactId}:`, error.message);
            throw error;
        }
    }

    /**
     * Elimina un contacto
     * 
     * @param {number} contactId - ID del contacto
     * @returns {Promise<boolean>} - true si se eliminó correctamente
     */
    async deleteContact(contactId) {
        try {
            await this.client.delete(`/contacts/${contactId}`);
            return true;
        } catch (error) {
            console.error(`Error eliminando contacto ${contactId}:`, error.message);
            throw error;
        }
    }

    /**
     * Crea o actualiza un contacto (upsert)
     * 
     * @param {Object} contactData - Datos del contacto
     * @returns {Promise<Object>} - { contact, created: boolean }
     */
    async upsertContact(contactData) {
        // Buscar contacto existente
        const existing = await this.findContact({
            id: contactData.id,
            email: contactData.email,
            phone_number: contactData.phone_number
        });

        if (existing) {
            // Actualizar
            const updated = await this.updateContact(existing.id, contactData);
            return { contact: updated, created: false };
        } else {
            // Crear
            const created = await this.createContact(contactData);
            return { contact: created, created: true };
        }
    }

    // ==================== CONVERSACIONES ====================

    /**
     * Obtiene las conversaciones de un contacto
     * 
     * @param {number} contactId - ID del contacto
     * @returns {Promise<Array>} - Lista de conversaciones
     */
    async getConversationsByContact(contactId) {
        try {
            const response = await this.client.get(`/contacts/${contactId}/conversations`);
            return response.data.payload || [];
        } catch (error) {
            console.error(`Error obteniendo conversaciones del contacto ${contactId}:`, error.message);
            return [];
        }
    }

    /**
     * Obtiene una conversación específica
     * 
     * @param {number} conversationId
     * @returns {Promise<Object|null>}
     */
    async getConversation(conversationId) {
        try {
            const response = await this.client.get(`/conversations/${conversationId}`);
            return response.data;
        } catch (error) {
            console.error(`Error obteniendo conversación ${conversationId}:`, error.message);
            return null;
        }
    }

    /**
     * Cambia el estado de una conversación
     * 
     * @param {number} conversationId
     * @param {string} status - 'open' | 'pending' | 'resolved'
     * @returns {Promise<Object>}
     */
    async changeConversationStatus(conversationId, status) {
        try {
            const response = await this.client.post(
                `/conversations/${conversationId}/toggle_status`,
                { status }
            );
            return response.data.payload;
        } catch (error) {
            console.error(`Error cambiando estado de conversación ${conversationId}:`, error.message);
            throw error;
        }
    }

    /**
     * Asigna/actualiza etiquetas en una conversación
     * 
     * @param {number} conversationId
     * @param {Array<string>} labels - Array de etiquetas
     * @returns {Promise<Object>}
     */
    async setLabels(conversationId, labels) {
        try {
            const response = await this.client.post(
                `/conversations/${conversationId}/labels`,
                { labels }
            );
            return response.data.payload;
        } catch (error) {
            console.error(`Error asignando etiquetas a conversación ${conversationId}:`, error.message);
            throw error;
        }
    }

    /**
     * Envía un mensaje en una conversación
     * 
     * @param {number} conversationId
     * @param {Object} messageData - { content, message_type, private }
     * @returns {Promise<Object>}
     */
    async sendMessage(conversationId, messageData) {
        try {
            const response = await this.client.post(
                `/conversations/${conversationId}/messages`,
                messageData
            );
            return response.data;
        } catch (error) {
            console.error(`Error enviando mensaje en conversación ${conversationId}:`, error.message);
            throw error;
        }
    }

    // ==================== INBOXES ====================

    /**
     * Obtiene todos los inboxes (con caché)
     * 
     * @param {boolean} refresh - Forzar refresh del caché
     * @returns {Promise<Array>}
     */
    async getInboxes(refresh = false) {
        const cacheKey = 'chatwoot:inboxes';
        
        if (!refresh) {
            const cached = this.cache.get(cacheKey);
            if (cached) return cached;
        }

        try {
            const response = await this.client.get('/inboxes');
            const inboxes = response.data.payload || [];
            
            // Cachear por 1 hora
            this.cache.set(cacheKey, inboxes, 3600);
            
            return inboxes;
        } catch (error) {
            console.error('Error obteniendo inboxes:', error.message);
            return [];
        }
    }

    /**
     * Busca un inbox por tipo de canal y configuración
     * 
     * @param {string} channelType - 'Channel::Whatsapp', 'Channel::Email', etc.
     * @param {Object} criteria - Criterios adicionales (ej: { phone_number_id: '...' })
     * @returns {Promise<Object|null>}
     */
    async findInbox(channelType, criteria = {}) {
        const inboxes = await this.getInboxes();
        
        return inboxes.find(inbox => {
            if (inbox.channel_type !== channelType) return false;
            
            // Verificar criterios adicionales
            for (const [key, value] of Object.entries(criteria)) {
                if (inbox.provider_config?.[key] !== value) return false;
            }
            
            return true;
        }) || null;
    }

    // ==================== TEAMS ====================

    /**
     * Obtiene todos los teams (con caché)
     * 
     * @returns {Promise<Array>}
     */
    async getTeams() {
        const cacheKey = 'chatwoot:teams';
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        try {
            const response = await this.client.get('/teams');
            const teams = response.data || [];
            this.cache.set(cacheKey, teams, 3600);
            return teams;
        } catch (error) {
            console.error('Error obteniendo teams:', error.message);
            return [];
        }
    }

    // ==================== ATRIBUTOS PERSONALIZADOS ====================

    /**
     * Crea un atributo personalizado
     * 
     * @param {Object} attributeData
     * @returns {Promise<Object>}
     */
    async createCustomAttribute(attributeData) {
        try {
            const response = await this.client.post('/custom_attribute_definitions', attributeData);
            return response.data;
        } catch (error) {
            console.error('Error creando atributo personalizado:', error.message);
            throw error;
        }
    }

    /**
     * Lista atributos personalizados
     * 
     * @param {string} attributeModel - 'contact_attribute' | 'conversation_attribute'
     * @returns {Promise<Array>}
     */
    async listCustomAttributes(attributeModel) {
        try {
            const response = await this.client.get(
                `/custom_attribute_definitions?attribute_model=${attributeModel}`
            );
            return response.data || [];
        } catch (error) {
            console.error('Error listando atributos personalizados:', error.message);
            return [];
        }
    }

    // ==================== HELPERS PRIVADOS ====================

    /**
     * Construye el payload de filtro para búsqueda de contactos
     * 
     * @private
     * @param {Object} filters
     * @returns {Object}
     */
    _buildFilterPayload(filters) {
        const buildItem = (key, value) => {
            if (!value) return null;
            return {
                attribute_key: key,
                filter_operator: 'equal_to',
                values: [value],
                query_operator: 'OR'
            };
        };

        const items = [
            buildItem('id', filters.id),
            buildItem('email', filters.email),
            buildItem('phone_number', filters.phone_number)
        ]
        .filter(Boolean)
        .map((item, index, array) => ({
            ...item,
            query_operator: index === array.length - 1 ? null : 'OR'
        }));

        return { payload: items };
    }
}

// Export singleton
export default new ChatwootClient();
```

---

### 4. RD Station Client (`clients/rdstation.client.js`)

**Propósito:** Cliente HTTP centralizado para RD Station con gestión automática de tokens y circuit breaker.

```javascript
import axios from 'axios';
import { rdStationConfig } from '../config/rdstation.config.js';
import { CircuitBreaker } from '../utils/circuitbreaker.utils.js';

class RDStationClient {
    constructor() {
        this.client = axios.create({
            baseURL: rdStationConfig.apiUrl,
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        this.accessToken = null;
        this.circuitBreaker = new CircuitBreaker({
            failureThreshold: 5,
            resetTimeout: 300000 // 5 minutos
        });

        // Interceptor para agregar token
        this.client.interceptors.request.use(async (config) => {
            if (!this.accessToken) {
                await this.refreshToken();
            }
            config.headers['Authorization'] = `Bearer ${this.accessToken}`;
            return config;
        });

        // Interceptor para auto-refresh de token
        this.client.interceptors.response.use(
            response => response,
            async (error) => {
                const originalRequest = error.config;

                // Si es error 401 y no es un retry
                if (error.response?.status === 401 && !originalRequest._retry) {
                    originalRequest._retry = true;
                    await this.refreshToken();
                    return this.client(originalRequest);
                }

                // Circuit breaker para errores 5xx
                if (error.response?.status >= 500) {
                    this.circuitBreaker.recordFailure();
                }

                throw error;
            }
        );
    }

    /**
     * Refresca el access token usando el refresh token
     */
    async refreshToken() {
        try {
            const response = await axios.post(`${rdStationConfig.apiUrl}/auth/token`, {
                client_id: rdStationConfig.clientId,
                client_secret: rdStationConfig.clientSecret,
                refresh_token: rdStationConfig.refreshToken
            });

            this.accessToken = response.data.access_token;
            console.log('✅ RD Station token refrescado');
            
            return this.accessToken;
        } catch (error) {
            console.error('❌ Error refrescando token de RD Station:', error.message);
            throw error;
        }
    }

    // ==================== CONTACTOS ====================

    /**
     * Busca un contacto por email
     * 
     * @param {string} email
     * @returns {Promise<Object|null>}
     */
    async getContact(email) {
        if (!this.circuitBreaker.canRequest()) {
            throw new Error('Circuit breaker abierto - RD Station no disponible');
        }

        try {
            const response = await this.client.get(
                `/platform/contacts/email:${encodeURIComponent(email)}`
            );
            this.circuitBreaker.recordSuccess();
            return response.data;
        } catch (error) {
            if (error.response?.status === 404) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Crea un nuevo contacto
     * 
     * @param {Object} contactData
     * @returns {Promise<Object>}
     */
    async createContact(contactData) {
        if (!this.circuitBreaker.canRequest()) {
            throw new Error('Circuit breaker abierto');
        }

        try {
            const response = await this.client.post('/platform/contacts', contactData);
            this.circuitBreaker.recordSuccess();
            return response.data;
        } catch (error) {
            console.error('Error creando contacto en RD Station:', error.message);
            throw error;
        }
    }

    /**
     * Actualiza un contacto existente
     * 
     * @param {string} email - Email del contacto (identificador)
     * @param {Object} updateData
     * @returns {Promise<Object>}
     */
    async updateContact(email, updateData) {
        if (!this.circuitBreaker.canRequest()) {
            throw new Error('Circuit breaker abierto');
        }

        try {
            const response = await this.client.patch(
                `/platform/contacts/email:${encodeURIComponent(email)}`,
                updateData
            );
            this.circuitBreaker.recordSuccess();
            return response.data;
        } catch (error) {
            console.error('Error actualizando contacto en RD Station:', error.message);
            throw error;
        }
    }

    /**
     * Crea o actualiza un contacto (upsert)
     * 
     * @param {Object} contactData
     * @returns {Promise<{contact: Object, created: boolean}>}
     */
    async upsertContact(contactData) {
        const email = contactData.email;
        const existing = await this.getContact(email);

        if (existing) {
            const updated = await this.updateContact(email, contactData);
            return { contact: updated, created: false };
        } else {
            const created = await this.createContact(contactData);
            return { contact: created, created: true };
        }
    }

    // ==================== EVENTOS ====================

    /**
     * Envía un evento de conversión
     * 
     * @param {string} email
     * @param {string} conversionIdentifier - Nombre del evento
     * @param {Object} additionalFields - Campos adicionales opcionales
     * @returns {Promise<Object>}
     */
    async sendConversionEvent(email, conversionIdentifier, additionalFields = {}) {
        if (!this.circuitBreaker.canRequest()) {
            throw new Error('Circuit breaker abierto');
        }

        try {
            const payload = {
                event_type: 'CONVERSION',
                event_family: 'CDP',
                payload: {
                    conversion_identifier: conversionIdentifier,
                    email,
                    ...additionalFields
                }
            };

            const response = await this.client.post(
                '/platform/events?event_type=conversion',
                payload
            );
            
            this.circuitBreaker.recordSuccess();
            return response.data;
        } catch (error) {
            console.error('Error enviando evento de conversión:', error.message);
            throw error;
        }
    }

    // ==================== CRM (DEALS) ====================

    /**
     * Crea una oportunidad en RD Station CRM
     * 
     * @param {Object} dealData
     * @returns {Promise<Object>}
     */
    async createDeal(dealData) {
        // RD Station CRM usa un endpoint diferente
        const crmClient = axios.create({
            baseURL: rdStationConfig.crmUrl,
            headers: {
                'Authorization': `Bearer ${rdStationConfig.userToken}`,
                'Content-Type': 'application/json'
            }
        });

        try {
            const response = await crmClient.post('/deals', dealData);
            return response.data;
        } catch (error) {
            console.error('Error creando deal en RD Station CRM:', error.message);
            throw error;
        }
    }

    /**
     * Actualiza una oportunidad
     * 
     * @param {string} dealId
     * @param {Object} updateData
     * @returns {Promise<Object>}
     */
    async updateDeal(dealId, updateData) {
        const crmClient = axios.create({
            baseURL: rdStationConfig.crmUrl,
            headers: {
                'Authorization': `Bearer ${rdStationConfig.userToken}`,
                'Content-Type': 'application/json'
            }
        });

        try {
            const response = await crmClient.put(`/deals/${dealId}`, updateData);
            return response.data;
        } catch (error) {
            console.error('Error actualizando deal:', error.message);
            throw error;
        }
    }

    // ==================== UTILIDADES ====================

    /**
     * Valida si un valor es válido para un campo con opciones limitadas
     * 
     * @param {string} fieldName
     * @param {string} value
     * @returns {boolean}
     */
    validateFieldOption(fieldName, value) {
        const fieldOptions = rdStationConfig.fieldOptions || {};
        
        if (!fieldOptions[fieldName]) {
            return true; // No hay restricciones para este campo
        }

        const validOptions = fieldOptions[fieldName];
        return validOptions.includes(value);
    }

    /**
     * Obtiene el estado del circuit breaker
     */
    getCircuitBreakerStatus() {
        return this.circuitBreaker.getStatus();
    }
}

// Export singleton
export default new RDStationClient();
```

---

### 5. Contact Service (`services/contact.service.js`)

**Propósito:** Lógica de negocio para gestión de contactos.

```javascript
import chatwootClient from '../clients/chatwoot.client.js';
import rdStationClient from '../clients/rdstation.client.js';
import { normalizePhone, isValidPhone } from '../utils/phone.utils.js';
import { generateEmailFromPhone, isValidEmail } from '../utils/email.utils.js';
import { mapContactChatwootToRD, mapContactRDToChatwoot } from '../mappers/contact.mapper.js';

class ContactService {
    
    /**
     * Sincroniza un contacto desde RD Station a Chatwoot
     * 
     * @param {Object} rdContact - Contacto desde RD Station
     * @returns {Promise<Object>} - { chatwootContact, created: boolean }
     */
    async syncFromRDToChatwoot(rdContact) {
        // Mapear datos de RD Station a formato Chatwoot
        const chatwootData = mapContactRDToChatwoot(rdContact);

        // Normalizar teléfono
        if (rdContact.mobile_phone) {
            chatwootData.phone_number = normalizePhone(rdContact.mobile_phone);
        }

        // Determinar inbox_id según tenga o no teléfono
        if (chatwootData.phone_number && isValidPhone(chatwootData.phone_number)) {
            // Inbox de WhatsApp
            const whatsappInbox = await chatwootClient.findInbox('Channel::Whatsapp');
            chatwootData.inbox_id = whatsappInbox?.id || 23; // fallback
        } else {
            // Inbox de Email
            chatwootData.inbox_id = 1;
        }

        // Upsert en Chatwoot
        const result = await chatwootClient.upsertContact(chatwootData);

        console.log(`✅ Contacto sincronizado a Chatwoot: ${rdContact.email} (${result.created ? 'creado' : 'actualizado'})`);

        return result;
    }

    /**
     * Sincroniza un contacto desde Chatwoot a RD Station
     * 
     * @param {Object} chatwootContact - Contacto desde Chatwoot
     * @returns {Promise<Object>} - { rdContact, created: boolean }
     */
    async syncFromChatwootToRD(chatwootContact) {
        // Mapear datos de Chatwoot a formato RD Station
        const rdData = mapContactChatwootToRD(chatwootContact);

        // Validar email (obligatorio en RD Station)
        if (!rdData.email || !isValidEmail(rdData.email)) {
            // Generar email desde teléfono si está disponible
            if (chatwootContact.phone_number && isValidPhone(chatwootContact.phone_number)) {
                rdData.email = generateEmailFromPhone(chatwootContact.phone_number);
                console.log(`⚠️  Email generado desde teléfono: ${rdData.email}`);
            } else {
                throw new Error('No se puede sincronizar contacto sin email válido');
            }
        }

        // Formatear teléfono para RD Station (solo dígitos)
        if (rdData.mobile_phone) {
            rdData.mobile_phone = rdData.mobile_phone.replace(/\D/g, '');
        }

        // Upsert en RD Station
        const result = await rdStationClient.upsertContact(rdData);

        console.log(`✅ Contacto sincronizado a RD Station: ${rdData.email} (${result.created ? 'creado' : 'actualizado'})`);

        return result;
    }

    /**
     * Sincronización bidireccional
     * Determina qué sistema tiene la información más reciente y sincroniza
     * 
     * @param {string} email - Email del contacto
     * @param {string} direction - 'rd_to_chatwoot' | 'chatwoot_to_rd' | 'auto'
     * @returns {Promise<Object>}
     */
    async bidirectionalSync(email, direction = 'auto') {
        // Obtener contactos de ambos sistemas
        const [rdContact, chatwootContact] = await Promise.all([
            rdStationClient.getContact(email),
            chatwootClient.findContact({ email })
        ]);

        if (!rdContact && !chatwootContact) {
            throw new Error(`Contacto no encontrado en ningún sistema: ${email}`);
        }

        // Si solo existe en uno, sincronizar al otro
        if (rdContact && !chatwootContact) {
            return await this.syncFromRDToChatwoot(rdContact);
        }

        if (chatwootContact && !rdContact) {
            return await this.syncFromChatwootToRD(chatwootContact);
        }

        // Si existe en ambos, determinar dirección de sincronización
        if (direction === 'rd_to_chatwoot') {
            return await this.syncFromRDToChatwoot(rdContact);
        } else if (direction === 'chatwoot_to_rd') {
            return await this.syncFromChatwootToRD(chatwootContact);
        } else {
            // Auto: usar el más reciente (basado en updated_at)
            const rdUpdated = new Date(rdContact.updated_at || 0);
            const chatwootUpdated = new Date(chatwootContact.updated_at || 0);

            if (rdUpdated > chatwootUpdated) {
                return await this.syncFromRDToChatwoot(rdContact);
            } else {
                return await this.syncFromChatwootToRD(chatwootContact);
            }
        }
    }

    /**
     * Importación masiva de contactos
     * 
     * @param {Array<Object>} contacts - Lista de contactos
     * @param {string} source - 'rd_station' | 'chatwoot' | 'inconcert'
     * @returns {Promise<Object>} - { success, failed, total }
     */
    async bulkImport(contacts, source) {
        const results = {
            total: contacts.length,
            success: 0,
            failed: 0,
            errors: []
        };

        for (const contact of contacts) {
            try {
                if (source === 'rd_station') {
                    await this.syncFromRDToChatwoot(contact);
                } else if (source === 'inconcert' || source === 'chatwoot') {
                    await this.syncFromChatwootToRD(contact);
                }
                results.success++;
            } catch (error) {
                results.failed++;
                results.errors.push({
                    contact: contact.email || contact.id,
                    error: error.message
                });
                console.error(`❌ Error importando contacto:`, error.message);
            }

            // Pequeño delay para evitar rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        return results;
    }

    /**
     * Busca un contacto en múltiples sistemas
     * 
     * @param {Object} criteria - { email, phone, id }
     * @returns {Promise<Object>} - { chatwoot, rdStation }
     */
    async findInAllSystems(criteria) {
        const [chatwootContact, rdContact] = await Promise.all([
            chatwootClient.findContact(criteria),
            criteria.email ? rdStationClient.getContact(criteria.email) : null
        ]);

        return {
            chatwoot: chatwootContact,
            rdStation: rdContact
        };
    }

    /**
     * Elimina un contacto de todos los sistemas
     * 
     * @param {string} email
     * @returns {Promise<Object>}
     */
    async deleteFromAllSystems(email) {
        const results = { chatwoot: false, rdStation: false };

        try {
            const chatwootContact = await chatwootClient.findContact({ email });
            if (chatwootContact) {
                await chatwootClient.deleteContact(chatwootContact.id);
                results.chatwoot = true;
            }
        } catch (error) {
            console.error('Error eliminando de Chatwoot:', error.message);
        }

        // RD Station no permite eliminación directa, pero se podría marcar como inactivo

        return results;
    }
}

export default new ContactService();
```

---

## 📋 ESPECIFICACIÓN DE ENDPOINTS V2

### Convenciones de la API

**Base URL:** `http://localhost:4000/api/v2`

**Autenticación:** API Key en header
```
Authorization: Bearer YOUR_API_KEY
```

**Formato de Respuesta:**
```javascript
// Éxito
{
    "success": true,
    "data": { /* resultado */ },
    "message": "Mensaje descriptivo" // opcional
}

// Error
{
    "success": false,
    "error": {
        "code": "VALIDATION_ERROR",
        "message": "Descripción del error",
        "details": { /* detalles adicionales */ }
    }
}
```

**Códigos de Estado HTTP:**
- `200` OK - Operación exitosa
- `201` Created - Recurso creado
- `202` Accepted - Procesamiento en background
- `400` Bad Request - Datos inválidos
- `401` Unauthorized - Sin autenticación
- `404` Not Found - Recurso no encontrado
- `409` Conflict - Conflicto (ej: duplicado)
- `422` Unprocessable Entity - Validación fallida
- `429` Too Many Requests - Rate limit excedido
- `500` Internal Server Error - Error del servidor
- `503` Service Unavailable - Servicio externo no disponible

---

### CONTACTOS

#### POST /api/v2/contacts
**Crear un nuevo contacto**

Request Body:
```json
{
    "name": "Juan Pérez",
    "email": "juan@example.com",
    "phone": "+598 99 123 456",
    "source": "chatwoot",  // "chatwoot" | "rd_station"
    "customAttributes": {
        "company": "iChef",
        "position": "Chef",
        "city": "Montevideo"
    },
    "syncTo": ["rd_station"]  // Array de sistemas a sincronizar
}
```

Response:
```json
{
    "success": true,
    "data": {
        "contact": {
            "id": 12345,
            "name": "Juan Pérez",
            "email": "juan@example.com",
            "phone_number": "+59899123456",
            "source": "chatwoot"
        },
        "synced": {
            "rd_station": {
                "success": true,
                "uuid": "abc-123-def"
            }
        }
    }
}
```

---

#### GET /api/v2/contacts/:identifier
**Obtener un contacto por ID, email o teléfono**

Query Parameters:
- `type` - "id" | "email" | "phone" (default: "id")
- `source` - "chatwoot" | "rd_station" | "all" (default: "all")

Example:
```
GET /api/v2/contacts/juan@example.com?type=email&source=all
```

Response:
```json
{
    "success": true,
    "data": {
        "chatwoot": {
            "id": 12345,
            "name": "Juan Pérez",
            "email": "juan@example.com",
            "phone_number": "+59899123456",
            "custom_attributes": { /* ... */ }
        },
        "rd_station": {
            "uuid": "abc-123",
            "name": "Juan Pérez",
            "email": "juan@example.com",
            "mobile_phone": "59899123456",
            "cf_tiene_ichef": "Sí"
        }
    }
}
```

---

#### PUT /api/v2/contacts/:id
**Actualizar un contacto**

Request Body:
```json
{
    "name": "Juan Carlos Pérez",
    "phone": "+598 99 999 999",
    "customAttributes": {
        "position": "Chef Ejecutivo"
    },
    "syncTo": ["rd_station"]
}
```

Response:
```json
{
    "success": true,
    "data": {
        "contact": { /* contacto actualizado */ },
        "synced": {
            "rd_station": { "success": true }
        }
    }
}
```

---

#### DELETE /api/v2/contacts/:id
**Eliminar un contacto**

Query Parameters:
- `deleteFrom` - "chatwoot" | "rd_station" | "all" (default: "chatwoot")

Response:
```json
{
    "success": true,
    "data": {
        "deleted": {
            "chatwoot": true,
            "rd_station": false  // No se puede eliminar directamente
        }
    }
}
```

---

#### POST /api/v2/contacts/sync
**Sincronizar contacto entre sistemas**

Request Body:
```json
{
    "email": "juan@example.com",
    "direction": "rd_to_chatwoot"  // "rd_to_chatwoot" | "chatwoot_to_rd" | "bidirectional"
}
```

Response:
```json
{
    "success": true,
    "data": {
        "contact": { /* contacto sincronizado */ },
        "direction": "rd_to_chatwoot",
        "created": false,
        "message": "Contacto actualizado en Chatwoot desde RD Station"
    }
}
```

---

#### POST /api/v2/contacts/bulk-import
**Importación masiva de contactos**

Request Body:
```json
{
    "source": "rd_station",  // "rd_station" | "chatwoot" | "inconcert"
    "contacts": [
        {
            "name": "Juan Pérez",
            "email": "juan@example.com",
            "mobile_phone": "59899123456"
        },
        // ... más contactos
    ],
    "syncTo": "chatwoot"  // Sistema destino
}
```

Response (202 Accepted):
```json
{
    "success": true,
    "data": {
        "jobId": "import-123-abc",
        "statusUrl": "/api/v2/contacts/bulk-import/status/import-123-abc",
        "message": "Importación iniciada en background"
    }
}
```

---

#### GET /api/v2/contacts/bulk-import/status/:jobId
**Estado de importación masiva**

Response:
```json
{
    "success": true,
    "data": {
        "jobId": "import-123-abc",
        "status": "completed",  // "processing" | "completed" | "failed"
        "progress": {
            "total": 100,
            "success": 95,
            "failed": 5,
            "current": 100
        },
        "errors": [
            {
                "contact": "invalid@example.com",
                "error": "Email inválido"
            }
        ]
    }
}
```

---

#### POST /api/v2/contacts/search
**Búsqueda avanzada de contactos**

Request Body:
```json
{
    "filters": {
        "email": "juan@example.com",
        "phone": "+598 99 123 456",
        "custom_attributes": {
            "tiene_ichef": "Sí",
            "stage": "cliente"
        }
    },
    "source": "chatwoot",  // "chatwoot" | "rd_station"
    "limit": 50,
    "offset": 0
}
```

Response:
```json
{
    "success": true,
    "data": {
        "contacts": [ /* array de contactos */ ],
        "pagination": {
            "total": 150,
            "limit": 50,
            "offset": 0,
            "hasMore": true
        }
    }
}
```

---

### CONVERSACIONES

#### GET /api/v2/conversations
**Listar conversaciones con filtros**

Query Parameters:
- `inboxId` - Filtrar por inbox
- `status` - "open" | "pending" | "resolved"
- `assigneeId` - Filtrar por agente asignado
- `teamId` - Filtrar por equipo
- `labels` - Filtrar por etiquetas (separadas por coma)
- `contactId` - Filtrar por contacto
- `limit` - Número de resultados (default: 25, max: 100)
- `page` - Número de página

Example:
```
GET /api/v2/conversations?inboxId=23&status=open&labels=lead,bot_activo&limit=50&page=1
```

Response:
```json
{
    "success": true,
    "data": {
        "conversations": [
            {
                "id": 789,
                "contact_id": 123,
                "inbox_id": 23,
                "status": "open",
                "labels": ["lead", "bot_activo"],
                "assignee": { "id": 5, "name": "Agente 1" },
                "created_at": "2024-01-15T10:30:00Z",
                "updated_at": "2024-01-15T14:20:00Z"
            }
        ],
        "meta": {
            "total": 150,
            "page": 1,
            "perPage": 50,
            "totalPages": 3
        }
    }
}
```

---

#### GET /api/v2/conversations/:id
**Obtener detalles de una conversación**

Query Parameters:
- `includeMessages` - true | false (default: false)

Response:
```json
{
    "success": true,
    "data": {
        "conversation": {
            "id": 789,
            "contact": {
                "id": 123,
                "name": "Juan Pérez",
                "email": "juan@example.com",
                "phone_number": "+59899123456"
            },
            "inbox": {
                "id": 23,
                "name": "WhatsApp",
                "channel_type": "Channel::Whatsapp"
            },
            "status": "open",
            "labels": ["lead"],
            "messages": [  // Solo si includeMessages=true
                {
                    "id": 111,
                    "content": "Hola, necesito información",
                    "message_type": "incoming",
                    "created_at": "2024-01-15T10:30:00Z"
                }
            ]
        }
    }
}
```

---

#### PUT /api/v2/conversations/:id/status
**Cambiar estado de una conversación**

Request Body:
```json
{
    "status": "resolved"  // "open" | "pending" | "resolved"
}
```

---

#### POST /api/v2/conversations/:id/messages
**Enviar un mensaje en una conversación**

Request Body:
```json
{
    "content": "Mensaje de respuesta",
    "message_type": "outgoing",  // "outgoing" | "incoming"
    "private": false  // true para notas internas
}
```

---

#### PUT /api/v2/conversations/:id/labels
**Actualizar etiquetas de una conversación**

Request Body:
```json
{
    "labels": ["lead", "comercial", "whatsapp"]
}
```

---

### DEALS / OPORTUNIDADES

#### POST /api/v2/deals
**Crear una oportunidad**

Request Body:
```json
{
    "contactId": 123,  // ID del contacto en Chatwoot
    "dealName": "Juan Pérez - Oportunidad",
    "stage": "prospecting",  // "prospecting" | "qualification" | "proposal" | "negotiation" | "closed_won" | "closed_lost"
    "amount": 1500,
    "currency": "UYU",
    "closeDate": "2024-12-31",
    "syncTo": ["rd_station"]  // Sincronizar con RD Station CRM
}
```

Response:
```json
{
    "success": true,
    "data": {
        "deal": {
            "id": "deal-456",
            "name": "Juan Pérez - Oportunidad",
            "stage": "prospecting",
            "amount": 1500,
            "contact": { /* datos del contacto */ }
        },
        "synced": {
            "rd_station": {
                "success": true,
                "dealId": "rd-deal-789"
            }
        }
    }
}
```

---

#### GET /api/v2/deals
**Listar oportunidades**

Query Parameters:
- `contactId` - Filtrar por contacto
- `stage` - Filtrar por etapa
- `limit` - Límite de resultados
- `page` - Página

---

#### PUT /api/v2/deals/:id
**Actualizar una oportunidad**

Request Body:
```json
{
    "stage": "closed_won",
    "amount": 2000,
    "syncTo": ["rd_station"]
}
```

---

### CAMPAÑAS

#### POST /api/v2/campaigns/onboarding
**Ejecutar campaña de onboarding**

Request Body:
```json
{
    "stage": 1,  // 0, 1, 7, 15, 30, 60, 90 (días)
    "leads": [
        {
            "name": "Juan Pérez",
            "email": "juan@example.com",
            "mobile_phone": "59899123456",
            "cf_id_equipo": "SERIAL123"
        }
    ]
}
```

Response (202 Accepted):
```json
{
    "success": true,
    "data": {
        "campaignId": "campaign-123",
        "stage": 1,
        "totalLeads": 50,
        "message": "Campaña de onboarding D+1 iniciada"
    }
}
```

---

#### POST /api/v2/campaigns/hsm
**Enviar campaña HSM por WhatsApp**

Request Body:
```json
{
    "campaignName": "webinar-vitel-tone",
    "message": "Texto del mensaje con variables {{nombre}}",
    "leads": [
        {
            "name": "Juan",
            "mobile_phone": "59899123456",
            "email": "juan@example.com",
            "variables": {
                "nombre": "Juan"
            }
        }
    ]
}
```

Response (202 Accepted):
```json
{
    "success": true,
    "data": {
        "jobId": "hsm-campaign-456",
        "received": 100,
        "statusUrl": "/api/v2/campaigns/hsm/status/hsm-campaign-456"
    }
}
```

---

#### GET /api/v2/campaigns/hsm/status/:jobId
**Estado de campaña HSM**

Response:
```json
{
    "success": true,
    "data": {
        "jobId": "hsm-campaign-456",
        "status": "completed",
        "summary": {
            "received": 100,
            "sent": 95,
            "skipped": 3,  // Duplicados o ya enviados
            "errors": 2
        },
        "details": [
            {
                "leadId": "abc-123",
                "number": "59899123456",
                "status": "sent"
            },
            {
                "leadId": "def-456",
                "number": "59899999999",
                "status": "error",
                "error": "Número inválido"
            }
        ]
    }
}
```

---

### WEBHOOKS

#### POST /api/v2/webhooks/chatwoot/message-created
**Webhook de Chatwoot cuando se crea un mensaje**

Request Body (ejemplo de webhook de Chatwoot):
```json
{
    "event": "message_created",
    "message_type": "outgoing",
    "conversation": {
        "id": 789,
        "inbox_id": 23
    },
    "sender": {
        "id": 5,
        "type": "user"  // "user" = agente, "contact" = cliente
    },
    "content": "Respuesta del agente"
}
```

Acciones:
- Si es mensaje de agente → Desactivar bot en Sailbot
- Cambiar estado de conversación
- Registrar evento en RD Station

---

#### POST /api/v2/webhooks/rdstation/conversion
**Webhook de RD Station para eventos de conversión**

Request Body (ejemplo de webhook de RD Station):
```json
{
    "leads": [
        {
            "id": "lead-123",
            "email": "juan@example.com",
            "mobile_phone": "59899123456",
            "name": "Juan Pérez",
            "conversion_identifier": "registro-portal"
        }
    ]
}
```

Acciones:
- Buscar/crear contacto en Chatwoot
- Actualizar custom attributes
- Registrar evento de conversión

---

### EXPORTACIÓN

#### POST /api/v2/export/conversations
**Exportar conversaciones a Excel**

Request Body:
```json
{
    "filters": {
        "inboxId": 23,
        "teamId": 4,
        "status": "resolved",
        "dateFrom": "2024-01-01",
        "dateTo": "2024-01-31",
        "labels": ["lead", "comercial"]
    },
    "includeMessages": true,
    "includeContactDetails": true
}
```

Response (202 Accepted):
```json
{
    "success": true,
    "data": {
        "jobId": "export-789",
        "statusUrl": "/api/v2/export/status/export-789",
        "message": "Exportación iniciada en background"
    }
}
```

---

#### GET /api/v2/export/status/:jobId
**Estado de exportación**

Response:
```json
{
    "success": true,
    "data": {
        "jobId": "export-789",
        "status": "completed",  // "processing" | "completed" | "failed"
        "progress": 100,
        "downloadUrl": "/api/v2/export/download/export-789",
        "expiresAt": "2024-01-20T10:00:00Z"
    }
}
```

---

#### GET /api/v2/export/download/:jobId
**Descargar archivo exportado**

Response: Archivo Excel (.xlsx)

---

### UTILIDADES / SISTEMA

#### GET /api/v2/health
**Health check del sistema**

Response:
```json
{
    "success": true,
    "data": {
        "status": "healthy",
        "services": {
            "chatwoot": {
                "status": "up",
                "responseTime": 120
            },
            "rdStation": {
                "status": "up",
                "circuitBreaker": "closed",
                "responseTime": 250
            },
            "evolution": {
                "status": "up",
                "responseTime": 180
            }
        },
        "timestamp": "2024-01-15T10:30:00Z"
    }
}
```

---

#### GET /api/v2/config/inboxes
**Obtener lista de inboxes de Chatwoot**

Response:
```json
{
    "success": true,
    "data": {
        "inboxes": [
            {
                "id": 23,
                "name": "WhatsApp",
                "channel_type": "Channel::Whatsapp",
                "phone_number": "+598 1234 5678"
            },
            {
                "id": 1,
                "name": "Email Support",
                "channel_type": "Channel::Email"
            }
        ]
    }
}
```

---

#### GET /api/v2/config/teams
**Obtener lista de equipos de Chatwoot**

---

#### GET /api/v2/config/custom-attributes
**Obtener atributos personalizados**

Query Parameters:
- `model` - "contact_attribute" | "conversation_attribute"

---

## 📦 MODELOS DE DATOS

### Contact Model

```javascript
// models/contact.model.js

/**
 * Modelo unificado de contacto
 * Representa un contacto que puede existir en Chatwoot y/o RD Station
 */
const ContactModel = {
    // Identificadores
    id: null,                    // ID interno del sistema que creó el contacto
    chatwootId: null,            // ID en Chatwoot
    rdStationUuid: null,         // UUID en RD Station
    
    // Información básica
    name: '',                    // Nombre completo
    firstName: '',               // Nombre
    lastName: '',                // Apellido
    email: '',                   // Email (obligatorio en RD, opcional en Chatwoot)
    
    // Contacto
    phoneNumber: '',             // Número principal (formato E164: +59899123456)
    mobilePhone: '',             // Teléfono móvil
    phone: '',                   // Teléfono fijo
    
    // Empresa
    company: '',
    position: '',
    website: '',
    
    // Dirección
    address: {
        line1: '',
        line2: '',
        city: '',
        state: '',
        country: 'UY',           // Código ISO de país
        zipCode: ''
    },
    
    // Social
    social: {
        facebook: '',
        twitter: '',
        instagram: '',
        linkedin: '',
        skype: ''
    },
    
    // Etapa del contacto (Lead Lifecycle)
    stage: 'lead',               // 'lead' | 'mql' | 'sql' | 'oportunidad' | 'cliente'
    score: 0,                    // Score del lead (RD Station)
    
    // Atributos personalizados específicos del negocio
    customAttributes: {
        tiene_ichef: 'No',       // 'Sí' | 'No'
        id_equipo: '',           // Serial del equipo iChef
        nickname: '',            // Nombre de usuario en el portal
        experiencia: '',         // 'principiante' | 'intermedio' | 'avanzado'
        gusta_cocinar: '',       // 'si' | 'no'
        participo_SDR: '',
        estado_sdr: '',
        // ... otros campos personalizados
    },
    
    // Deals/Oportunidades asociados
    deals: [],
    
    // Metadata
    source: '',                  // 'chatwoot' | 'rd_station' | 'inconcert' | 'manual'
    createdAt: null,
    updatedAt: null,
    
    // Chatwoot specific
    inboxId: null,               // ID del inbox en Chatwoot
    
    // RD Station specific
    rdStationFields: {
        language: '',
        membership: '',
        blacklist: false
    }
};

export default ContactModel;
```

### Deal Model

```javascript
// models/deal.model.js

/**
 * Modelo de Deal/Oportunidad
 */
const DealModel = {
    id: null,
    contactId: null,             // ID del contacto asociado
    
    // Información básica
    name: '',                    // Nombre del deal
    description: '',
    
    // Etapa del deal
    stage: '',                   // 'prospecting' | 'qualification' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost'
    
    // Financiero
    amount: 0,
    currency: 'UYU',             // 'UYU' | 'USD' | etc.
    probability: 0,              // Probabilidad de cierre (0-100)
    
    // Fechas
    closeDate: null,             // Fecha estimada de cierre
    createdAt: null,
    updatedAt: null,
    
    // Propietario
    owner: {
        id: null,
        name: ''
    },
    
    // Sistemas
    chatwootDealId: null,
    rdStationDealId: null
};

export default DealModel;
```

### Conversation Model

```javascript
// models/conversation.model.js

/**
 * Modelo de Conversación (específico de Chatwoot)
 */
const ConversationModel = {
    id: null,
    
    // Relaciones
    contactId: null,
    inboxId: null,
    assigneeId: null,
    teamId: null,
    
    // Estado
    status: 'open',              // 'open' | 'pending' | 'resolved'
    priority: 'normal',          // 'low' | 'normal' | 'high' | 'urgent'
    
    // Etiquetas
    labels: [],                  // Array de strings
    
    // Mensajes
    messages: [],                // Array de Message objects
    messageCount: 0,
    
    // Fechas
    createdAt: null,
    updatedAt: null,
    lastActivityAt: null,
    
    // Canal
    channel: '',                 // 'Channel::Whatsapp' | 'Channel::Email' | etc.
    sourceId: '',                // ID en el sistema externo (ej: número de WhatsApp)
    
    // Metadata
    customAttributes: {}
};

const MessageModel = {
    id: null,
    conversationId: null,
    
    // Contenido
    content: '',
    contentType: 'text',         // 'text' | 'image' | 'audio' | 'video' | 'file'
    contentAttributes: {},       // URLs de medios, etc.
    
    // Tipo
    messageType: 'incoming',     // 'incoming' | 'outgoing'
    private: false,              // true para notas internas
    
    // Sender
    sender: {
        id: null,
        type: '',                // 'user' | 'contact'
        name: ''
    },
    
    // Fechas
    createdAt: null
};

export { ConversationModel, MessageModel };
```

---

## 🗺️ MAPPERS (Transformadores de Datos)

### Contact Mapper

```javascript
// mappers/contact.mapper.js

import { normalizePhone } from '../utils/phone.utils.js';
import { normalizeEmail, generateEmailFromPhone } from '../utils/email.utils.js';

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
    
    const rdContact = {
        name: chatwootContact.name || '',
        email: chatwootContact.email || generateEmailFromPhone(chatwootContact.phone_number),
        
        // Teléfono: solo dígitos para RD Station
        mobile_phone: chatwootContact.phone_number 
            ? chatwootContact.phone_number.replace(/\D/g, '') 
            : '',
        
        // Campos estándar
        company: attrs.company || '',
        job_title: attrs.position || '',
        city: attrs.city || '',
        state: attrs.state || '',
        country: attrs.country || 'UY',
        
        // Campos personalizados (cf_*)
        cf_tiene_ichef: attrs.tiene_ichef || 'No',
        cf_id_equipo: attrs.id_equipo || '',
        cf_nickname: attrs.nickname || '',
        cf_experiencia: attrs.experiencia || '',
        cf_gusta_cocinar: attrs.gusta_cocinar || '',
        
        // Otros
        cf_chatwoot_id: chatwootContact.id?.toString() || '',
        cf_last_sync_from_chatwoot: new Date().toISOString()
    };

    return rdContact;
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
        'Customer': 'cliente'
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
        'oportunidad': 'Qualified Lead',
        'cliente': 'Customer'
    };
    
    return stageMap[internalStage] || 'Lead';
}
```

---

## 🛡️ MIDDLEWARE

### Auth Middleware

```javascript
// middleware/auth.middleware.js

/**
 * Middleware de autenticación por API Key
 */
export function authenticateApiKey(req, res, next) {
    const apiKey = req.headers['authorization']?.replace('Bearer ', '');
    
    if (!apiKey) {
        return res.status(401).json({
            success: false,
            error: {
                code: 'UNAUTHORIZED',
                message: 'API Key requerida en header Authorization'
            }
        });
    }

    // Validar API Key contra variable de entorno o base de datos
    const validApiKeys = process.env.VALID_API_KEYS?.split(',') || [];
    
    if (!validApiKeys.includes(apiKey)) {
        return res.status(401).json({
            success: false,
            error: {
                code: 'INVALID_API_KEY',
                message: 'API Key inválida'
            }
        });
    }

    next();
}

/**
 * Middleware de autenticación específico para webhooks
 * Valida tokens específicos por webhook
 */
export function authenticateWebhook(tokenEnvVar) {
    return (req, res, next) => {
        const token = req.headers['x-webhook-token'] || req.query.token;
        const validToken = process.env[tokenEnvVar];

        if (!token || token !== validToken) {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'INVALID_WEBHOOK_TOKEN',
                    message: 'Token de webhook inválido'
                }
            });
        }

        next();
    };
}
```

---

### Validator Middleware

```javascript
// middleware/validator.middleware.js

/**
 * Middleware genérico de validación de schemas
 * Usa un schema object con funciones de validación
 */
export function validate(schema) {
    return (req, res, next) => {
        const errors = [];

        // Validar body
        if (schema.body) {
            const bodyErrors = validateObject(req.body, schema.body);
            errors.push(...bodyErrors);
        }

        // Validar query params
        if (schema.query) {
            const queryErrors = validateObject(req.query, schema.query);
            errors.push(...queryErrors);
        }

        // Validar params
        if (schema.params) {
            const paramsErrors = validateObject(req.params, schema.params);
            errors.push(...paramsErrors);
        }

        if (errors.length > 0) {
            return res.status(422).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Errores de validación',
                    details: errors
                }
            });
        }

        next();
    };
}

function validateObject(data, schema) {
    const errors = [];

    for (const [field, rules] of Object.entries(schema)) {
        const value = data[field];

        // Required
        if (rules.required && (value === undefined || value === null || value === '')) {
            errors.push({
                field,
                message: `El campo ${field} es obligatorio`
            });
            continue;
        }

        // Si no es required y no tiene valor, skip otras validaciones
        if (!value && !rules.required) continue;

        // Type
        if (rules.type && typeof value !== rules.type) {
            errors.push({
                field,
                message: `El campo ${field} debe ser de tipo ${rules.type}`
            });
        }

        // Min length
        if (rules.minLength && value.length < rules.minLength) {
            errors.push({
                field,
                message: `El campo ${field} debe tener al menos ${rules.minLength} caracteres`
            });
        }

        // Max length
        if (rules.maxLength && value.length > rules.maxLength) {
            errors.push({
                field,
                message: `El campo ${field} no puede exceder ${rules.maxLength} caracteres`
            });
        }

        // Enum
        if (rules.enum && !rules.enum.includes(value)) {
            errors.push({
                field,
                message: `El campo ${field} debe ser uno de: ${rules.enum.join(', ')}`
            });
        }

        // Pattern (regex)
        if (rules.pattern && !rules.pattern.test(value)) {
            errors.push({
                field,
                message: rules.patternMessage || `El campo ${field} no tiene un formato válido`
            });
        }

        // Custom validator
        if (rules.validator && !rules.validator(value)) {
            errors.push({
                field,
                message: rules.validatorMessage || `El campo ${field} no es válido`
            });
        }
    }

    return errors;
}
```

---

### Error Middleware

```javascript
// middleware/error.middleware.js

/**
 * Middleware centralizado de manejo de errores
 * Debe ser el último middleware registrado
 */
export function errorHandler(err, req, res, next) {
    console.error('Error capturado:', {
        message: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        body: req.body
    });

    // Errores de validación (Joi, express-validator, etc.)
    if (err.name === 'ValidationError') {
        return res.status(422).json({
            success: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: err.message,
                details: err.details
            }
        });
    }

    // Errores de Axios (peticiones HTTP a APIs externas)
    if (err.isAxiosError) {
        return res.status(err.response?.status || 500).json({
            success: false,
            error: {
                code: 'EXTERNAL_API_ERROR',
                message: err.message,
                service: err.config?.baseURL || 'unknown',
                details: err.response?.data
            }
        });
    }

    // Circuit breaker abierto
    if (err.message.includes('Circuit breaker')) {
        return res.status(503).json({
            success: false,
            error: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'Servicio externo no disponible temporalmente',
                details: err.message
            }
        });
    }

    // Error genérico
    res.status(err.statusCode || 500).json({
        success: false,
        error: {
            code: err.code || 'INTERNAL_SERVER_ERROR',
            message: err.message || 'Error interno del servidor'
        }
    });
}

/**
 * Middleware para rutas no encontradas (404)
 */
export function notFoundHandler(req, res, next) {
    res.status(404).json({
        success: false,
        error: {
            code: 'NOT_FOUND',
            message: `Ruta no encontrada: ${req.method} ${req.url}`
        }
    });
}
```

---

### Rate Limit Middleware

```javascript
// middleware/ratelimit.middleware.js

import rateLimit from 'express-rate-limit';

/**
 * Rate limiter general para la API
 */
export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // 100 requests por ventana
    message: {
        success: false,
        error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Demasiadas peticiones, por favor intenta más tarde'
        }
    },
    standardHeaders: true,
    legacyHeaders: false
});

/**
 * Rate limiter estricto para webhooks
 */
export const webhookLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minuto
    max: 30, // 30 requests por minuto
    message: {
        success: false,
        error: {
            code: 'WEBHOOK_RATE_LIMIT_EXCEEDED',
            message: 'Demasiados webhooks recibidos'
        }
    }
});
```

---

## ⚙️ CONFIGURACIÓN

### Chatwoot Config

```javascript
// config/chatwoot.config.js

export const chatwootConfig = {
    url: process.env.CHATWOOT_URL || 'https://contact-center.5vsa59.easypanel.host',
    apiToken: process.env.API_ACCESS_TOKEN,
    accountId: parseInt(process.env.CHATWOOT_ACCOUNT_ID || '2'),
    
    // IDs de inboxes comunes (pueden cachearse)
    inboxes: {
        whatsapp: parseInt(process.env.CHATWOOT_INBOX_WHATSAPP || '23'),
        email: parseInt(process.env.CHATWOOT_INBOX_EMAIL || '1')
    },
    
    // Timeouts
    timeout: 30000,
    
    // Reintentos
    retry: {
        attempts: 3,
        delay: 1000,
        backoff: 2
    }
};
```

### RD Station Config

```javascript
// config/rdstation.config.js

export const rdStationConfig = {
    apiUrl: process.env.RDSTATION_URL || 'https://api.rd.services',
    crmUrl: process.env.RDSTATION_CRM_URL || 'https://crm.rdstation.com',
    
    // Credenciales OAuth2
    clientId: process.env.RDSTATION_CLIENT_ID,
    clientSecret: process.env.RDSTATION_CLIENT_SECRET,
    refreshToken: process.env.RDSTATION_REFRESH_TOKEN,
    
    // Token para CRM
    userToken: process.env.RDSTATION_USER_TOKEN,
    
    // Opciones válidas para campos personalizados
    fieldOptions: {
        'cf_experiencia': ['principiante', 'intermedio', 'avanzado'],
        'cf_gusta_cocinar': ['si', 'no'],
        'cf_tiene_ichef': ['Sí', 'No'],
        'cf_categoria_contacto': ['lead', 'cliente', 'prospecto', 'otro']
    },
    
    // Circuit breaker
    circuitBreaker: {
        failureThreshold: 5,
        resetTimeout: 300000 // 5 minutos
    }
};
```

### Evolution Config

```javascript
// config/evolution.config.js

export const evolutionConfig = {
    baseUrl: process.env.EVOLUTION_API_URL || 'https://evolution-evolution.5vsa59.easypanel.host',
    apiKey: process.env.EVOLUTION_APIKEY,
    instance: process.env.EVOLUTION_INSTANCE || 'iChef Center Wpp',
    
    endpoints: {
        sendText: `/message/sendText/${process.env.EVOLUTION_INSTANCE}`,
        sendMedia: `/message/sendMedia/${process.env.EVOLUTION_INSTANCE}`
    },
    
    // TTL para dedupe de mensajes HSM
    dedupeTTL: parseInt(process.env.HSM_DEDUPE_TTL_MS || '86400000') // 24 horas
};
```

---

## 🧪 EJEMPLOS DE IMPLEMENTACIÓN

### Ejemplo: Controller usando Service

```javascript
// controllers/contact.controller.js

import contactService from '../services/contact.service.js';

export const createContact = async (req, res, next) => {
    try {
        const { source = 'chatwoot', syncTo = [] } = req.body;
        const contactData = req.body;

        let result;

        // Crear en el sistema origen
        if (source === 'chatwoot') {
            result = await contactService.syncFromChatwootToRD(contactData);
        } else if (source === 'rd_station') {
            result = await contactService.syncFromRDToChatwoot(contactData);
        }

        // Sincronizar con otros sistemas si se especifica
        const synced = {};
        for (const targetSystem of syncTo) {
            try {
                if (targetSystem === 'rd_station' && source !== 'rd_station') {
                    await contactService.syncFromChatwootToRD(result.contact);
                    synced.rd_station = { success: true };
                } else if (targetSystem === 'chatwoot' && source !== 'chatwoot') {
                    await contactService.syncFromRDToChatwoot(result.contact);
                    synced.chatwoot = { success: true };
                }
            } catch (syncError) {
                synced[targetSystem] = { success: false, error: syncError.message };
            }
        }

        res.status(201).json({
            success: true,
            data: {
                contact: result.contact,
                created: result.created,
                synced
            }
        });

    } catch (error) {
        next(error);
    }
};

export const getContact = async (req, res, next) => {
    try {
        const { identifier } = req.params;
        const { type = 'id', source = 'all' } = req.query;

        let criteria = {};
        if (type === 'email') {
            criteria.email = identifier;
        } else if (type === 'phone') {
            criteria.phone_number = identifier;
        } else {
            criteria.id = identifier;
        }

        const contacts = await contactService.findInAllSystems(criteria);

        if (source === 'all') {
            res.json({
                success: true,
                data: contacts
            });
        } else {
            res.json({
                success: true,
                data: contacts[source]
            });
        }

    } catch (error) {
        next(error);
    }
};
```

---

### Ejemplo: Validator Schema

```javascript
// validators/contact.validator.js

import { isValidEmail } from '../utils/email.utils.js';
import { isValidPhone } from '../utils/phone.utils.js';

export const createContactSchema = {
    body: {
        name: {
            required: true,
            type: 'string',
            minLength: 2,
            maxLength: 100
        },
        email: {
            required: false,
            type: 'string',
            validator: isValidEmail,
            validatorMessage: 'Email inválido'
        },
        phone: {
            required: false,
            type: 'string',
            validator: isValidPhone,
            validatorMessage: 'Número de teléfono inválido'
        },
        source: {
            required: true,
            type: 'string',
            enum: ['chatwoot', 'rd_station']
        },
        syncTo: {
            required: false,
            type: 'object',
            validator: (value) => Array.isArray(value),
            validatorMessage: 'syncTo debe ser un array'
        }
    }
};

export const updateContactSchema = {
    params: {
        id: {
            required: true,
            type: 'string',
            pattern: /^\d+$/,
            patternMessage: 'ID debe ser numérico'
        }
    },
    body: {
        name: {
            required: false,
            type: 'string',
            minLength: 2,
            maxLength: 100
        },
        email: {
            required: false,
            type: 'string',
            validator: isValidEmail
        },
        phone: {
            required: false,
            type: 'string',
            validator: isValidPhone
        }
    }
};
```

---

### Ejemplo: Route con Middleware

```javascript
// routes/v2/contact.routes.js

import express from 'express';
import { 
    createContact, 
    getContact, 
    updateContact, 
    deleteContact,
    syncContact,
    bulkImport
} from '../../controllers/contact.controller.js';
import { authenticateApiKey } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validator.middleware.js';
import { createContactSchema, updateContactSchema } from '../../validators/contact.validator.js';

const router = express.Router();

// Aplicar autenticación a todas las rutas
router.use(authenticateApiKey);

// Rutas
router.post('/', validate(createContactSchema), createContact);
router.get('/:identifier', getContact);
router.put('/:id', validate(updateContactSchema), updateContact);
router.delete('/:id', deleteContact);
router.post('/sync', syncContact);
router.post('/bulk-import', bulkImport);

export default router;
```

---

### Ejemplo: App.js Principal

```javascript
// src/app.js

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';

// Middleware
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import { apiLimiter } from './middleware/ratelimit.middleware.js';

// Routes
import v2Routes from './routes/v2/index.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

// Middleware global
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// Health check (sin autenticación)
app.get('/health', (req, res) => {
    res.json({ success: true, status: 'healthy', timestamp: new Date().toISOString() });
});

// Rate limiting para la API
app.use('/api', apiLimiter);

// Routes
app.use('/api/v2', v2Routes);

// Manejo de errores
app.use(notFoundHandler);
app.use(errorHandler);

app.listen(port, () => {
    console.log(`✅ Servidor corriendo en puerto ${port}`);
    console.log(`📍 API v2: http://localhost:${port}/api/v2`);
});

export default app;
```

---

## 🚀 GUÍA DE MIGRACIÓN DE V1 A V2

### Fase 1: Setup Inicial

1. Crear nueva estructura de carpetas `src/`
2. Instalar dependencias adicionales (si las hay)
3. Crear archivos de configuración centralizados
4. Implementar utilidades básicas (phone, email, validator)

### Fase 2: Clients y Services

1. Implementar `chatwoot.client.js`
2. Implementar `rdstation.client.js`
3. Implementar `evolution.client.js`
4. Implementar `contact.service.js`
5. Implementar mappers de datos

### Fase 3: Middleware y Validación

1. Implementar middleware de autenticación
2. Implementar middleware de validación
3. Implementar middleware de errores
4. Implementar rate limiting

### Fase 4: Controllers y Routes V2

1. Migrar endpoints de contactos
2. Migrar endpoints de conversaciones
3. Migrar endpoints de deals
4. Migrar endpoints de campañas
5. Migrar endpoints de webhooks
6. Migrar endpoints de exportación

### Fase 5: Testing y Documentación

1. Crear tests unitarios para utils y services
2. Crear tests de integración para endpoints
3. Generar documentación OpenAPI/Swagger
4. Crear guías de uso

### Fase 6: Deploy y Transición

1. Mantener V1 funcionando en `/api/v1`
2. Desplegar V2 en `/api/v2`
3. Migrar clientes/integraciones gradualmente
4. Deprecar V1 después de período de transición

---

## 📝 CHECKLIST DE IMPLEMENTACIÓN

### Estructura Base
- [ ] Crear estructura de carpetas propuesta
- [ ] Configurar package.json con nuevas dependencias
- [ ] Configurar .env.example con todas las variables
- [ ] Crear archivos de configuración (config/)

### Utilidades
- [ ] phone.utils.js - Normalización de teléfonos
- [ ] email.utils.js - Generación y validación de emails
- [ ] validator.utils.js - Validaciones comunes
- [ ] cache.utils.js - Sistema de caché simple
- [ ] retry.utils.js - Lógica de reintentos
- [ ] circuitbreaker.utils.js - Circuit breaker pattern

### Clients
- [ ] base.client.js - Cliente base con circuit breaker
- [ ] chatwoot.client.js - Cliente completo de Chatwoot
- [ ] rdstation.client.js - Cliente completo de RD Station
- [ ] evolution.client.js - Cliente de Evolution API

### Mappers
- [ ] contact.mapper.js - Transformaciones entre sistemas
- [ ] deal.mapper.js - Transformaciones de deals
- [ ] stage.mapper.js - Mapeo de etapas

### Services
- [ ] contact.service.js - Lógica de negocio de contactos
- [ ] conversation.service.js - Gestión de conversaciones
- [ ] deal.service.js - Gestión de oportunidades
- [ ] campaign.service.js - Campañas y onboarding
- [ ] sync.service.js - Sincronización bidireccional
- [ ] export.service.js - Exportación de datos

### Middleware
- [ ] auth.middleware.js - Autenticación
- [ ] validator.middleware.js - Validación de schemas
- [ ] error.middleware.js - Manejo de errores
- [ ] ratelimit.middleware.js - Rate limiting
- [ ] logger.middleware.js - Logging estructurado

### Controllers
- [ ] contact.controller.js
- [ ] conversation.controller.js
- [ ] deal.controller.js
- [ ] campaign.controller.js
- [ ] export.controller.js
- [ ] webhook.controller.js

### Routes
- [ ] contact.routes.js
- [ ] conversation.routes.js
- [ ] deal.routes.js
- [ ] campaign.routes.js
- [ ] export.routes.js
- [ ] webhook.routes.js
- [ ] index.js - Router principal

### Validators
- [ ] contact.validator.js
- [ ] deal.validator.js
- [ ] campaign.validator.js

### Models
- [ ] contact.model.js
- [ ] deal.model.js
- [ ] conversation.model.js

### Tests
- [ ] Tests unitarios de utils
- [ ] Tests unitarios de services
- [ ] Tests de integración de endpoints
- [ ] Tests de mappers

### Documentación
- [ ] README.md actualizado
- [ ] OpenAPI/Swagger spec
- [ ] Guías de uso por funcionalidad
- [ ] Ejemplos de requests/responses

### Deploy
- [ ] Configurar CI/CD
- [ ] Variables de entorno en producción
- [ ] Monitoreo y logging
- [ ] Backups y recuperación

---

## 🎓 PRINCIPIOS Y MEJORES PRÁCTICAS

### Principios de Código

1. **DRY (Don't Repeat Yourself)** - Centralizar código repetido
2. **SOLID** - Single Responsibility, Open/Closed, etc.
3. **KISS (Keep It Simple, Stupid)** - Mantener simplicidad
4. **YAGNI (You Aren't Gonna Need It)** - No sobre-ingeniería

### Convenciones de Naming

- **Archivos**: `kebab-case.js` (ej: `contact.service.js`)
- **Clases**: `PascalCase` (ej: `ChatwootClient`)
- **Funciones**: `camelCase` (ej: `normalizePhone`)
- **Constantes**: `UPPER_SNAKE_CASE` (ej: `API_BASE_URL`)
- **Variables**: `camelCase` (ej: `contactData`)

### Estructura de Funciones

```javascript
/**
 * Descripción breve de la función
 * 
 * @param {type} paramName - Descripción del parámetro
 * @returns {type} - Descripción del retorno
 * 
 * @example
 * functionName(param) // resultado
 */
function functionName(paramName) {
    // Implementación
}
```

### Manejo de Errores

```javascript
try {
    // Operación
} catch (error) {
    console.error('Contexto del error:', {
        message: error.message,
        context: 'información relevante'
    });
    throw error; // Re-throw para que lo maneje el middleware
}
```

### Logging

```javascript
console.log('✅ Operación exitosa');
console.error('❌ Error crítico');
console.warn('⚠️  Advertencia');
console.info('ℹ️  Información');
```

---

## 🔐 SEGURIDAD

### Variables de Entorno

- **NUNCA** commitear archivo `.env` al repositorio
- Usar `.env.example` como template
- Usar secretos fuertes para API Keys
- Rotar tokens periódicamente

### Autenticación

- Implementar autenticación por API Key en todos los endpoints públicos
- Usar tokens diferentes para cada webhook
- Validar origen de webhooks cuando sea posible

### Validación

- Validar TODOS los inputs del usuario
- Sanitizar datos antes de procesarlos
- Límites en tamaños de requests (ej: 10MB)

### Rate Limiting

- Implementar rate limiting global
- Rate limiting más estricto en webhooks
- Considerar rate limiting por IP o API Key

---

## 📊 MONITOREO Y OBSERVABILIDAD

### Logging Estructurado

```javascript
// Usar formato estructurado para logs
console.log(JSON.stringify({
    level: 'info',
    timestamp: new Date().toISOString(),
    event: 'contact_created',
    contactId: 123,
    source: 'rd_station'
}));
```

### Métricas

- Tiempo de respuesta de endpoints
- Tasa de errores por endpoint
- Estado de circuit breakers
- Contadores de operaciones (contactos creados, actualizados, etc.)

### Health Checks

- Endpoint `/health` que verifica:
  - Estado de la aplicación
  - Conectividad con APIs externas
  - Estado de circuit breakers

---

## 🎯 CONCLUSIÓN

Este documento proporciona una especificación completa para desarrollar la **API V2** de integración Chatwoot-RD Station con:

- ✅ Arquitectura limpia y modular
- ✅ Código reutilizable y DRY
- ✅ Validaciones y manejo de errores robusto
- ✅ Documentación completa de endpoints
- ✅ Ejemplos de implementación
- ✅ Mejores prácticas de seguridad
- ✅ Guía de migración desde V1

### Próximos Pasos

1. Revisar y aprobar esta especificación
2. Comenzar implementación fase por fase
3. Crear tests conforme se desarrolla
4. Documentar cada módulo implementado
5. Realizar testing exhaustivo
6. Deploy gradual manteniendo V1 operativa

---

**Fecha de Creación:** 22 de abril de 2026  
**Versión del Documento:** 1.0  
**Autor:** Especificación generada para migración V1 → V2

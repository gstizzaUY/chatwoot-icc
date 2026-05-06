import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Cliente HTTP centralizado para RD Station API
 * 
 * Gestiona automáticamente:
 * - Refresh de tokens OAuth2
 * - Retry en caso de token expirado
 * - Circuit breaker para errores de servidor
 */
class RDStationClient {
    constructor() {
        this.baseURL = process.env.RDSTATION_URL || 'https://api.rd.services';
        this.crmURL = process.env.RDSTATION_CRM_URL || 'https://crm.rdstation.com';
        
        this.credentials = {
            clientId: process.env.RDSTATION_CLIENT_ID,
            clientSecret: process.env.RDSTATION_CLIENT_SECRET,
            refreshToken: process.env.RDSTATION_REFRESH_TOKEN,
            userToken: process.env.RDSTATION_USER_TOKEN
        };

        this.accessToken = null;

        this.client = axios.create({
            baseURL: this.baseURL,
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        // Interceptor para agregar token
        this.client.interceptors.request.use(async (config) => {
            if (!this.accessToken) {
                await this.refreshAccessToken();
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
                    await this.refreshAccessToken();
                    return this.client(originalRequest);
                }

                throw error;
            }
        );
    }

    /**
     * Refresca el access token usando el refresh token
     */
    async refreshAccessToken() {
        try {
            const response = await axios.post(`${this.baseURL}/auth/token`, {
                client_id: this.credentials.clientId,
                client_secret: this.credentials.clientSecret,
                refresh_token: this.credentials.refreshToken
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
     */
    async getContact(email) {
        try {
            const response = await this.client.get(
                `/platform/contacts/email:${encodeURIComponent(email)}`
            );
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
     */
    async createContact(contactData) {
        try {
            console.log('📤 Creando contacto en RD Station:', JSON.stringify(contactData, null, 2));
            const response = await this.client.post('/platform/contacts', contactData);
            console.log('✅ Contacto creado en RD Station');
            return response.data;
        } catch (error) {
            console.error('❌ Error creando contacto en RD Station:', error.message);
            if (error.response?.data) {
                console.error('🚨 Respuesta de error de RD Station:', JSON.stringify(error.response.data, null, 2));
            }
            throw error;
        }
    }

    /**
     * Actualiza un contacto existente
     */
    async updateContact(email, updateData) {
        try {
            console.log(`📤 Actualizando contacto en RD Station (${email}):`, JSON.stringify(updateData, null, 2));
            const response = await this.client.patch(
                `/platform/contacts/email:${encodeURIComponent(email)}`,
                updateData
            );
            console.log('✅ Contacto actualizado en RD Station');
            return response.data;
        } catch (error) {
            console.error('Error actualizando contacto en RD Station:', error.message);
            if (error.response?.data) {
                console.error('🚨 Respuesta de error de RD Station:', JSON.stringify(error.response.data, null, 2));
            }
            throw error;
        }
    }

    /**
     * Crea o actualiza un contacto (upsert)
     * @param {Object} contactData - Datos del contacto
     * @param {String} previousEmail - Email anterior para buscar (si cambió)
     */
    async upsertContact(contactData, previousEmail = null) {
        const newEmail = contactData.email;
        
        // Si hay email anterior diferente, buscar con ese email
        const emailParaBuscar = previousEmail || newEmail;
        const existing = await this.getContact(emailParaBuscar);

        if (existing) {
            console.log(`ℹ️ Contacto existente encontrado con: ${emailParaBuscar}`);
            
            // Si el email cambió, incluirlo en el update para actualizarlo
            if (previousEmail && previousEmail !== newEmail) {
                console.log(`📧 Actualizando email: ${previousEmail} → ${newEmail}`);
                const updated = await this.updateContact(previousEmail, contactData);
                return { contact: updated, created: false, emailUpdated: true };
            } else {
                // Email no cambió, excluir del payload (no es necesario)
                const { email: _, ...updateData } = contactData;
                const updated = await this.updateContact(newEmail, updateData);
                return { contact: updated, created: false, emailUpdated: false };
            }
        } else {
            console.log('ℹ️ Contacto nuevo, creando');
            const created = await this.createContact(contactData);
            return { contact: created, created: true };
        }
    }

    // ==================== EVENTOS ====================

    /**
     * Envía un evento de conversión
     */
    async sendConversionEvent(email, conversionIdentifier, additionalFields = {}) {
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
            
            return response.data;
        } catch (error) {
            console.error('Error enviando evento de conversión:', error.message);
            throw error;
        }
    }

    // ==================== CRM (DEALS) ====================

    /**
     * Crea una oportunidad en RD Station CRM
     */
    async createDeal(dealData) {
        const crmClient = axios.create({
            baseURL: this.crmURL,
            headers: {
                'Authorization': `Bearer ${this.credentials.userToken}`,
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
     */
    async updateDeal(dealId, updateData) {
        const crmClient = axios.create({
            baseURL: this.crmURL,
            headers: {
                'Authorization': `Bearer ${this.credentials.userToken}`,
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
}

// Export singleton
const rdStationClient = new RDStationClient();
export default rdStationClient;

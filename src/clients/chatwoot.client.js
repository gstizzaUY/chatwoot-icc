import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Cliente HTTP centralizado para Chatwoot API
 * 
 * Proporciona métodos para interactuar con la API de Chatwoot:
 * - Contactos (buscar, crear, actualizar, eliminar)
 * - Conversaciones (obtener, cambiar estado, enviar mensajes)
 * - Inboxes y Teams
 * - Atributos personalizados
 */
class ChatwootClient {
    constructor() {
        const chatwootUrl = process.env.CHATWOOT_URL || 'https://contact-center.5vsa59.easypanel.host';
        const accountId = process.env.CHATWOOT_ACCOUNT_ID || '2';
        
        this.client = axios.create({
            baseURL: `${chatwootUrl}/api/v1/accounts/${accountId}`,
            headers: {
                'Content-Type': 'application/json',
                'api_access_token': process.env.API_ACCESS_TOKEN
            },
            timeout: 30000
        });

        // Interceptor para logging de errores
        this.client.interceptors.response.use(
            response => response,
            error => {
                console.error('❌ Chatwoot API Error:', {
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
     * Obtiene un contacto directamente por su ID
     * Método más confiable que findContact para IDs conocidos
     */
    async getContactById(contactId) {
        try {
            const response = await this.client.get(`/contacts/${contactId}`);
            return response.data.payload;
        } catch (error) {
            if (error.response?.status === 404) {
                console.warn(`⚠️ Contacto ${contactId} no encontrado`);
                return null;
            }
            console.error(`Error obteniendo contacto ${contactId}:`, error.message);
            return null;
        }
    }

    /**
     * Busca un contacto por ID, email o teléfono
     * NOTA: El endpoint /contacts/filter puede fallar. Para IDs usar getContactById
     */
    async findContact(filters) {
        // Si solo se proporciona ID, usar el método directo
        if (filters.id && !filters.email && !filters.phone_number) {
            return await this.getContactById(filters.id);
        }

        const payload = this._buildFilterPayload(filters);
        
        try {
            const response = await this.client.post('/contacts/filter', payload);
            
            if (response.data.meta.count > 0) {
                return response.data.payload[0];
            }
            return null;
        } catch (error) {
            console.error('Error buscando contacto:', filters, error.message);
            // Si el filtro falla y tenemos un ID, intentar con el método directo como fallback
            if (filters.id) {
                console.log('⚠️ Intentando método alternativo: getContactById');
                return await this.getContactById(filters.id);
            }
            return null;
        }
    }

    /**
     * Crea un nuevo contacto en Chatwoot
     */
    async createContact(contactData) {
        try {
            const response = await this.client.post('/contacts', contactData);
            return response.data;
        } catch (error) {
            console.error('Error creando contacto:', error.message);
            throw error;
        }
    }

    /**
     * Actualiza un contacto existente
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
     */
    async upsertContact(contactData) {
        const existing = await this.findContact({
            id: contactData.id,
            email: contactData.email,
            phone_number: contactData.phone_number
        });

        if (existing) {
            const updated = await this.updateContact(existing.id, contactData);
            return { contact: updated, created: false };
        } else {
            const created = await this.createContact(contactData);
            return { contact: created, created: true };
        }
    }

    // ==================== CONVERSACIONES ====================

    /**
     * Obtiene una conversación específica
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
     * Obtiene los mensajes de una conversación
     */
    async getConversationMessages(conversationId) {
        try {
            const response = await this.client.get(`/conversations/${conversationId}/messages`);
            return response.data.payload || [];
        } catch (error) {
            console.error(`Error obteniendo mensajes de conversación ${conversationId}:`, error.message);
            return [];
        }
    }

    /**
     * Cambia el estado de una conversación
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

    /**
     * Marca una conversación como no leída para los agentes
     * Resetea agent_last_seen_at para que la conversación aparezca en negrita
     */
    async markAsUnread(conversationId) {
        try {
            const response = await this.client.post(
                `/conversations/${conversationId}/unread`
            );
            return response.data;
        } catch (error) {
            console.warn(`⚠️  No se pudo marcar como no leída la conversación ${conversationId}:`, error.message);
            return null;
        }
    }

    /**
     * Obtiene las conversaciones de un contacto
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
     * Crea una nueva conversación en un inbox vinculada a un contacto
     */
    async createConversation({ inbox_id, contact_id, status = 'open', assignee_id = null, team_id = null }) {
        try {
            const payload = { inbox_id, contact_id, status };
            if (assignee_id) payload.assignee_id = assignee_id;
            if (team_id) payload.team_id = team_id;
            const response = await this.client.post('/conversations', payload);
            return response.data;
        } catch (error) {
            console.error('Error creando conversación:', error.message);
            throw error;
        }
    }

    // ==================== HELPERS PRIVADOS ====================

    /**
     * Construye el payload de filtro para búsqueda de contactos
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
const chatwootClient = new ChatwootClient();
export default chatwootClient;

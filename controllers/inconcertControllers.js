import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const inconcert_url = process.env.INCONCERT_URL;
const serviceToken = process.env.INCONCERT_CREATE_CONTACT_TOKEN
const chatwoot_url = process.env.CHATWOOT_URL;
const api_access_token = process.env.API_ACCESS_TOKEN;


const chatwootWebhook = async (req, res) => {
    try {
        const webhook = req.body;

        if (!webhook || webhook.event !== 'contact_created') {
            return res.status(400).json({
                error: 'Evento no soportado o datos inválidos'
            });
        }

        // Validar datos requeridos
        if (!webhook.name || !webhook.email || !webhook.phone_number) {
            return res.status(400).json({
                error: 'Faltan datos requeridos del contacto'
            });
        }

        const dataContact = {
            "serviceToken": serviceToken,
            "serviceAction": "form",
            "contactData": {
                "firstname": webhook.name,
                "lastname": "",
                "email": webhook.email,
                "phone": webhook.phone_number,
                "city": webhook.additional_attributes?.city || '',
                "country": webhook.additional_attributes?.country_code || '',
                "company": webhook.additional_attributes?.company_name || '',
            }
        };

        const response = await axios.post(`${inconcert_url}`, dataContact, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        return res.status(200).json({
            success: true,
            message: 'Contacto procesado correctamente'
        });
    } catch (error) {
        console.error('Error en chatwootWebhook:', error);
        return res.status(500).json({
            error: error.message || 'Error interno del servidor'
        });
    }
};


// Convertir en capañas de inconcert según el canal
// Constantes para los canales soportados
const CHANNELS = {
    WHATSAPP: 'Channel::Whatsapp',
    EMAIL: 'Channel::Email',
    FACEBOOK: 'Channel::FacebookPage',
    API: 'Channel::Api'
};

// Mapeo de canales a tokens de ambiente
const CHANNEL_TOKEN_MAP = {
    [CHANNELS.WHATSAPP]: 'INCONCERT_CONVERSATION_CREATED_WHATSAPP_TOKEN',
    [CHANNELS.EMAIL]: 'INCONCERT_CONVERSATION_CREATED_EMAIL_TOKEN',
    [CHANNELS.FACEBOOK]: 'INCONCERT_CONVERSATION_CREATED_INSTAGRAM_TOKEN',
    [CHANNELS.API]: 'INCONCERT_CONVERSATION_CREATED_MANUAL_TOKEN'
};

// Validador de datos requeridos
const validateWebhookData = (webhook) => {
    if (!webhook?.meta?.sender) {
        throw new Error('Datos del remitente no encontrados');
    }

    const requiredFields = ['name', 'email', 'phone_number'];
    const missingFields = requiredFields.filter(field => !webhook.meta.sender[field]);

    if (missingFields.length > 0) {
        throw new Error(`Campos requeridos faltantes: ${missingFields.join(', ')}`);
    }
};

const createContactData = (webhook) => {
    return {
        firstname: webhook.meta.sender.name || '',
        lastname: '',
        email: webhook.meta.sender.email || '',
        phone: webhook.meta.sender.phone_number || '',
        city: webhook.meta?.additional_attributes?.city || '',
        country: webhook.meta?.additional_attributes?.country_code || '',
        company: webhook.meta?.additional_attributes?.company_name || ''
    };
};

const chatwootWebhookConversationCreated = async (req, res) => {
    try {
        const webhook = req.body;

        // Validar que el canal sea soportado
        if (!Object.values(CHANNELS).includes(webhook.channel)) {
            return res.status(400).json({
                error: 'Canal no soportado'
            });
        }

        // Validar datos requeridos
        validateWebhookData(webhook);

        const inconcert_url = process.env.INCONCERT_URL;
        if (!inconcert_url) {
            throw new Error('URL de Inconcert no configurada');
        }

        const serviceToken = process.env[CHANNEL_TOKEN_MAP[webhook.channel]];
        if (!serviceToken) {
            throw new Error(`Token no configurado para el canal ${webhook.channel}`);
        }

        const dataConversation = {
            serviceToken,
            serviceAction: "form",
            contactData: createContactData(webhook)
        };

        const response = await axios.post(inconcert_url, dataConversation, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        return res.status(200).json({
            success: true,
            message: 'Conversación procesada correctamente'
        });

    } catch (error) {
        console.error('Error en chatwootWebhookConversationCreated:', error);
        return res.status(500).json({
            error: error.message || 'Error interno del servidor'
        });
    }
};


const chatwootCampaignCreatedSdrPrueba = async (req, res) => {
    const contactData = req.body;

    // Buscar el contacto en Chatwoot
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
            { id: contactData.id, key: 'id' },
            { id: contactData.email, key: 'email' },
            { id: contactData.phone, key: 'phone_number' }
        ]
            .map(item => buildPayloadItem(item.key, item.id))
            .filter(Boolean)
            .map((item, index, array) => ({
                ...item,
                query_operator: index === array.length - 1 ? null : "OR"
            }))
    };

    try {
        const response = await axios.post(`${chatwoot_url}/api/v1/accounts/2/contacts/filter`, payload, {
            headers: {
                'Content-Type': 'application/json',
                'api_access_token': api_access_token,
            },
        });
        if (response.data.meta.count > 0) {
            const conversationData = {
                inbox_id: contactData.inbox_id || "20",
                source_id: response.data.payload[0].custom_attributes.id,
                contact_id: response.data.payload[0].id,
                status: 'pending',
                team_id: 1,
                message: {
                    content: contactData.system_message || '',
                }
            };

            try {
                const response = await axios.post(`${chatwoot_url}/api/v1/accounts/2/conversations`, conversationData, {
                    headers: {
                        'Content-Type': 'application/json',
                        'api_access_token': api_access_token,
                    },
                });
                res.status(200).json(response.data);
            }
            catch (error) {
                console.error('Error al crear la conversación en Chatwoot:', error);
                res.status(500).json({ error: error.message, detalles: error });
            }
        } else {
            console.log('Contacto no encontrado en Chatwoot');
            res.status(404).json({ message: 'Contacto no encontrado en Chatwoot' });
        }
    } catch (error) {
        console.error(` Error:`, error);
        res.status(500).json({ error: error.message, detalles: error });
    }
};


const chatwootCampaignCreatedExpoBebe2025 = async (req, res) => {
    const contactData = req.body;

    // Buscar el contacto en Chatwoot
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
            { id: contactData.id, key: 'id' },
            { id: contactData.email, key: 'email' },
            { id: contactData.phone, key: 'phone_number' }
        ]
            .map(item => buildPayloadItem(item.key, item.id))
            .filter(Boolean)
            .map((item, index, array) => ({
                ...item,
                query_operator: index === array.length - 1 ? null : "OR"
            }))
    };

    try {
        const response = await axios.post(`${chatwoot_url}/api/v1/accounts/2/contacts/filter`, payload, {
            headers: {
                'Content-Type': 'application/json',
                'api_access_token': api_access_token,
            },
        });
        if (response.data.meta.count > 0) {
            const conversationData = {
                inbox_id: contactData.inbox_id || "14",
                source_id: response.data.payload[0].custom_attributes.id,
                contact_id: response.data.payload[0].id,
                status: 'open',
                team_id: 2,
                message: {
                    content: contactData.system_message || '',
                }
            };

            try {
                const response = await axios.post(`${chatwoot_url}/api/v1/accounts/2/conversations`, conversationData, {
                    headers: {
                        'Content-Type': 'application/json',
                        'api_access_token': api_access_token,
                    },
                });
                res.status(200).json(response.data);
            }
            catch (error) {
                console.error('Error al crear la conversación en Chatwoot:', error);
                res.status(500).json({ error: error.message, detalles: error });
            }
        } else {
            console.log('Contacto no encontrado en Chatwoot');
            res.status(404).json({ message: 'Contacto no encontrado en Chatwoot' });
        }
    } catch (error) {
        console.error(` Error:`, error);
        res.status(500).json({ error: error.message, detalles: error });
    }
};


// Campaña Equipo Sastisfacción Cliente - Ventas últimos 30 días.
// Se recibe un webhook desde Inconcert y se crea una conversación en Chatwoot
const chatwootCampaignUltimasVentas = async (req, res) => {
    const contactData = req.body;
    // Buscar el contacto en Chatwoot
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
            { id: contactData.id, key: 'id' },
            { id: contactData.email, key: 'email' },
            { id: contactData.phone, key: 'phone_number' }
        ]
            .map(item => buildPayloadItem(item.key, item.id))
            .filter(Boolean)
            .map((item, index, array) => ({
                ...item,
                query_operator: index === array.length - 1 ? null : "OR"
            }))
    };

    try {
        const response = await axios.post(`${chatwoot_url}/api/v1/accounts/2/contacts/filter`, payload, {
            headers: {
                'Content-Type': 'application/json',
                'api_access_token': api_access_token,
            },
        });
        if (response.data.meta.count > 0) {
            const conversationData = {
                inbox_id: contactData.inbox_id || "14",
                source_id: response.data.payload[0].custom_attributes.id,
                contact_id: response.data.payload[0].id,
                status: 'open',
                assignee_id: '19',
                team_id: 4,
                message: {
                    content: contactData.system_message || '',
                }
            };
            try {
                const response = await axios.post(`${chatwoot_url}/api/v1/accounts/2/conversations`, conversationData, {
                    headers: {
                        'Content-Type': 'application/json',
                        'api_access_token': api_access_token,
                    },
                });
                res.status(200).json(response.data);
            }
            catch (error) {
                console.error('Error al crear la conversación en Chatwoot:', error);
                res.status(500).json({ error: error.message, detalles: error });
            }
        }
        else {
            console.log('Contacto no encontrado en Chatwoot');
            res.status(404).json({ message: 'Contacto no encontrado en Chatwoot', detalles: contactData });
        }
    } catch (error) {
        console.error(` Error:`, error);
        res.status(500).json({ error: error.message, detalles: error });
    }
};



export { chatwootWebhook, chatwootWebhookConversationCreated, chatwootCampaignCreatedSdrPrueba, chatwootCampaignCreatedExpoBebe2025, chatwootCampaignUltimasVentas };

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const chatwootWebhook = async (req, res) => {

    const inconcert_url = process.env.INCONCERT_URL;
    const serviceToken = process.env.INCONCERT_CREATE_CONTACT_TOKEN


    if (webhook.event === 'contact_created'){
        const dataContact = {
            "serviceToken": serviceToken,
            "serviceAction": "form",
            "contactData": {
                "firstname": webhook.name,
                "lastname": "",
                "email": webhook.email,
                "phone": webhook.phone_number,
                "city": webhook.additional_attributes.city,
                "country": webhook.additional_attributes.country_conde,
                "company": webhook.additional_attributes.company_name,
            }
        };

        const response = await axios.post(`${inconcert_url}`, dataContact, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        console.log(response.data);
        return res.status(200);
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
        console.log('Webhook recibido:', webhook);

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

        console.log('Respuesta Inconcert:', response.data);
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


export { chatwootWebhook , chatwootWebhookConversationCreated };
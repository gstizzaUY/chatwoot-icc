// ...existing code...
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const RD_STATION_CONFIG = {
    API_BASE_URL: process.env.RDSTATION_URL
};

const chatwoot_url = process.env.CHATWOOT_URL;
const api_access_token = process.env.API_ACCESS_TOKEN;

const onboarding = async (req, res) => {
    try {
        const { etapa } = req.params;
        console.log('etapa:', etapa);
        console.log('API_BASE_URL:', RD_STATION_CONFIG.API_BASE_URL);

        const leads = req.body?.leads;
        if (!leads || !Array.isArray(leads) || leads.length === 0) {
            return res.status(400).json({ error: 'No se recibieron leads en el body' });
        }

        const lead = leads[0];
        console.log('lead:', lead);

        const contactData = {
            id: lead.id || null,
            email: lead.email || null,
            phone: lead.personal_phone || lead.mobile_phone || lead.phone || null,
            name: lead.name || '',
            inbox_id: lead.inbox_id || "14",
            system_message: `Onboarding - Cliente en la etapa D + ${etapa}`
        };

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

        if (filterResp.data.meta.count > 0) {
            const target = filterResp.data.payload[0];

            const conversationData = {
                inbox_id: contactData.inbox_id,
                source_id: target.custom_attributes?.id || null,
                contact_id: target.id,
                status: 'open',
                assignee_id: '19',
                team_id: 4,
                message: {
                    content: contactData.system_message,
                }
            };

            try {
                const createResp = await axios.post(`${chatwoot_url}/api/v1/accounts/2/conversations`, conversationData, {
                    headers: {
                        'Content-Type': 'application/json',
                        'api_access_token': api_access_token,
                    },
                });
                return res.status(200).json(createResp.data);
            } catch (error) {
                console.error('Error al crear la conversación en Chatwoot:', error);
                return res.status(500).json({ error: error.message, detalles: error });
            }
        } else {
            console.log('Contacto no encontrado en Chatwoot');
            return res.status(404).json({ message: 'Contacto no encontrado en Chatwoot' });
        }

    } catch (error) {
        console.error('Error en onboarding:', error);
        return res.status(500).json({ error: error.message || 'Error interno del servidor' });
    }
};

export default onboarding;
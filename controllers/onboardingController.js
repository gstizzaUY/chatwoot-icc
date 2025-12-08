// ...existing code...
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const RD_STATION_CONFIG = {
    API_BASE_URL: process.env.RDSTATION_URL
};

const chatwoot_url = process.env.CHATWOOT_URL;
const api_access_token = process.env.API_ACCESS_TOKEN;

const processLead = async (lead, etapa) => {
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

        const createResp = await axios.post(`${chatwoot_url}/api/v1/accounts/2/conversations`, conversationData, {
            headers: {
                'Content-Type': 'application/json',
                'api_access_token': api_access_token,
            },
        });

        return {
            success: true,
            leadId: lead.id,
            leadName: lead.name,
            conversationId: createResp.data.id,
            message: 'Conversación creada exitosamente'
        };
    } else {
        return {
            success: false,
            leadId: lead.id,
            leadName: lead.name,
            message: 'Contacto no encontrado en Chatwoot'
        };
    }
};

const onboarding = async (req, res) => {
    try {
        const { etapa } = req.params;
        console.log('etapa:', etapa);
        console.log('API_BASE_URL:', RD_STATION_CONFIG.API_BASE_URL);

        console.log('req.body:', req.body);

        const leads = req.body?.leads;
        if (!leads || !Array.isArray(leads) || leads.length === 0) {
            return res.status(400).json({ error: 'No se recibieron leads en el body' });
        }

        console.log(`Procesando ${leads.length} lead(s)...`);

        const results = [];
        const errors = [];

        for (const lead of leads) {
            try {
                console.log('Procesando lead:', lead.id, '-', lead.name);
                const result = await processLead(lead, etapa);
                results.push(result);
            } catch (error) {
                console.error(`Error al procesar lead ${lead.id}:`, error.message);
                errors.push({
                    success: false,
                    leadId: lead.id,
                    leadName: lead.name,
                    error: error.message
                });
            }
        }

        const successCount = results.filter(r => r.success).length;
        const failureCount = results.filter(r => !r.success).length + errors.length;

        return res.status(200).json({
            total: leads.length,
            processed: results.length + errors.length,
            success: successCount,
            failures: failureCount,
            results: [...results, ...errors]
        });

    } catch (error) {
        console.error('Error en onboarding:', error);
        return res.status(500).json({ error: error.message || 'Error interno del servidor' });
    }
};

export default onboarding;
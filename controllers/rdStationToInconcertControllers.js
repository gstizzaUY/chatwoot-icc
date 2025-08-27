import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const INCONCERT_URL = process.env.INCONCERT_URL;
const INCONCERT_CREATE_CONTACT_TOKEN = "10d76b834c3f2d48991a78a48f3f1de3";

const rdStationToInconcertController = async (req, res) => {
    try {
        const { leads } = req.body;

        if (!leads || !Array.isArray(leads)) {
            return res.status(400).json({ error: 'Leads no proporcionados o formato incorrecto' });
        }

        const results = [];

        for (const lead of leads) {
            console.log('Procesando lead:', lead.id, lead.email);

            const custom_fields = lead.custom_fields || {};
            console.log('Custom fields:', custom_fields);

            // Separar nombre y apellido
            const fullName = lead.name || '';
            const lastName = custom_fields.lastname || '';
            let firstName = '';
            if (fullName && lastName) {
                firstName = fullName.replace(lastName, '').trim();
            } else {
                // Si no hay lastname, asumir que el último nombre es apellido
                const nameParts = fullName.split(' ');
                if (nameParts.length > 1) {
                    firstName = nameParts.slice(0, -1).join(' ');
                    lastName = nameParts[nameParts.length - 1];
                } else {
                    firstName = fullName;
                }
            }

            // Mapear datos para Inconcert
            const contactData = {
                email: lead.email || '',
                firstname: firstName,
                lastname: lastName,
                language: custom_fields.language || 'es',
                owner: custom_fields.owner || '',
                position: custom_fields.position || '',
                phone: lead.personal_phone || lead.mobile_phone || '',
                mobile: lead.mobile_phone || '',
                address1: custom_fields.address1 || '',
                address2: custom_fields.address2 || '',
                city: lead.city || '',
                state: lead.state || '',
                zip: custom_fields.zip || '',
                country: 'UY', // Asumir Uruguay basado en el ejemplo
                instagram: custom_fields.instagram || '',
                crm_current_plan: custom_fields.stage || '',
                referredDate: custom_fields.referredDate || '',
                referredByContactId: custom_fields.referredByContactId || '',
                referredAtCampaignId: custom_fields.referredAtCampaignId || '',
                referredAtInteractionId: custom_fields.referredAtInteractionId || ''
            };

            console.log('ContactData mapeado:', contactData);

            // Datos del payload para Inconcert
            const data = {
                serviceToken: INCONCERT_CREATE_CONTACT_TOKEN,
                serviceAction: 'form',
                visitId: '',
                contentUrl: '',
                contentId: '',
                templateId: '',
                sourceId: '',
                thankyouPageUrl: '',
                formId: '',
                buttonId: '',
                searchCompanyByName: true,
                contactData: contactData
            };

            console.log('Payload a enviar a Inconcert:', JSON.stringify(data, null, 2));
            console.log('URL de Inconcert:', INCONCERT_URL);

            // Enviar a Inconcert
            try {
                const response = await axios.post(INCONCERT_URL, data, {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                console.log('Respuesta de Inconcert para lead', lead.id, ':', response.data);
                results.push({
                    leadId: lead.id,
                    status: 'success',
                    response: response.data
                });
            } catch (error) {
                console.error('Error enviando a Inconcert para lead', lead.id, ':', error.message);
                if (error.response) {
                    console.error('Status:', error.response.status);
                    console.error('Data:', error.response.data);
                }
                results.push({
                    leadId: lead.id,
                    status: 'error',
                    error: error.response?.data || error.message
                });
            }
        }

        console.log('Procesamiento completado. Resultados:', results);
        res.json({
            message: 'Procesamiento completado',
            results: results
        });
    } catch (error) {
        console.error('Error en rdStationToInconcertController:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
};

export { rdStationToInconcertController };

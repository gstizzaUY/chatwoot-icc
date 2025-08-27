import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const INCONCERT_URL = process.env.INCONCERT_URL;
const INCONCERT_CREATE_CONTACT_TOKEN = "10d76b834c3f2d48991a78a48f3f1de3";

const masterSushi = async (req, res) => {
    console.log('=== INICIO MASTERCLASS SUSHI ENDPOINT ===');
    console.log('Headers recibidos:', req.headers);
    console.log('Body recibido:', JSON.stringify(req.body, null, 2));
    
    try {
        const { leads } = req.body;

        if (!leads || !Array.isArray(leads)) {
            console.log('ERROR: Leads no proporcionados o formato incorrecto');
            return res.status(400).json({ error: 'Leads no proporcionados o formato incorrecto' });
        }

        console.log(`Procesando ${leads.length} leads`);
        const results = [];

        for (const lead of leads) {
            console.log('Procesando lead:', lead.id, lead.email);

            const custom_fields = lead.custom_fields || {};
            console.log('Custom fields:', custom_fields);

            // Separar nombre y apellido
            const fullName = lead.name || '';
            const lastName = custom_fields.lastname || '';
            let firstName = '';
            
            console.log(`Separando nombre: fullName="${fullName}", lastName="${lastName}"`);
            
            if (fullName && lastName) {
                firstName = fullName.replace(lastName, '').trim();
                console.log(`Método 1 - firstName: "${firstName}", lastName: "${lastName}"`);
            } else {
                // Si no hay lastname, asumir que el último nombre es apellido
                const nameParts = fullName.split(' ');
                if (nameParts.length > 1) {
                    firstName = nameParts.slice(0, -1).join(' ');
                    const extractedLastName = nameParts[nameParts.length - 1];
                    console.log(`Método 2 - firstName: "${firstName}", lastName: "${extractedLastName}"`);
                } else {
                    firstName = fullName;
                    console.log(`Método 3 - solo firstName: "${firstName}"`);
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
            console.log('INCONCERT_URL desde .env:', INCONCERT_URL);
            console.log('INCONCERT_TOKEN:', INCONCERT_CREATE_CONTACT_TOKEN);

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
            console.log(`--- ENVIANDO A INCONCERT PARA LEAD ${lead.id} ---`);
            try {
                console.log('Iniciando request a Inconcert...');
                const response = await axios.post(INCONCERT_URL, data, {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000 // 30 segundos timeout
                });
                console.log('✅ ÉXITO - Respuesta de Inconcert para lead', lead.id);
                console.log('Status code:', response.status);
                console.log('Response data:', response.data);
                console.log('Response headers:', response.headers);
                results.push({
                    leadId: lead.id,
                    status: 'success',
                    response: response.data
                });
            } catch (error) {
                console.error('❌ ERROR enviando a Inconcert para lead', lead.id);
                console.error('Error message:', error.message);
                console.error('Error code:', error.code);
                if (error.response) {
                    console.error('Response status:', error.response.status);
                    console.error('Response statusText:', error.response.statusText);
                    console.error('Response data:', error.response.data);
                    console.error('Response headers:', error.response.headers);
                } else if (error.request) {
                    console.error('No response received. Request details:', error.request);
                } else {
                    console.error('Error setting up request:', error.message);
                }
                results.push({
                    leadId: lead.id,
                    status: 'error',
                    error: error.response?.data || error.message,
                    errorCode: error.code,
                    statusCode: error.response?.status
                });
            }
        }

        console.log('=== PROCESAMIENTO COMPLETADO ===');
        console.log('Total leads procesados:', leads.length);
        console.log('Resultados finales:', JSON.stringify(results, null, 2));
        res.json({
            message: 'Procesamiento completado',
            totalLeads: leads.length,
            results: results
        });
    } catch (error) {
        console.error('❌ ERROR CRÍTICO en masterSushi:', error);
        console.error('Stack trace:', error.stack);
        res.status(500).json({ 
            error: 'Error interno del servidor',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

export { masterSushi };

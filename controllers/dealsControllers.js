import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const chatwoot_url = process.env.CHATWOOT_URL;
const api_access_token = process.env.API_ACCESS_TOKEN;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const importDeals = async (req, res) => {
    res.json({ message: 'Importando deals' });
    try {
        const filePath = path.join(__dirname, '../data/deals.json');
        const data = fs.readFileSync(filePath, 'utf8');
        const deals = JSON.parse(data);

        // Agrupar todos los deals por la propiedad "Asociado a (ID)"
        const dealsByContactId = deals.reduce((acc, deal) => {
            const contactId = deal['Asociado a (ID)'];
            if (!acc[contactId]) {
                acc[contactId] = [];
            }
            acc[contactId].push(deal);
            return acc;
        }, {});

        // Recorrer cada contacto con deals y buscarlo en chatwoot
        for (const contactId in dealsByContactId) {
            console.log('Contact ID:', contactId);
            console.log(`Buscando el contacto con ID: ${contactId}`);
            const contactDeals = dealsByContactId[contactId];
            console.log('Deal:', contactDeals);

            // filtrar el contacto en chatwoot
            const searchUrl = `${chatwoot_url}/api/v1/accounts/2/contacts/filter`;
            const config = {
                headers: {
                    'api_access_token': api_access_token
                }
            };

            const payload = {
                "payload" : [
                    {
                        "attribute_key": "identifier",
                        "filter_operator": "equal_to",
                        "values": [contactId],
                        "query_operator": "OR"
                    },
                    {
                        "attribute_key": "email",
                        "filter_operator": "equal_to",
                        "values": [contactId],
                        "query_operator": null
                    }
                ]
            }

            try {
                const response = await axios.post(searchUrl, payload, config);
                console.log(response.data);

 
                if (response.data.meta.count > 0) {
                    const contact = response.data.payload[0];
                    console.log(contact);
                    // Actualizar el contacto con los deals
                    const update = {
                        "identifier": contact.identifier,
                        "custom_attributes": {
                            "deals": contactDeals
                        }
                    };
                    try {
                        const updateUrl = `${chatwoot_url}/api/v1/accounts/2/contacts/${contact.id}`;
                        const response = await axios.put(updateUrl, update, {
                            headers: {
                                'api_access_token': api_access_token
                            }
                        });
                        console.log('Contacto actualizado:', response.data);
                    } catch (error) {
                        console.error(`Error al importar los deals para el contacto con ID: ${contactId}`, error);
                    }


                } else {


                }
            } catch (error) {
                console.error(`Error al buscar el contacto con ID: ${contactId}`, error);
            }
        }



    } catch (error) {
        console.log(error);
        res.status(500).json({ message: 'Error al importar los deals' });
    }
}



export { importDeals };
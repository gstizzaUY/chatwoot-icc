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

        // Luego transformamos la estructura de cada deal dentro de los grupos
        for (const contactId in dealsByContactId) {
            dealsByContactId[contactId] = dealsByContactId[contactId].map(deal => ({
                id: deal['Identificador (ID)'].toString(),
                dealName: deal['Nombre'],
                description: deal['Descripción'],
                dealEntity: deal['Asociado a (tipo)'],
                pipeline: deal['Pipeline'],
                stage: deal['Etapa actual'],
                amount: deal['Importe única vez'],
                contractPeriod: deal['Periodo del contrato'],
                saleStatus: null,
                currency: deal['Moneda'],
                closeDate: deal['Fecha de cierre'],
                sourceCloseDate: deal['Fecha de cierre de oportunidad original'],
                owner: deal['Responsable'],
                partnerId: deal['Partners'],
                partnerBillingType: deal['Forma de facturación (partner)'],
                partnerCompensation: deal['Compensación (partner %)'],
                type: deal['Tipo de oportunidad'],
                company: deal['Cuenta'],
                externalReference: deal['Referencia externa'],
                importPreviousCompanyData: false,
                importPreviousContactData: true,
                customData: '{}',
                createdBySource: 'workflow',
                createdBySourceId: 'COM_OPORTUNIDAD',
                createdDate: deal['Fecha de creación'],
                createdByUserId: deal['Creado por usuario'],
                lastModifiedDate: deal['Fecha última modificación'],
                lastModifiedByUserId: deal['Modificado por usuario']
            }));
        }

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
                "payload": [
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
                    console.log(`No se encontró el contacto con ID: ${contactId}`);
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


const createDeal = (req, res) => {

    const deal = req.body.eventData;
    const nombre = deal.dealName;
    const dealId = deal.id;

    // Buscar el contacto en chatwoot
    const searchUrl = `${chatwoot_url}/api/v1/accounts/2/contacts/filter`;
    const config = {
        headers: {
            'api_access_token': api_access_token
        }
    };

    const payload = {
        "payload": [
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

    axios.post(searchUrl, payload, config)
        .then(response => {
            if (response.data.meta.count > 0) {
                const contact = response.data.payload[0];
                console.log('Contacto encontrado - Crear Oportunidad:', contact);
                const deals = contact.custom_attributes.deals || [];

                // Verificar si el deal ya existe
                const existingDeal = deals.find(d => d.id === dealId);

                // Si existe, actualizarlo, sino, agregarlo

                if (existingDeal) {
                    console.log('Deal existente - Actualizar:', existingDeal);
                } else {
                    console.log('Deal nuevo - Agregar:', deal);
                    deals.push(deal);
                }

                // Actualizar el contacto con el nuevo deal

                const update = {
                    "identifier": contact.identifier,
                    "custom_attributes": {
                        "deals": deals
                    }
                };

                const updateUrl = `${chatwoot_url}/api/v1/accounts/2/contacts/${contact.id}`;
                axios.put(updateUrl, update, {
                    headers: {
                        'api_access_token': api_access_token
                    }
                })

                    .then(response => {
                        console.log('Contacto actualizado:', response.data);
                        res.json({ message: 'Deal creado exitosamente' });
                    }
                    )
                    .catch(error => {
                        console.error(`Error al importar el deal para el contacto con ID: ${contactId}`, error);
                        res.status(500).json({ message: 'Error al importar el deal' });
                    });

            } else {
                console.log(`No se encontró el contacto con ID: ${contactId}`);
                res.status(404).json({ message: 'No se encontró el contacto' });
            }
        })
        .catch(error => {
            console.error(`Error al buscar el contacto con ID: ${contactId}`, error);
            res.status(500).json({ message: 'Error al buscar el contacto' });
        });
};

const updateDeal = (req, res) => {
    console.log('deal', req.body);
    const deal = req.body.eventData;
    // Convertir deal.id en número
    const dealId = parseInt(deal.id);

    // Función para extraer información del contacto del nombre del deal
    const extractContactInfo = (dealName) => {
        const regex = /\((.*?)\)(?:\s*\((.*?)\))?/;
        const matches = dealName.match(regex);

        console.log('matches', matches);

        if (!matches) return null;

        const firstParenthesis = matches[1]?.trim();
        const secondParenthesis = matches[2]?.trim();
        const thirdParenthesis = matches[3]?.trim();

        console.log('firstParenthesis', firstParenthesis);
        console.log('secondParenthesis', secondParenthesis);
        console.log('thirdParenthesis', thirdParenthesis);

        // Caso 1: Tiene dos paréntesis (nombre y apellido)
        if (secondParenthesis) {
            return {
                name: `${firstParenthesis} ${secondParenthesis}`,
                identifier: null
            };
        }

        // Caso 2: Tiene un paréntesis
        if (firstParenthesis) {
            // Verificar si es un ID (número)
            if (/^\d+$/.test(firstParenthesis)) {
                return {
                    name: null,
                    identifier: firstParenthesis
                };
            }

            // Si no es un número, asumimos que es un nombre
            return {
                name: firstParenthesis,
                identifier: null
            };
        }

        // Caso 3: Tiene tres paréntesis (nombre, apellido y identifier)
        if (thirdParenthesis) {
            return {
                name: `${firstParenthesis} ${secondParenthesis}`,
                identifier: thirdParenthesis
            };
        }

        return null;
    };

    const contactInfo = extractContactInfo(deal.dealName);
    const contactoBuscar = contactInfo?.identifier || contactInfo?.name || '';

    console.log('contactInfo', contactInfo);
    console.log('contactoBuscar', contactoBuscar);




    // Buscar el contacto en chatwoot
    const searchUrl = `${chatwoot_url}/api/v1/accounts/2/contacts/filter`;
    const config = {
        headers: {
            'api_access_token': api_access_token
        }
    };

    const payload = {
        "payload": [
            {
                "attribute_key": "identifier",
                "filter_operator": "equal_to",
                "values": [contactoBuscar],
                "query_operator": "OR"
            },
            {
                "attribute_key": "name",
                "filter_operator": "equal_to",
                "values": [contactoBuscar],
                "query_operator": null,
                "query_operator": null
            }
        ]
    }

    axios.post(searchUrl, payload, config)
    .then(response => {
        console.log('response', response.data);
        if (response.data.meta.count > 0) {
            const contact = response.data.payload[0];
            console.log('Contacto encontrado - Actualizar Deal:', contact);
            // Asegurarnos de que deals sea siempre un array
            let deals = Array.isArray(contact.custom_attributes.deals) 
                ? contact.custom_attributes.deals 
                : [];
            
            console.log('Deals del contacto:', deals);

            // verificar el tipo de datos para saber si debe ser parseado o no
            const dealIdNum = typeof dealId === 'string' ? parseInt(dealId) : dealId;

            // Verificar si el deal ya existe
            const existingDeal = deals.find(d => {
                const existingId = typeof d.id === 'string' ? parseInt(d.id) : d.id;
                return existingId === dealIdNum;
            });

            // Si existe, actualizarlo, sino, agregarlo
            if (existingDeal) {
                console.log('Deal existente - Actualizar:', existingDeal);
                deals = deals.filter(d => {
                    const currentId = typeof d.id === 'string' ? parseInt(d.id) : d.id;
                    return currentId !== dealIdNum;
                });
                deals.push(deal);
            } else {
                console.log('Deal nuevo - Agregar:', deal);
                deals.push(deal);
            }

                // Actualizar el contacto con el nuevo deal

                const update = {
                    "identifier": contact.identifier,
                    "custom_attributes": {
                        "deals": deals
                    }
                };

                const updateUrl = `${chatwoot_url}/api/v1/accounts/2/contacts/${contact.id}`;
                axios.put(updateUrl, update, {
                    headers: {
                        'api_access_token': api_access_token
                    }
                })

                    .then(response => {
                        console.log('Contacto actualizado:', response.data);
                        res.json({ message: 'Deal actualizado exitosamente' });
                    }
                    )
                    .catch(error => {
                        console.error(`Error al importar el deal para el contacto`, error);
                        res.status(500).json({ message: 'Error al importar el deal' });
                    });

            } else {
                console.log(`No se encontró el contacto`);
                res.status(404).json({ message: 'No se encontró el contacto' });
            }
        })
        .catch(error => {
            console.error(`Error al buscar el contacto`, error);
            res.status(500).json({ message: 'Error al buscar el contacto' });
        });


};



export { importDeals, createDeal, updateDeal };
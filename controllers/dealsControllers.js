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
            console.log(`Buscando el contacto con ID en chatwoot: ${contactId}`);
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
                        "attribute_key": "id",
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

                if (response.data.meta.count > 0) {
                    const contact = response.data.payload[0];
                    console.log('[searchContact] Contacto encontrado en chatwoot:', contact.id);

                    // Actualizar el contacto con los deals
                    const update = {
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
                        console.log('Contacto actualizado en chatwoot:', response.data);
                    } catch (error) {
                        console.error(`Error al importar los deals para el contacto con ID: ${contactId}`, error);
                    }
                } else {
                    console.log(`No se encontró el contacto con ID en chatwoot: ${contactId}`);
                }
            } catch (error) {
                console.error(`Error al buscar el contacto con ID en chatwoot: ${contactId}`, error);
            }
        }
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: 'Error al importar los deals' });
    }
}


const createDeal = (req, res) => {
    console.log('[createDeal] Datos del deal recibidos:', req.body);
    const deal = req.body.eventData;
    // Convertir deal.id en número
    const dealId = typeof deal.id === 'string' ? parseInt(deal.id) : deal.id;

    // Función para extraer información del contacto del nombre del deal
    const extractContactInfo = (dealName) => {
        const regex = /\((.*?)\)(?:\s*\((.*?)\))?(?:\s*\((.*?)\))?/;
        const matches = dealName.match(regex);

        if (!matches) return null;

        const firstParenthesis = matches[1]?.trim();
        const secondParenthesis = matches[2]?.trim();
        const thirdParenthesis = matches[3]?.trim();

        // Caso 1: Tiene tres paréntesis (nombre, apellido e chatwoot_id)
        if (thirdParenthesis) {
            return {
                name: `${firstParenthesis} ${secondParenthesis}`,
                chatwoot_id: thirdParenthesis
            };
        }

        // Caso 2: Tiene dos paréntesis (nombre y apellido)
        if (secondParenthesis) {
            return {
                name: `${firstParenthesis} ${secondParenthesis}`,
                chatwoot_id: null
            };
        }

        // Caso 3: Tiene un paréntesis
        if (firstParenthesis) {
            // Verificar si es un ID (número)
            if (/^\d+$/.test(firstParenthesis)) {
                return {
                    name: null,
                    chatwoot_id: firstParenthesis
                };
            }

            // Si no es un número, asumimos que es un nombre
            return {
                name: firstParenthesis,
                chatwoot_id: null
            };
        }

        return null;
    };

    const contactInfo = extractContactInfo(deal.dealName);
    const contactoBuscar = contactInfo?.chatwoot_id || contactInfo?.name || '';

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
                "attribute_key": "id",
                "filter_operator": "equal_to",
                "values": [contactoBuscar],
                "query_operator": "OR"
            },
            {
                "attribute_key": "name",
                "filter_operator": "equal_to",
                "values": [contactoBuscar],
                "query_operator": null
            }
        ]
    }

    axios.post(searchUrl, payload, config)
        .then(response => {

            if (response.data.meta.count > 0) {
                const contact = response.data.payload[0];
                console.log('[searchContact] Contacto encontrado en chatwoot:', contact.id);
                
                // Asegurarnos de que deals sea siempre un array
                let deals = Array.isArray(contact.custom_attributes.deals) 
                    ? contact.custom_attributes.deals 
                    : [];

                // Verificar si el deal ya existe
                const existingDeal = deals.find(d => {
                    const existingId = typeof d.id === 'string' ? parseInt(d.id) : d.id;
                    return existingId === dealId;
                });

                // Si existe, actualizarlo, sino, agregarlo
                if (existingDeal) {
                    console.log('[searchContact] Deal existente - Actualizar:', existingDeal);
                    deals = deals.filter(d => {
                        const currentId = typeof d.id === 'string' ? parseInt(d.id) : d.id;
                        return currentId !== dealId;
                    });
                    deals.push(deal);
                } else {
                    console.log('[searchContact] Deal nuevo - Agregar:', deal);
                    deals.push(deal);
                }

                // Actualizar el contacto con el nuevo deal
                const update = {
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
                    console.log('[updateContact] Contacto actualizado:', response.data);
                    res.json({ message: 'Deal creado exitosamente' });
                })
                .catch(error => {
                    console.error(`[updateContact] Error al importar el deal para el contacto`, error);
                    res.status(500).json({ message: 'Error al importar el deal' });
                });

            } else {
                console.log(`[searchContact] No se encontró el contacto`);
                res.status(404).json({ message: 'No se encontró el contacto' });
            }
        })
        .catch(error => {
            console.error(`[searchContact] Error al buscar el contacto`, error);
            res.status(500).json({ message: 'Error al buscar el contacto' });
        });
};

const updateDeal = (req, res) => {
    console.log('[updateDeal] Deal recibido:', req.body);
    const deal = req.body.eventData;
    // Convertir deal.id en número
    const dealId = parseInt(deal.id);

    // Función para extraer información del contacto del nombre del deal
    const extractContactInfo = (dealName) => {
        const regex = /\((.*?)\)(?:\s*\((.*?)\))?(?:\s*\((.*?)\))?/;
        const matches = dealName.match(regex);

        if (!matches) return null;

        const firstParenthesis = matches[1]?.trim();
        const secondParenthesis = matches[2]?.trim();
        const thirdParenthesis = matches[3]?.trim();

        // Caso 1: Tiene tres paréntesis (nombre, apellido e chatwoot_id)
        if (thirdParenthesis) {
            return {
                name: `${firstParenthesis} ${secondParenthesis}`,
                chatwoot_id: thirdParenthesis
            };
        }

        // Caso 2: Tiene dos paréntesis (nombre y apellido)
        if (secondParenthesis) {
            return {
                name: `${firstParenthesis} ${secondParenthesis}`,
                chatwoot_id: null
            };
        }

        // Caso 3: Tiene un paréntesis
        if (firstParenthesis) {
            // Verificar si es un ID (número)
            if (/^\d+$/.test(firstParenthesis)) {
                return {
                    name: null,
                    chatwoot_id: firstParenthesis
                };
            }

            // Si no es un número, asumimos que es un nombre
            return {
                name: firstParenthesis,
                chatwoot_id: null
            };
        }

        return null;
    };

    const contactInfo = extractContactInfo(deal.dealName);
    const contactoBuscar = contactInfo?.chatwoot_id || contactInfo?.name || '';

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
                "attribute_key": "id",
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
        if (response.data.meta.count > 0) {
            const contact = response.data.payload[0];
            console.log('[searchContact] Contacto encontrado en chatwoot - Actualizar Deal:', contact);
            // Asegurarnos de que deals sea siempre un array
            let deals = Array.isArray(contact.custom_attributes.deals) 
                ? contact.custom_attributes.deals 
                : [];

            console.log('[searchContact] Deals del contacto:', deals);

            // verificar el tipo de datos para saber si debe ser parseado o no
            const dealIdNum = typeof dealId === 'string' ? parseInt(dealId) : dealId;

            // Verificar si el deal ya existe
            const existingDeal = deals.find(d => {
                const existingId = typeof d.id === 'string' ? parseInt(d.id) : d.id;
                return existingId === dealIdNum;
            });

            // Si existe, actualizarlo, sino, agregarlo
            if (existingDeal) {
                console.log('[updateDeal] Deal existente - Actualizar:', existingDeal);
                deals = deals.filter(d => {
                    const currentId = typeof d.id === 'string' ? parseInt(d.id) : d.id;
                    return currentId !== dealIdNum;
                });
                deals.push(deal);
            } else {
                console.log('[updateDeal] Deal nuevo - Agregar:', deal);
                deals.push(deal);
            }

                // Actualizar el contacto con el nuevo deal

                const update = {
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
                        console.log('[updateDeal] Contacto actualizado en chatwoot:', response.data);
                        res.json({ message: 'Deal actualizado exitosamente' });
                    }
                    )
                    .catch(error => {
                        console.error(`[updateDeal] Error al importar el deal para el contacto en chatwoot:`, error);
                        res.status(500).json({ message: 'Error al importar el deal' });
                    });

            } else {
                console.log(`[updateDeal] No se encontró el contacto en chatwoot`);
                res.status(404).json({ message: 'No se encontró el contacto' });
            }
        })
        .catch(error => {
            console.error(`[updateDeal] Error al buscar el contacto en chatwoot`, error);
            res.status(500).json({ message: 'Error al buscar el contacto' });
        });
};



export { importDeals, createDeal, updateDeal };
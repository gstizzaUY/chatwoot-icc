import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const chatwoot_url = process.env.CHATWOOT_URL;
const api_access_token = process.env.API_ACCESS_TOKEN;

const importContacts = async (req, res) => {
    const contact = req.body.contact;
    console.log('[importContacts] Contacto recibido para importar a chatwoot:', contact);

    // Actualizar campo tiene_ichef extraido de customData
    let tiene_ichef = '';
    let participo_SDR = '';
    let estado_sdr = '';

    try {
        if (contact && contact.customData) {
            const contactCustomData = contact.customData;
            const jsonCustomData = JSON.parse(contactCustomData);
            tiene_ichef = jsonCustomData?.tiene_ichef || '';
            participo_SDR = jsonCustomData?.participo_SDR || '';
            estado_sdr = jsonCustomData?.estado_sdr || '';
        }
    } catch (error) {
        console.error('Error al parsear customData:', error);
        tiene_ichef = '';
        participo_SDR = '';
        estado_sdr = '';
    }


    // Extraer la etapa del contacto
    let contactStage = contact.stage;
    if (contactStage === 'lead') {
        contactStage = 'lead';
    } else if (contactStage === 'marketingQualifiedLead') {
        contactStage = 'mql';
    } else if (contactStage === 'salesQualifiedLead') {
        contactStage = 'sql';
    } else if (contactStage === 'opportunity') {
        contactStage = 'oportunidad';
    } else if (contactStage === 'customer') {
        contactStage = 'cliente';
    }

    const contactData = {
        "name": contact.firstname + ' ' + contact.lastname,
        "inbox_id": contact.phone !== null ? 23 : 1,
        "email": contact.email,
        "phone_number": contact.phoneInternational,
        "custom_attributes": {
            "firstname": contact.firstname,
            "lastname": contact.lastname,
            "score": contact.score,
            "stage": contact.stage,
            "language": contact.language,
            "company": contact.company,
            "position": contact.position,
            "phone": contact.phone,
            "mobile": contact.mobile,
            "fax": contact.fax,
            "id": contact.id,
            "owner": contact.owner,
            "website": contact.website,
            "address1": contact.address1,
            "address2": contact.address2,
            "country": contact.country,
            "state": contact.state,
            "city": contact.city,
            "zip": contact.zip,
            "facebook": contact.facebook,
            "twitter": contact.twitter,
            "skype": contact.skype,
            "googlePlus": contact.googlePlus,
            "linkedin": contact.linkedin,
            "instagram": contact.instagram,
            "comments": contact.comments,
            "clientComments": contact.clientComments,
            "customData": contact.customData,
            "membership": contact.membership,
            "blacklist": contact.blacklist,
            "referredDate": contact.referredDate,
            "referredByContactId": contact.referredByContactId,
            "referredAtCampaignId": contact.referredAtCampaignId,
            "referredAtInteractionId": contact.referredAtInteractionId,
            "lastTrackingId": contact.lastTrackingId,
            "lastFingerprint": contact.lastFingerprint,
            "hadDuplicateDetected": contact.hadDuplicateDetected,
            "firstClickEventDate": contact.firstClickEventDate,
            "firstClickEventId": contact.firstClickEventId,
            "firstClickEventCampaign": contact.firstClickEventCampaign,
            "lastClickEventDate": contact.lastClickEventDate,
            "lastClickEventId": contact.lastClickEventId,
            "lastClickEventCampaign": contact.lastClickEventCampaign,
            "firstVisitEventDate": contact.firstVisitEventDate,
            "firstVisitEventId": contact.firstVisitEventId,
            "firstVisitEventCampaign": contact.firstVisitEventCampaign,
            "lastVisitEventDate": contact.lastVisitEventDate,
            "lastVisitEventId": contact.lastVisitEventId,
            "lastVisitEventCampaign": contact.lastVisitEventCampaign,
            "firstConversionEventDate": contact.firstConversionEventDate,
            "firstConversionEventId": contact.firstConversionEventId,
            "firstConversionEventCampaign": contact.firstConversionEventCampaign,
            "firstConversionEventUrl": contact.firstConversionEventUrl,
            "firstConversionEventContentType": contact.firstConversionEventContentType,
            "firstConversionEventContentId": contact.firstConversionEventContentId,
            "firstConversionEventVariantId": contact.firstConversionEventVariantId,
            "firstConversionEventPopupId": contact.firstConversionEventPopupId,
            "firstConversionEventFormId": contact.firstConversionEventFormId,
            "lastConversionEventDate": contact.lastConversionEventDate,
            "lastConversionEventId": contact.lastConversionEventId,
            "lastConversionEventCampaign": contact.lastConversionEventCampaign,
            "lastConversionEventUrl": contact.lastConversionEventUrl,
            "lastConversionEventContentType": contact.lastConversionEventContentType,
            "lastConversionEventContentId": contact.lastConversionEventContentId,
            "lastConversionEventVariantId": contact.lastConversionEventVariantId,
            "lastConversionEventPopupId": contact.lastConversionEventPopupId,
            "lastConversionEventFormId": contact.lastConversionEventFormId,
            "firstCallEventDate": contact.firstCallEventDate,
            "firstCallEventId": contact.firstCallEventId,
            "firstCallEventCampaign": contact.firstCallEventCampaign,
            "firstCallEventCcCampaign": contact.firstCallEventCcCampaign,
            "firstCallEventAgent": contact.firstCallEventAgent,
            "firstCallEventDisposition": contact.firstCallEventDisposition,
            "firstCallEventResult": contact.firstCallEventResult,
            "firstCallEventOutOfHour": contact.firstCallEventOutOfHour,
            "lastCallEventDate": contact.lastCallEventDate,
            "lastCallEventId": contact.lastCallEventId,
            "lastCallEventCampaign": contact.lastCallEventCampaign,
            "lastCallEventCcCampaign": contact.lastCallEventCcCampaign,
            "lastCallEventAgent": contact.lastCallEventAgent,
            "lastCallEventDisposition": contact.lastCallEventDisposition,
            "lastCallEventResult": contact.lastCallEventResult,
            "lastCallEventOutOfHour": contact.lastCallEventOutOfHour,
            "firstManagedCallEventDate": contact.firstManagedCallEventDate,
            "firstManagedCallEventId": contact.firstManagedCallEventId,
            "firstManagedCallEventCampaign": contact.firstManagedCallEventCampaign,
            "firstManagedCallEventCcCampaign": contact.firstManagedCallEventCcCampaign,
            "firstManagedCallEventAgent": contact.firstManagedCallEventAgent,
            "firstManagedCallEventManagementResult": contact.firstManagedCallEventManagementResult,
            "lastManagedCallEventDate": contact.lastManagedCallEventDate,
            "lastManagedCallEventId": contact.lastManagedCallEventId,
            "lastManagedCallEventCampaign": contact.lastManagedCallEventCampaign,
            "lastManagedCallEventCcCampaign": contact.lastManagedCallEventCcCampaign,
            "lastManagedCallEventAgent": contact.lastManagedCallEventAgent,
            "lastManagedCallEventManagementResult": contact.lastManagedCallEventManagementResult,
            "firstGoalEventDate": contact.firstGoalEventDate,
            "firstGoalEventId": contact.firstGoalEventId,
            "firstGoalEventCampaign": contact.firstGoalEventCampaign,
            "firstGoalEventCcCampaign": contact.firstGoalEventCcCampaign,
            "firstGoalEventAgent": contact.firstGoalEventAgent,
            "firstGoalEventManagementResult": contact.firstGoalEventManagementResult,
            "lastGoalEventDate": contact.lastGoalEventDate,
            "lastGoalEventId": contact.lastGoalEventId,
            "lastGoalEventCampaign": contact.lastGoalEventCampaign,
            "lastGoalEventCcCampaign": contact.lastGoalEventCcCampaign,
            "lastGoalEventAgent": contact.lastGoalEventAgent,
            "lastGoalEventManagementResult": contact.lastGoalEventManagementResult,
            "lastEventDate": contact.lastEventDate,
            "lastEventType": contact.lastEventType,
            "lastEventId": contact.lastEventId,
            "lastEventCampaign": contact.lastEventCampaign,
            "createdDate": contact.createdDate,
            "createdOutOfHour": contact.createdOutOfHour,
            "createdByCampaignId": contact.createdByCampaignId,
            "createdByCampaignCategory": contact.createdByCampaignCategory,
            "createdByCampaignClient": contact.createdByCampaignClient,
            "createdByUserId": contact.createdByUserId,
            "createdByEventType": contact.createdByEventType,
            "createdByEventId": contact.createdByEventId,
            "createdBySource": contact.createdBySource,
            "createdBySourceId": contact.createdBySourceId,
            "createdByClickSource": contact.createdByClickSource,
            "createdByClickId": contact.createdByClickId,
            "createdByClickCampaign": contact.createdByClickCampaign,
            "createdByClickAdGroup": contact.createdByClickAdGroup,
            "createdByClickKeyword": contact.createdByClickKeyword,
            "createdByClickAdPosition": contact.createdByClickAdPosition,
            "blocked": contact.blocked,
            "tiene_ichef": tiene_ichef,
            "participo_SDR": participo_SDR,
            "estado_sdr": estado_sdr
        }
    };

    console.log('[importContacts] Importar a Chatwoot:', contactData);

    const createNewContactImport = async () => {
        try {
            const response = await axios.post(`${chatwoot_url}/api/v1/accounts/2/contacts`, contactData, {
                headers: {
                    'Content-Type': 'application/json',
                    'api_access_token': api_access_token,
                },
            });
            console.log(`Contacto creado en chatwoot con id ${response.data.payload.id}`);
        } catch (error) {
            console.error(`Error al crear contacto en chatwoot (${error.response?.status || 'sin status'}):`, error.message);
            if (error.response?.data) {
                console.error('Detalles del error:', JSON.stringify(error.response.data, null, 2));
            }
        }
    };

    const updateContactImport = async (contactId) => {

        const updateContactData = {
            "name": contact.firstname + ' ' + contact.lastname,
            "email": contact.email,
            "phone_number": contact.phoneInternational,
            "custom_attributes": {
                "firstname": contact.firstname,
                "lastname": contact.lastname,
                "score": contact.score,
                "stage": contact.stage,
                "language": contact.language,
                "company": contact.company,
                "position": contact.position,
                "phone": contact.phone,
                "mobile": contact.mobile,
                "fax": contact.fax,
                "id": contact.id,
                "owner": contact.owner,
                "website": contact.website,
                "address1": contact.address1,
                "address2": contact.address2,
                "country": contact.country,
                "state": contact.state,
                "city": contact.city,
                "zip": contact.zip,
                "facebook": contact.facebook,
                "twitter": contact.twitter,
                "skype": contact.skype,
                "googlePlus": contact.googlePlus,
                "linkedin": contact.linkedin,
                "instagram": contact.instagram,
                "comments": contact.comments,
                "clientComments": contact.clientComments,
                "customData": contact.customData,
                "membership": contact.membership,
                "blacklist": contact.blacklist,
                "referredDate": contact.referredDate,
                "referredByContactId": contact.referredByContactId,
                "referredAtCampaignId": contact.referredAtCampaignId,
                "referredAtInteractionId": contact.referredAtInteractionId,
                "lastTrackingId": contact.lastTrackingId,
                "lastFingerprint": contact.lastFingerprint,
                "hadDuplicateDetected": contact.hadDuplicateDetected,
                "firstClickEventDate": contact.firstClickEventDate,
                "firstClickEventId": contact.firstClickEventId,
                "firstClickEventCampaign": contact.firstClickEventCampaign,
                "lastClickEventDate": contact.lastClickEventDate,
                "lastClickEventId": contact.lastClickEventId,
                "lastClickEventCampaign": contact.lastClickEventCampaign,
                "firstVisitEventDate": contact.firstVisitEventDate,
                "firstVisitEventId": contact.firstVisitEventId,
                "firstVisitEventCampaign": contact.firstVisitEventCampaign,
                "lastVisitEventDate": contact.lastVisitEventDate,
                "lastVisitEventId": contact.lastVisitEventId,
                "lastVisitEventCampaign": contact.lastVisitEventCampaign,
                "firstConversionEventDate": contact.firstConversionEventDate,
                "firstConversionEventId": contact.firstConversionEventId,
                "firstConversionEventCampaign": contact.firstConversionEventCampaign,
                "firstConversionEventUrl": contact.firstConversionEventUrl,
                "firstConversionEventContentType": contact.firstConversionEventContentType,
                "firstConversionEventContentId": contact.firstConversionEventContentId,
                "firstConversionEventVariantId": contact.firstConversionEventVariantId,
                "firstConversionEventPopupId": contact.firstConversionEventPopupId,
                "firstConversionEventFormId": contact.firstConversionEventFormId,
                "lastConversionEventDate": contact.lastConversionEventDate,
                "lastConversionEventId": contact.lastConversionEventId,
                "lastConversionEventCampaign": contact.lastConversionEventCampaign,
                "lastConversionEventUrl": contact.lastConversionEventUrl,
                "lastConversionEventContentType": contact.lastConversionEventContentType,
                "lastConversionEventContentId": contact.lastConversionEventContentId,
                "lastConversionEventVariantId": contact.lastConversionEventVariantId,
                "lastConversionEventPopupId": contact.lastConversionEventPopupId,
                "lastConversionEventFormId": contact.lastConversionEventFormId,
                "firstCallEventDate": contact.firstCallEventDate,
                "firstCallEventId": contact.firstCallEventId,
                "firstCallEventCampaign": contact.firstCallEventCampaign,
                "firstCallEventCcCampaign": contact.firstCallEventCcCampaign,
                "firstCallEventAgent": contact.firstCallEventAgent,
                "firstCallEventDisposition": contact.firstCallEventDisposition,
                "firstCallEventResult": contact.firstCallEventResult,
                "firstCallEventOutOfHour": contact.firstCallEventOutOfHour,
                "lastCallEventDate": contact.lastCallEventDate,
                "lastCallEventId": contact.lastCallEventId,
                "lastCallEventCampaign": contact.lastCallEventCampaign,
                "lastCallEventCcCampaign": contact.lastCallEventCcCampaign,
                "lastCallEventAgent": contact.lastCallEventAgent,
                "lastCallEventDisposition": contact.lastCallEventDisposition,
                "lastCallEventResult": contact.lastCallEventResult,
                "lastCallEventOutOfHour": contact.lastCallEventOutOfHour,
                "firstManagedCallEventDate": contact.firstManagedCallEventDate,
                "firstManagedCallEventId": contact.firstManagedCallEventId,
                "firstManagedCallEventCampaign": contact.firstManagedCallEventCampaign,
                "firstManagedCallEventCcCampaign": contact.firstManagedCallEventCcCampaign,
                "firstManagedCallEventAgent": contact.firstManagedCallEventAgent,
                "firstManagedCallEventManagementResult": contact.firstManagedCallEventManagementResult,
                "lastManagedCallEventDate": contact.lastManagedCallEventDate,
                "lastManagedCallEventId": contact.lastManagedCallEventId,
                "lastManagedCallEventCampaign": contact.lastManagedCallEventCampaign,
                "lastManagedCallEventCcCampaign": contact.lastManagedCallEventCcCampaign,
                "lastManagedCallEventAgent": contact.lastManagedCallEventAgent,
                "lastManagedCallEventManagementResult": contact.lastManagedCallEventManagementResult,
                "firstGoalEventDate": contact.firstGoalEventDate,
                "firstGoalEventId": contact.firstGoalEventId,
                "firstGoalEventCampaign": contact.firstGoalEventCampaign,
                "firstGoalEventCcCampaign": contact.firstGoalEventCcCampaign,
                "firstGoalEventAgent": contact.firstGoalEventAgent,
                "firstGoalEventManagementResult": contact.firstGoalEventManagementResult,
                "lastGoalEventDate": contact.lastGoalEventDate,
                "lastGoalEventId": contact.lastGoalEventId,
                "lastGoalEventCampaign": contact.lastGoalEventCampaign,
                "lastGoalEventCcCampaign": contact.lastGoalEventCcCampaign,
                "lastGoalEventAgent": contact.lastGoalEventAgent,
                "lastGoalEventManagementResult": contact.lastGoalEventManagementResult,
                "lastEventDate": contact.lastEventDate,
                "lastEventType": contact.lastEventType,
                "lastEventId": contact.lastEventId,
                "lastEventCampaign": contact.lastEventCampaign,
                "createdDate": contact.createdDate,
                "createdOutOfHour": contact.createdOutOfHour,
                "createdByCampaignId": contact.createdByCampaignId,
                "createdByCampaignCategory": contact.createdByCampaignCategory,
                "createdByCampaignClient": contact.createdByCampaignClient,
                "createdByUserId": contact.createdByUserId,
                "createdByEventType": contact.createdByEventType,
                "createdByEventId": contact.createdByEventId,
                "createdBySource": contact.createdBySource,
                "createdBySourceId": contact.createdBySourceId,
                "createdByClickSource": contact.createdByClickSource,
                "createdByClickId": contact.createdByClickId,
                "createdByClickCampaign": contact.createdByClickCampaign,
                "createdByClickAdGroup": contact.createdByClickAdGroup,
                "createdByClickKeyword": contact.createdByClickKeyword,
                "createdByClickAdPosition": contact.createdByClickAdPosition,
                "blocked": contact.blocked,
                "tiene_ichef": tiene_ichef,
                "participo_SDR": participo_SDR,
                "estado_sdr": estado_sdr

            }
        };

        try {
            const response = await axios.put(`${chatwoot_url}/api/v1/accounts/2/contacts/${contactId}`, updateContactData, {
                headers: {
                    'Content-Type': 'application/json',
                    'api_access_token': api_access_token,
                },
            });
            console.log(`Contacto importado a chatwoot con id ${response.data.payload.id}`);
        } catch (error) {
            console.error(`Error al actualizar contacto en chatwoot:`, error.message);
        };

        // Buscar las conversaciones del contacto
        try {
            const response = await axios.get(`${chatwoot_url}/api/v1/accounts/2/contacts/${contactId}/conversations`, {
                headers: {
                    'Content-Type': 'application/json',
                    'api_access_token': api_access_token,
                }
            });

            const conversations = response.data.payload.map(conversation => ({
                id: conversation.id,
                status: conversation.status,
                tags: conversation.labels || []
            }));


            conversations.forEach(async conversation => {
                try {
                    // Filtrar las etiquetas existentes
                    const currentLabels = conversation.tags;

                    // Remover etiquetas de oportunidad anteriores
                    const opportunityLabels = ['lead', 'mql', 'sql', 'oportunidad', 'cliente'];
                    const filteredLabels = currentLabels.filter(label => !opportunityLabels.includes(label));

                    // Remover etiqueta tiene_ichef si existe
                    const finalLabels = filteredLabels.filter(label => label !== 'tiene_ichef');

                    // Preparar las etiquetas actualizadas con la etapa actual
                    let updatedLabels = [...finalLabels, contactStage];

                    // Agregar etiqueta tiene_ichef solo si es "Sí"
                    if (tiene_ichef === "Sí") {
                        updatedLabels = [...updatedLabels, 'tiene_ichef'];
                    }

                    const updateConversationData = {
                        "labels": updatedLabels
                    };

                    const response = await axios.post(
                        `${chatwoot_url}/api/v1/accounts/2/conversations/${conversation.id}/labels`,
                        updateConversationData,
                        {
                            headers: {
                                'Content-Type': 'application/json',
                                'api_access_token': api_access_token,
                            },
                        }
                    );
                    console.log(`Conversación ${conversation.id} actualizada en chatwoot con etiquetas:`, updatedLabels);
                }
                catch (error) {
                    console.error(`Error al actualizar etiquetas de la conversación en chatwoot:`, error.message);
                }
            });

        } catch (error) {
            console.error(`Error al buscar conversaciones del contacto en chatwoot:`, error.message);
            res.status(500).json({ error: error.message });
        }

    };

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
            { id: contact.id, key: 'id' },
            { id: contact.email, key: 'email' },
            { id: contact.phone, key: 'phone_number' }
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
            console.log('Contacto encontrado en chatwoot:', response.data.payload.id);
            await updateContactImport(response.data.payload[0].id);
            res.status(200).json(response.data);

        } else {
            console.log('Contacto no creado en chatwoot');
            await createNewContactImport();
            res.status(200).json({ message: 'Contacto creado en chatwoot' });
        }

    } catch (error) {
        console.error(` Error:`, error);
        res.status(500).json({ error: error.message, detalles: error });
    }
};

const createContact = async (req, res) => {
    const contact = req.body.eventData;
    // console.log('[createContact] Contacto recibido para crear en chatwoot:', contact);

    // Extraer campos del customData
    let tiene_ichef = '';
    let participo_SDR = '';
    let estado_sdr = '';
    let phoneInternational = null;

    try {
        if (contact && contact.customData) {
            const contactCustomData = contact.customData;
            const jsonCustomData = JSON.parse(contactCustomData);
            tiene_ichef = jsonCustomData?.tiene_ichef || '';
            participo_SDR = jsonCustomData?.participo_SDR || '';
            estado_sdr = jsonCustomData?.estado_sdr || '';
            phoneInternational = jsonCustomData?.phoneInternational || null;
        }
    } catch (error) {
        console.error('Error al parsear customData:', error);
        tiene_ichef = '';
        participo_SDR = '';
        estado_sdr = '';
        phoneInternational = null;
    }

    // Determinar el teléfono a usar (prioridad: phoneInternational del customData, luego contact.phone)
    const phoneToUse = phoneInternational || contact.phone;


    // Extraer la etapa del contacto
    let contactStage = contact.stage;
    if (contactStage === 'lead') {
        contactStage = 'lead';
    } else if (contactStage === 'marketingQualifiedLead') {
        contactStage = 'mql';
    } else if (contactStage === 'salesQualifiedLead') {
        contactStage = 'sql';
    } else if (contactStage === 'opportunity') {
        contactStage = 'oportunidad';
    } else if (contactStage === 'customer') {
        contactStage = 'cliente';
    }

    const contactData = {
        "name": contact.firstname + ' ' + contact.lastname,
        "inbox_id": phoneToUse ? 23 : 1,  
        "email": contact.email,
        "phone_number": phoneToUse,
        "custom_attributes": {
            "firstname": contact.firstname,
            "lastname": contact.lastname,
            "score": contact.score,
            "stage": contact.stage, 
            "language": contact.language,
            "company": contact.company,
            "position": contact.position,
            "phone": contact.phone,
            "mobile": contact.mobile,
            "fax": contact.fax,
            "id": contact.id,
            "owner": contact.owner,
            "website": contact.website,
            "address1": contact.address1,
            "address2": contact.address2,
            "country": contact.country,
            "state": contact.state,
            "city": contact.city,
            "zip": contact.zip,
            "facebook": contact.facebook,
            "twitter": contact.twitter,
            "skype": contact.skype,
            "googlePlus": contact.googlePlus,
            "linkedin": contact.linkedin,
            "instagram": contact.instagram,
            "comments": contact.comments,
            "clientComments": contact.clientComments,
            "customData": contact.customData,
            "membership": contact.membership,
            "blacklist": contact.blacklist,
            "referredDate": contact.referredDate,
            "referredByContactId": contact.referredByContactId,
            "referredAtCampaignId": contact.referredAtCampaignId,
            "referredAtInteractionId": contact.referredAtInteractionId,
            "lastTrackingId": contact.lastTrackingId,
            "lastFingerprint": contact.lastFingerprint,
            "hadDuplicateDetected": contact.hadDuplicateDetected,
            "firstClickEventDate": contact.firstClickEventDate,
            "firstClickEventId": contact.firstClickEventId,
            "firstClickEventCampaign": contact.firstClickEventCampaign,
            "lastClickEventDate": contact.lastClickEventDate,
            "lastClickEventId": contact.lastClickEventId,
            "lastClickEventCampaign": contact.lastClickEventCampaign,
            "firstVisitEventDate": contact.firstVisitEventDate,
            "firstVisitEventId": contact.firstVisitEventId,
            "firstVisitEventCampaign": contact.firstVisitEventCampaign,
            "lastVisitEventDate": contact.lastVisitEventDate,
            "lastVisitEventId": contact.lastVisitEventId,
            "lastVisitEventCampaign": contact.lastVisitEventCampaign,
            "firstConversionEventDate": contact.firstConversionEventDate,
            "firstConversionEventId": contact.firstConversionEventId,
            "firstConversionEventCampaign": contact.firstConversionEventCampaign,
            "firstConversionEventUrl": contact.firstConversionEventUrl,
            "firstConversionEventContentType": contact.firstConversionEventContentType,
            "firstConversionEventContentId": contact.firstConversionEventContentId,
            "firstConversionEventVariantId": contact.firstConversionEventVariantId,
            "firstConversionEventPopupId": contact.firstConversionEventPopupId,
            "firstConversionEventFormId": contact.firstConversionEventFormId,
            "lastConversionEventDate": contact.lastConversionEventDate,
            "lastConversionEventId": contact.lastConversionEventId,
            "lastConversionEventCampaign": contact.lastConversionEventCampaign,
            "lastConversionEventUrl": contact.lastConversionEventUrl,
            "lastConversionEventContentType": contact.lastConversionEventContentType,
            "lastConversionEventContentId": contact.lastConversionEventContentId,
            "lastConversionEventVariantId": contact.lastConversionEventVariantId,
            "lastConversionEventPopupId": contact.lastConversionEventPopupId,
            "lastConversionEventFormId": contact.lastConversionEventFormId,
            "firstCallEventDate": contact.firstCallEventDate,
            "firstCallEventId": contact.firstCallEventId,
            "firstCallEventCampaign": contact.firstCallEventCampaign,
            "firstCallEventCcCampaign": contact.firstCallEventCcCampaign,
            "firstCallEventAgent": contact.firstCallEventAgent,
            "firstCallEventDisposition": contact.firstCallEventDisposition,
            "firstCallEventResult": contact.firstCallEventResult,
            "firstCallEventOutOfHour": contact.firstCallEventOutOfHour,
            "lastCallEventDate": contact.lastCallEventDate,
            "lastCallEventId": contact.lastCallEventId,
            "lastCallEventCampaign": contact.lastCallEventCampaign,
            "lastCallEventCcCampaign": contact.lastCallEventCcCampaign,
            "lastCallEventAgent": contact.lastCallEventAgent,
            "lastCallEventDisposition": contact.lastCallEventDisposition,
            "lastCallEventResult": contact.lastCallEventResult,
            "lastCallEventOutOfHour": contact.lastCallEventOutOfHour,
            "firstManagedCallEventDate": contact.firstManagedCallEventDate,
            "firstManagedCallEventId": contact.firstManagedCallEventId,
            "firstManagedCallEventCampaign": contact.firstManagedCallEventCampaign,
            "firstManagedCallEventCcCampaign": contact.firstManagedCallEventCcCampaign,
            "firstManagedCallEventAgent": contact.firstManagedCallEventAgent,
            "firstManagedCallEventManagementResult": contact.firstManagedCallEventManagementResult,
            "lastManagedCallEventDate": contact.lastManagedCallEventDate,
            "lastManagedCallEventId": contact.lastManagedCallEventId,
            "lastManagedCallEventCampaign": contact.lastManagedCallEventCampaign,
            "lastManagedCallEventCcCampaign": contact.lastManagedCallEventCcCampaign,
            "lastManagedCallEventAgent": contact.lastManagedCallEventAgent,
            "lastManagedCallEventManagementResult": contact.lastManagedCallEventManagementResult,
            "firstGoalEventDate": contact.firstGoalEventDate,
            "firstGoalEventId": contact.firstGoalEventId,
            "firstGoalEventCampaign": contact.firstGoalEventCampaign,
            "firstGoalEventCcCampaign": contact.firstGoalEventCcCampaign,
            "firstGoalEventAgent": contact.firstGoalEventAgent,
            "firstGoalEventManagementResult": contact.firstGoalEventManagementResult,
            "lastGoalEventDate": contact.lastGoalEventDate,
            "lastGoalEventId": contact.lastGoalEventId,
            "lastGoalEventCampaign": contact.lastGoalEventCampaign,
            "lastGoalEventCcCampaign": contact.lastGoalEventCcCampaign,
            "lastGoalEventAgent": contact.lastGoalEventAgent,
            "lastGoalEventManagementResult": contact.lastGoalEventManagementResult,
            "lastEventDate": contact.lastEventDate,
            "lastEventType": contact.lastEventType,
            "lastEventId": contact.lastEventId,
            "lastEventCampaign": contact.lastEventCampaign,
            "createdDate": contact.createdDate,
            "createdOutOfHour": contact.createdOutOfHour,
            "createdByCampaignId": contact.createdByCampaignId,
            "createdByCampaignCategory": contact.createdByCampaignCategory,
            "createdByCampaignClient": contact.createdByCampaignClient,
            "createdByUserId": contact.createdByUserId,
            "createdByEventType": contact.createdByEventType,
            "createdByEventId": contact.createdByEventId,
            "createdBySource": contact.createdBySource,
            "createdBySourceId": contact.createdBySourceId,
            "createdByClickSource": contact.createdByClickSource,
            "createdByClickId": contact.createdByClickId,
            "createdByClickCampaign": contact.createdByClickCampaign,
            "createdByClickAdGroup": contact.createdByClickAdGroup,
            "createdByClickKeyword": contact.createdByClickKeyword,
            "createdByClickAdPosition": contact.createdByClickAdPosition,
            "blocked": contact.blocked,
            "tiene_ichef": tiene_ichef,
            "participo_SDR": participo_SDR,
            "estado_sdr": estado_sdr
        }
    };

    console.log('Datos del contacto a crear:', contactData);

    // Validación: verificar que tenemos al menos un teléfono
    if (!phoneToUse) {
        console.error('❌ Error: No hay número de teléfono disponible para crear el contacto');
        return res.status(400).json({ 
            error: 'Número de teléfono requerido para crear contacto en Chatwoot',
            contact: { id: contact.id, email: contact.email }
        });
    }

    // Buscar primero si el contacto ya existe
    const buildPayloadItem = (key, value) => {
        if (!value) return null;
        return {
            attribute_key: key,
            filter_operator: "equal_to",
            values: [value],
            query_operator: "OR"
        };
    };

    const searchCriteria = [
        { id: contact.id, key: 'id' },
        { id: contact.email, key: 'email' },
        { id: phoneToUse, key: 'phone_number' },
        { id: contact.phone, key: 'phone_number' } // búsqueda adicional con phone local
    ];

    const searchPayload = {
        payload: searchCriteria
            .map(item => buildPayloadItem(item.key, item.id))
            .filter(Boolean)
            .map((item, index, array) => ({
                ...item,
                query_operator: index === array.length - 1 ? null : "OR"
            }))
    };

    try {
        // Buscar contacto existente
        // console.log('🔍 Buscando contacto existente en Chatwoot...');
        const searchResponse = await axios.post(`${chatwoot_url}/api/v1/accounts/2/contacts/filter`, searchPayload, {
            headers: {
                'Content-Type': 'application/json',
                'api_access_token': api_access_token,
            },
        });

        if (searchResponse.data.meta.count > 0) {
            // Contacto encontrado - actualizarlo
            const existingContactId = searchResponse.data.payload[0].id;
            console.log(`✅ Contacto encontrado en Chatwoot con ID: ${existingContactId}. Actualizando...`);
            
            try {
                const updateResponse = await axios.put(`${chatwoot_url}/api/v1/accounts/2/contacts/${existingContactId}`, contactData, {
                    headers: {
                        'Content-Type': 'application/json',
                        'api_access_token': api_access_token,
                    },
                });
                console.log(`✅ Contacto actualizado en Chatwoot con ID: ${existingContactId}`);
                res.status(200).json({ 
                    payload: updateResponse.data.payload || updateResponse.data,
                    action: 'updated',
                    message: 'Contacto actualizado exitosamente'
                });
            } catch (updateError) {
                console.error(`❌ Error al actualizar contacto en Chatwoot:`, updateError.message);
                if (updateError.response?.data) {
                    console.error('Detalles del error:', JSON.stringify(updateError.response.data, null, 2));
                }
                res.status(500).json({ error: updateError.message, detalles: updateError });
            }
        } else {
            // Contacto no encontrado - crear nuevo
            console.log('📝 Contacto no encontrado. Creando nuevo contacto...');
            const createResponse = await axios.post(`${chatwoot_url}/api/v1/accounts/2/contacts`, contactData, {
                headers: {
                    'Content-Type': 'application/json',
                    'api_access_token': api_access_token,
                },
            });
            
            const contactId = createResponse.data.payload?.contact?.id || 
                           createResponse.data.payload?.id || 
                           createResponse.data.id || 
                           'ID no disponible';
            console.log(`✅ Contacto creado en Chatwoot con ID: ${contactId}`);
            res.status(201).json({ 
                payload: createResponse.data.payload || createResponse.data,
                action: 'created',
                message: 'Contacto creado exitosamente'
            });
        }
    } catch (error) {
        console.error(`❌ Error en operación de contacto en Chatwoot (${error.response?.status || 'sin status'}):`, error.message);
        if (error.response?.data) {
            console.error('Detalles del error:', JSON.stringify(error.response.data, null, 2));
        }
        res.status(500).json({ error: error.message, detalles: error });
    }
};

const filterContacts = async (req, res) => {
};

const updateContact = async (req, res) => {
    const contact = req.body.eventData;
    // console.log('[updateContact] Contacto recibido para actualizar en chatwoot:', contact.id);

    // Extraer campos del customData con manejo de errores
    let tiene_ichef = '';
    let participo_SDR = '';
    let estado_sdr = '';
    let phoneInternational = null;

    try {
        if (contact && contact.customData) {
            const contactCustomData = contact.customData;
            const jsonCustomData = JSON.parse(contactCustomData);
            tiene_ichef = jsonCustomData?.tiene_ichef || '';
            participo_SDR = jsonCustomData?.participo_SDR || '';
            estado_sdr = jsonCustomData?.estado_sdr || '';
            phoneInternational = jsonCustomData?.phoneInternational || null;
        }
    } catch (error) {
        console.error('Error al parsear customData en updateContact:', error);
        tiene_ichef = '';
        participo_SDR = '';
        estado_sdr = '';
        phoneInternational = null;
    }

    // Determinar el teléfono a usar (prioridad: phoneInternational del customData, luego contact.phone)
    const phoneToUse = phoneInternational || contact.phone;

    // Extraer la etapa del contacto
    let contactStage = contact.stage;
    if (contactStage === 'lead') {
        contactStage = 'lead';
    } else if (contactStage === 'marketingQualifiedLead') {
        contactStage = 'mql';
    } else if (contactStage === 'salesQualifiedLead') {
        contactStage = 'sql';
    } else if (contactStage === 'opportunity') {
        contactStage = 'oportunidad';
    } else if (contactStage === 'customer') {
        contactStage = 'cliente';
    }

    const updateContactData = {
        "name": contact.firstname + ' ' + contact.lastname,
        "email": contact.email,
        "phone_number": phoneToUse,
        "custom_attributes": {
            "firstname": contact.firstname,
            "lastname": contact.lastname,
            "score": contact.score,
            "stage": contact.stage,
            "language": contact.language,
            "company": contact.company,
            "position": contact.position,
            "phone": contact.phone,
            "mobile": contact.mobile,
            "fax": contact.fax,
            "id": contact.id,
            "owner": contact.owner,
            "website": contact.website,
            "address1": contact.address1,
            "address2": contact.address2,
            "country": contact.country,
            "state": contact.state,
            "city": contact.city,
            "zip": contact.zip,
            "facebook": contact.facebook,
            "twitter": contact.twitter,
            "skype": contact.skype,
            "googlePlus": contact.googlePlus,
            "linkedin": contact.linkedin,
            "instagram": contact.instagram,
            "comments": contact.comments,
            "clientComments": contact.clientComments,
            "customData": contact.customData,
            "membership": contact.membership,
            "blacklist": contact.blacklist,
            "referredDate": contact.referredDate,
            "referredByContactId": contact.referredByContactId,
            "referredAtCampaignId": contact.referredAtCampaignId,
            "referredAtInteractionId": contact.referredAtInteractionId,
            "lastTrackingId": contact.lastTrackingId,
            "lastFingerprint": contact.lastFingerprint,
            "hadDuplicateDetected": contact.hadDuplicateDetected,
            "firstClickEventDate": contact.firstClickEventDate,
            "firstClickEventId": contact.firstClickEventId,
            "firstClickEventCampaign": contact.firstClickEventCampaign,
            "lastClickEventDate": contact.lastClickEventDate,
            "lastClickEventId": contact.lastClickEventId,
            "lastClickEventCampaign": contact.lastClickEventCampaign,
            "firstVisitEventDate": contact.firstVisitEventDate,
            "firstVisitEventId": contact.firstVisitEventId,
            "firstVisitEventCampaign": contact.firstVisitEventCampaign,
            "lastVisitEventDate": contact.lastVisitEventDate,
            "lastVisitEventId": contact.lastVisitEventId,
            "lastVisitEventCampaign": contact.lastVisitEventCampaign,
            "firstConversionEventDate": contact.firstConversionEventDate,
            "firstConversionEventId": contact.firstConversionEventId,
            "firstConversionEventCampaign": contact.firstConversionEventCampaign,
            "firstConversionEventUrl": contact.firstConversionEventUrl,
            "firstConversionEventContentType": contact.firstConversionEventContentType,
            "firstConversionEventContentId": contact.firstConversionEventContentId,
            "firstConversionEventVariantId": contact.firstConversionEventVariantId,
            "firstConversionEventPopupId": contact.firstConversionEventPopupId,
            "firstConversionEventFormId": contact.firstConversionEventFormId,
            "lastConversionEventDate": contact.lastConversionEventDate,
            "lastConversionEventId": contact.lastConversionEventId,
            "lastConversionEventCampaign": contact.lastConversionEventCampaign,
            "lastConversionEventUrl": contact.lastConversionEventUrl,
            "lastConversionEventContentType": contact.lastConversionEventContentType,
            "lastConversionEventContentId": contact.lastConversionEventContentId,
            "lastConversionEventVariantId": contact.lastConversionEventVariantId,
            "lastConversionEventPopupId": contact.lastConversionEventPopupId,
            "lastConversionEventFormId": contact.lastConversionEventFormId,
            "firstCallEventDate": contact.firstCallEventDate,
            "firstCallEventId": contact.firstCallEventId,
            "firstCallEventCampaign": contact.firstCallEventCampaign,
            "firstCallEventCcCampaign": contact.firstCallEventCcCampaign,
            "firstCallEventAgent": contact.firstCallEventAgent,
            "firstCallEventDisposition": contact.firstCallEventDisposition,
            "firstCallEventResult": contact.firstCallEventResult,
            "firstCallEventOutOfHour": contact.firstCallEventOutOfHour,
            "lastCallEventDate": contact.lastCallEventDate,
            "lastCallEventId": contact.lastCallEventId,
            "lastCallEventCampaign": contact.lastCallEventCampaign,
            "lastCallEventCcCampaign": contact.lastCallEventCcCampaign,
            "lastCallEventAgent": contact.lastCallEventAgent,
            "lastCallEventDisposition": contact.lastCallEventDisposition,
            "lastCallEventResult": contact.lastCallEventResult,
            "lastCallEventOutOfHour": contact.lastCallEventOutOfHour,
            "firstManagedCallEventDate": contact.firstManagedCallEventDate,
            "firstManagedCallEventId": contact.firstManagedCallEventId,
            "firstManagedCallEventCampaign": contact.firstManagedCallEventCampaign,
            "firstManagedCallEventCcCampaign": contact.firstManagedCallEventCcCampaign,
            "firstManagedCallEventAgent": contact.firstManagedCallEventAgent,
            "firstManagedCallEventManagementResult": contact.firstManagedCallEventManagementResult,
            "lastManagedCallEventDate": contact.lastManagedCallEventDate,
            "lastManagedCallEventId": contact.lastManagedCallEventId,
            "lastManagedCallEventCampaign": contact.lastManagedCallEventCampaign,
            "lastManagedCallEventCcCampaign": contact.lastManagedCallEventCcCampaign,
            "lastManagedCallEventAgent": contact.lastManagedCallEventAgent,
            "lastManagedCallEventManagementResult": contact.lastManagedCallEventManagementResult,
            "firstGoalEventDate": contact.firstGoalEventDate,
            "firstGoalEventId": contact.firstGoalEventId,
            "firstGoalEventCampaign": contact.firstGoalEventCampaign,
            "firstGoalEventCcCampaign": contact.firstGoalEventCcCampaign,
            "firstGoalEventAgent": contact.firstGoalEventAgent,
            "firstGoalEventManagementResult": contact.firstGoalEventManagementResult,
            "lastGoalEventDate": contact.lastGoalEventDate,
            "lastGoalEventId": contact.lastGoalEventId,
            "lastGoalEventCampaign": contact.lastGoalEventCampaign,
            "lastGoalEventCcCampaign": contact.lastGoalEventCcCampaign,
            "lastGoalEventAgent": contact.lastGoalEventAgent,
            "lastGoalEventManagementResult": contact.lastGoalEventManagementResult,
            "lastEventDate": contact.lastEventDate,
            "lastEventType": contact.lastEventType,
            "lastEventId": contact.lastEventId,
            "lastEventCampaign": contact.lastEventCampaign,
            "createdDate": contact.createdDate,
            "createdOutOfHour": contact.createdOutOfHour,
            "createdByCampaignId": contact.createdByCampaignId,
            "createdByCampaignCategory": contact.createdByCampaignCategory,
            "createdByCampaignClient": contact.createdByCampaignClient,
            "createdByUserId": contact.createdByUserId,
            "createdByEventType": contact.createdByEventType,
            "createdByEventId": contact.createdByEventId,
            "createdBySource": contact.createdBySource,
            "createdBySourceId": contact.createdBySourceId,
            "createdByClickSource": contact.createdByClickSource,
            "createdByClickId": contact.createdByClickId,
            "createdByClickCampaign": contact.createdByClickCampaign,
            "createdByClickAdGroup": contact.createdByClickAdGroup,
            "createdByClickKeyword": contact.createdByClickKeyword,
            "createdByClickAdPosition": contact.createdByClickAdPosition,
            "blocked": contact.blocked,
            "tiene_ichef": tiene_ichef,
            "participo_SDR": participo_SDR,
            "estado_sdr": estado_sdr
        }
    };

    // Extraer phoneInternational del customData para búsqueda
    let phoneInternationalForSearch = null;
    try {
        if (contact && contact.customData) {
            const jsonCustomData = JSON.parse(contact.customData);
            phoneInternationalForSearch = jsonCustomData?.phoneInternational || null;
        }
    } catch (error) {
        console.error('Error al parsear customData para búsqueda:', error);
    }

    // Buscar el contacto en Chatwoot usando múltiples criterios
    const buildPayloadItem = (key, value) => {
        if (!value) return null;
        return {
            attribute_key: key,
            filter_operator: "equal_to",
            values: [value],
            query_operator: "OR"
        };
    };

    const searchCriteria = [
        { id: contact.id, key: 'id' },
        { id: contact.email, key: 'email' },
        { id: contact.phone, key: 'phone_number' },
        { id: phoneInternationalForSearch, key: 'phone_number' }
    ];

    const payload = {
        payload: searchCriteria
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
            const contactId = response.data.payload[0].id;

            // Actualiza datos del contacto
            try {
                const response = await axios.put(`${chatwoot_url}/api/v1/accounts/2/contacts/${contactId}`, updateContactData, {
                    headers: {
                        'Content-Type': 'application/json',
                        'api_access_token': api_access_token,
                    },
                });
                console.log(`Contacto actualizado en chatwoot con id ${response.data.payload.id}`);
                // res.status(200).json(response.data);
            } catch (error) {
                console.error(`Error al actualizar contacto en chatwoot:`, contactId, error.message);
                //console.log(updateContactData);
                res.status(500).json({ error: error.message, detalles: error });
                return;
            }

            // Buscar las conversaciones del contacto
            try {
                const response = await axios.get(`${chatwoot_url}/api/v1/accounts/2/contacts/${contactId}/conversations`, {
                    headers: {
                        'Content-Type': 'application/json',
                        'api_access_token': api_access_token,
                    }
                });

                const conversations = response.data.payload.map(conversation => ({
                    id: conversation.id,
                    status: conversation.status,
                    tags: conversation.labels || []
                }));

                //console.log(`Conversaciones del contacto:`, conversations);

                conversations.forEach(async conversation => {
                    try {
                        // Filtrar las etiquetas existentes
                        const currentLabels = conversation.tags;
                        //console.log(`Etiquetas actuales:`, currentLabels);

                        // Remover etiquetas de oportunidad anteriores
                        const opportunityLabels = ['lead', 'mql', 'sql', 'oportunidad', 'cliente'];
                        const filteredLabels = currentLabels.filter(label => !opportunityLabels.includes(label));

                        // Remover etiqueta tiene_ichef si existe
                        const finalLabels = filteredLabels.filter(label => label !== 'tiene_ichef');

                        // Preparar las etiquetas actualizadas con la etapa actual
                        let updatedLabels = [...finalLabels, contactStage];

                        // Agregar etiqueta tiene_ichef solo si es "Sí"
                        if (tiene_ichef === "Sí") {
                            updatedLabels = [...updatedLabels, 'tiene_ichef'];
                        }

                        //console.log(`Etiquetas actualizadas:`, updatedLabels);

                        const updateConversationData = {
                            "labels": updatedLabels
                        };

                        const response = await axios.post(
                            `${chatwoot_url}/api/v1/accounts/2/conversations/${conversation.id}/labels`,
                            updateConversationData,
                            {
                                headers: {
                                    'Content-Type': 'application/json',
                                    'api_access_token': api_access_token,
                                },
                            }
                        );
                        // console.log(`Conversación ${conversation.id} actualizada en chatwoot con etiquetas:`, updatedLabels);
                    } catch (error) {
                        console.error(`Error al actualizar etiquetas de la conversación en chatwoot:`, error.message);
                    }
                });

            } catch (error) {
                console.error(`Error al buscar conversaciones del contacto en chatwoot:`, error.message);
                res.status(500).json({ error: error.message });
            }
            console.log('Contacto actualizado en chatwoot con id:', contact.id);
            res.status(200).json({ message: 'Contacto actualizado en chatwoot' });
        } else {
            console.log('Contacto no encontrado en chatwoot para actualizar:', contact.id);
            res.status(404).json({ message: 'Contacto no encontrado' });
        }
    } catch (error) {
        console.error(` Error:`, error);
        res.status(500).json({ error: error.message, detalles: error });
    }
};

const deleteContact = async (req, res) => {
    const contact = req.body.eventData;
    console.log('[deleteContact] Contacto recibido para eliminar en chatwoot:', contact.id);

    // Busar el contacto en Chatwoot

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
            { id: contact.id, key: 'id' },
            { id: contact.email, key: 'email' },
            { id: contact.phone, key: 'phone_number' }
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
            const contactId = response.data.payload[0].id;
            try {
                const response = await axios.delete(`${chatwoot_url}/api/v1/accounts/2/contacts/${contactId}`, {
                    headers: {
                        'Content-Type': 'application/json',
                        'api_access_token': api_access_token,
                    },
                });
                console.log(`Contacto eliminado en chatwoot con id ${contactId}`);
                res.status(200).json(response.data);
            } catch (error) {
                console.error(` Error al eliminar contacto en chatwoot:`, error.message);
                res.status(500).json({ error: error.message, detalles: error });
            }
        } else {
            console.log('Contacto no encontrado en chatwoot para eliminar:', contact.id);
            res.status(404).json({ message: 'Contacto no encontrado en chatwoot' });
        }

    } catch (error) {
        console.error(` Error:`, error);
        res.status(500).json({ error: error.message, detalles: error });
    }

};


export { createContact, importContacts, filterContacts, updateContact, deleteContact };
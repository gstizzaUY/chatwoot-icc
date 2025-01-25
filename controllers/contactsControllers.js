import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const chatwoot_url = process.env.CHATWOOT_URL;
const api_access_token = process.env.API_ACCESS_TOKEN;

const importContacts = async (req, res) => {
    const contact = req.body.contact;   

    const contactData = {
        "name": contact.firstname + ' ' + contact.lastname,
        "inbox_id": contact.phone !== null ? 4 : 1,
        "email": contact.email,
        "phone_number": contact.phoneInternational,
        "identifier": contact.id,
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
            "blocked": contact.blocked
        }
    };


    const createNewContactImport = async () => {

        try {
            const response = await axios.post(`${chatwoot_url}/api/v1/accounts/2/contacts`, contactData, {
                headers: {
                    'Content-Type': 'application/json',
                    'api_access_token': api_access_token,
                },
            });
            console.log(`Contacto creado con id ${response.data.id}`);
        } catch (error) {
            console.error(` Error al crear contacto:`, error.message);
        }
    };

    const updateContactImport = async (contactId) => {

        const updateContactData = {
            "name": contact.firstname + ' ' + contact.lastname,
            "email": contact.email,
            "phone_number": contact.phoneInternational,
            "identifier": contact.id,
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
                "blocked": contact.blocked
            }
        };
        try {
            const response = await axios.put(`${chatwoot_url}/api/v1/accounts/2/contacts/${contactId}`, updateContactData, {
                headers: {
                    'Content-Type': 'application/json',
                    'api_access_token': api_access_token,
                },
            });
            console.log(`Contacto actualizado con id ${response.data.id}`);
        } catch (error) {
            console.error(` Error al actualizar contacto:`, error.message);
        }
    };

    // Buscar el contacto en Chatwoot
    const payload = {
        "payload": [
            {
                "attribute_key": "identifier",
                "filter_operator": "equal_to",
                "values": [contact.id],
            }
        ]
    }

    try {
        const response = await axios.post(`${chatwoot_url}/api/v1/accounts/2/contacts/filter`, payload, {
            headers: {
                'Content-Type': 'application/json',
                'api_access_token': api_access_token,
            },
        });

        if (response.data.meta.count > 0) {
            console.log('Contacto encontrado:', response.data);
            await updateContactImport(response.data.payload[0].id);
            res.status(200).json(response.data);

        } else {
            console.log('Contacto no encontrado');
            await createNewContactImport();
            res.status(404).json({ message: 'Contacto no encontrado' });
        }

    } catch (error) {
        console.error(` Error:`, error);
        res.status(500).json({ error: error.message, detalles: error });
    }

    

};



const createContact = async (req, res) => {
    const contact = req.body.eventData;
    const contactData = {
        "name": contact.firstname + ' ' + contact.lastname,
        "inbox_id": contact.phone !== undefined ? 4 : 1,
        "email": contact.email,
        "phone_number": contact.phone,
        "identifier": contact.id,
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
            "blocked": contact.blocked
        }
    };

    try {
        const response = await axios.post(`${chatwoot_url}/api/v1/accounts/2/contacts`, contactData, {
            headers: {
                'Content-Type': 'application/json',
                'api_access_token': api_access_token,
            },
        });
        console.log(`Contacto creado con id ${response.data.payload.identifier}`);
        res.status(200).json(response.data.payload);
    } catch (error) {
        console.error(` Error al crear contacto:`, error.message);
        res.status(500).json({ error: error.message, detalles: error });
    }
};



const filterContacts = async (req, res) => {

};

const updateContact = async (req, res) => {
    const contact = req.body.eventData;
    const updateContactData = {
        "name": contact.firstname + ' ' + contact.lastname,
        "email": contact.email,
        "phone_number": contact.phoneInternational,
        "identifier": contact.id,
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
            "blocked": contact.blocked
        }
    };

    
    // Busar el contacto en Chatwoot
    const payload = {
        "payload": [
            {
                "attribute_key": "identifier",
                "filter_operator": "equal_to",
                "values": [contact.id],
            }
        ]
    }

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
                const response = await axios.put(`${chatwoot_url}/api/v1/accounts/2/contacts/${contactId}`, updateContactData, {
                    headers: {
                        'Content-Type': 'application/json',
                        'api_access_token': api_access_token,
                    },
                });
                console.log(`Contacto actualizado con id ${response.data.payload.identifier}`);
                res.status(200).json(response.data);
            } catch (error) {
                console.error(` Error al actualizar contacto:`, error.message);
                res.status(500).json({ error: error.message, detalles: error });
            }
        } else {
            console.log('Contacto no encontrado');
            res.status(404).json({ message: 'Contacto no encontrado' });
        }

    } catch (error) {
        console.error(` Error:`, error);
        res.status(500).json({ error: error.message, detalles: error });
    }

};




const deleteContact = async (req, res) => {
    const contact = req.body.eventData;
    console.log(contact);

    // Busar el contacto en Chatwoot

    const payload = {
        "payload": [
            {
                "attribute_key": "identifier",
                "filter_operator": "equal_to",
                "values": [contact.id],
            }
        ]
    }


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
                console.log(`Contacto eliminado con id ${contactId}`);
                res.status(200).json(response.data);
            } catch (error) {
                console.error(` Error al eliminar contacto:`, error.message);
                res.status(500).json({ error: error.message, detalles: error });
            }
        } else {
            console.log('Contacto no encontrado');
            res.status(404).json({ message: 'Contacto no encontrado' });
        }

    } catch (error) {
        console.error(` Error:`, error);
        res.status(500).json({ error: error.message, detalles: error });
    }

};


export { createContact, importContacts, filterContacts, updateContact, deleteContact };
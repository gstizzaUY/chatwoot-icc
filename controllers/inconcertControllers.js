import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const inconcert_url = process.env.INCONCERT_URL;
const serviceToken = process.env.INCONCERT_CREATE_CONTACT_TOKEN

const chatwootWebhook = async (req, res) => {

    const webhook = req.body;
    console.log(webhook);


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

export { chatwootWebhook };
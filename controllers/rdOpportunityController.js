import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const RDSTATION_CRM_URL = process.env.RDSTATION_CRM_URL;
const RDSTATION_USER_TOKEN = process.env.RDSTATION_USER_TOKEN;

const rdstation = axios.create({
	baseURL: RDSTATION_CRM_URL,
	params: { token: RDSTATION_USER_TOKEN },
	headers: {
		"Content-Type": "application/json"
	}
});

function GenerateContactId(phone) {
	if (!phone) return null;
	return `${phone.replace(/\D/g, "")}@email.com`;
}

async function GetContactCRM(phone, email) {
	try {
		if (email) {
			const filter = encodeURIComponent(`${email}`);
			const response = await rdstation.get(`/api/v1/contacts?email=${filter}`);
			if (response.data.total > 0)
				return response.data.contacts[0];
		}
		const email2 = GenerateContactId(phone);
		const filter = encodeURIComponent(`${email2}`);
		const response = await rdstation.get(`/api/v1/contacts?email=${filter}`);
		if (response.data.total > 0)
			return response.data.contacts[0];
	} catch (error) {
		console.error("Error al obtener contacto en crm", error.message);
		return null;
	}
	return null;
}

async function FetchOpportunity(phone, email) {
	var contact = await GetContactCRM(phone, email);
	if (!contact) return null;

	for (let i = 0; i < contact.deals.length; i++) {
		const dealId = contact.deals[i].id;
		try {
			const response = await rdstation.get(`/api/v1/deals/${dealId}`);
			contact.deals[i] = response.data;
		} catch (error) {
			console.error("Error al obtener oportunidad en crm", error.message, dealId);
			continue;
		}
	}
	return contact;
}

async function GetOpportunityRD(req, res) {
	const email = req.query.email;
	const phone = req.query.phone;
	const opportunity = await FetchOpportunity(phone, email);
	if (opportunity) return res.status(200).json(opportunity);
	return res.status(404).send("Opportunity not found");
}

export { GetOpportunityRD };

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
			if (response.data.total > 0) return response.data.contacts[0];
		}
		const email2 = GenerateContactId(phone);
		const filter = encodeURIComponent(`${email2}`);
		const response = await rdstation.get(`/api/v1/contacts?email=${filter}`);
		if (response.data.total > 0) return response.data.contacts[0];
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

async function UpdateOpportunityStage(req, res) {
	const { dealId, stageId, state } = req.body;

	const body = {
		deal_stage_id: stageId,
		deal: {
			win: state === "won" ? true : state === "lost" ? false : null
		}
	};

	try {
		const response = await rdstation.put(`/api/v1/deals/${dealId}`, body);
		return res.status(200).json(response.data);
	} catch (error) {
		console.error("Error al actualizar etapa de oportunidad en crm", error.message);
		return res.status(500).send("Error al actualizar etapa de oportunidad");
	}
}

async function CreateOpportunity(req, res) {
	const { contact, stageId } = req.body;

	const body = {
		campaign: {
			_id: "68cb06c75243470001ea5a30"
		},
		contacts: [
			{
				name: contact.name,
				emails: [
					{
						email: contact.email
					}
				],
				phones: [
					{
						type: "cellphone",
						phone: contact.phone
					}
				]
			}
		],
		deal: {
			name: contact.name,
			deal_stage_id: stageId
		}
	};

	try {
		const response = await rdstation.post("/api/v1/deals", body);
		return res.status(200).json(response.data);
	} catch (error) {
		console.error("Error al crear oportunidad en crm", error.message);
		return res.status(500).send("Error al crear oportunidad");
	}
}

export { GetOpportunityRD, UpdateOpportunityStage, CreateOpportunity };

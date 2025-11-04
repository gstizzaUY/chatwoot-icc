import axios from "axios";
import dotenv, { parse } from "dotenv";

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

async function GetCRMContact(email) {
	const filter = encodeURIComponent(`${email.toLowerCase()}`);
	const response = await rdstation.get(`/api/v1/contacts?email=${filter}`);
	if (response.data.total > 0) return response.data.contacts[0];
	return null;
}

function GenerateContactId(phone) {
	return `${phone.replace(/\D/g, "")}@email.com`;
}

async function CreateCRMContact(name, phone, email) {
	const body = {
		name: name,
		phones: [
			{
				type: "cellphone",
				phone: phone
			}
		],
		emails: [
			{
				email: email
			}
		]
	};
	const response = await rdstation.post("/api/v1/contacts", body);
	return response.data;
}

const DEAL_STAGES = [
	{ id: 1, token: "68d14bbd5a3017001e7e3a0e", name: "Iniciar Agendamiento" },
	{ id: 2, token: "68d14bbd5a3017001e7e3a0f", name: "Agendar Demo" },
	{ id: 5, token: "68d14bbd5a3017001e7e3a10", name: "Demo Agendada" },
	{ id: 25, token: "68d14bbd5a3017001e7e3a11", name: "Demo Realizada" },
	{ id: 40, token: "68d14bbd5a3017001e7e3a12", name: "Negociación Comercial" }
];

async function CreateDeal(name, stage) {
	const stageInfo = DEAL_STAGES.find(s => s.id === stage) || DEAL_STAGES[0];
	const state = stage === 100 ? true : stage === 0 ? false : null;

	const body = {
		campaign: {
			_id: "68cb06c75243470001ea5a30"
		},
		deal: {
			name: name,
			win: state,
			deal_stage_id: stageInfo.token,
			deal_custom_fields: [
				{
					custom_field_id: "68ff4443002ff90016120b66",
					value: "iChef Center"
				}
			]
		}
	};
	const response = await rdstation.post("/api/v1/deals", body);
	return response.data;
}

async function UpdateContactDeal(dealId, stage) {
	const stageInfo = DEAL_STAGES.find(s => s.id === stage) || DEAL_STAGES[0];
	const state = stage === 100 ? true : stage === 0 ? false : null;

	const body = {
		deal: {
			win: state,
			deal_custom_fields: [
				{
					custom_field_id: "68ff4443002ff90016120b66",
					value: "iChef Center"
				}
			]
		},
		deal_stage_id: stageInfo.token
	};
	const response = await rdstation.put(`/api/v1/deals/${dealId}`, body);
	return response.data;
}

async function SetContactDeal(contactId, dealId) {
	const body = {
		deal_ids: [dealId]
	};
	const response = await rdstation.put(`/api/v1/contacts/${contactId}`, body);
	return response.data;
}

async function ProcessOpportunity(stage, opportunityData) {
	const name = `${opportunityData.firstname || ""} ${opportunityData.lastname || ""}`.trim();
	const phone = opportunityData.phoneInternational || "";
	const email = opportunityData.email || GenerateContactId(opportunityData.phoneInternational);
	if (!email) {
		console.error("Contacto sin email ni teléfono válido");
		return;
	}

	var contact = await GetCRMContact(email);
	if (!contact) {
		console.info(`No se encontró el contacto, con email: ${email}`);
		contact = await CreateCRMContact(name, phone, email);
	}

	if (contact.deals && contact.deals.length > 0) {
		const dealId = contact.deals[0].id;
		await UpdateContactDeal(dealId, stage);
		console.log("Oportunidad actualizada", phone, contact.id, dealId);
	} else {
		const deal = await CreateDeal(name, stage);
		await SetContactDeal(contact.id, deal.id);
		console.log("Oportunidad creada", phone, contact.id, deal.id);
	}
}

async function MigrateOpportunity(req, res) {
	const { stage } = req.params;
	const body = req.body;

	var opportunityData = {};
	for (const key in body)
		if (body[key] !== null && body[key] !== "" && body[key] !== false && body[key] !== 0)
			opportunityData[key] = body[key];

	const intStage = parseInt(stage, 10);
	try {
		await ProcessOpportunity(intStage, opportunityData);
	} catch (error) {
		console.error("Error al migrar oportunidad", error.message, JSON.stringify(opportunityData));
	}
	return res.status(200).send("Event received");
}

export { MigrateOpportunity };

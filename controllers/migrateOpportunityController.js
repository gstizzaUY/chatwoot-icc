import axios from "axios";
import dotenv, { parse } from "dotenv";

dotenv.config();

const RDSTATION_CRM_URL = process.env.RDSTATION_CRM_URL;
const RDSTATION_USER_TOKEN = process.env.RDSTATION_USER_TOKEN;

const rdstation_crm = axios.create({
	baseURL: RDSTATION_CRM_URL,
	params: { token: RDSTATION_USER_TOKEN },
	headers: {
		"Content-Type": "application/json"
	}
});

const RDSTATION_URL = process.env.RDSTATION_URL;
const RDSTATION_CLIENT_ID = process.env.RDSTATION_CLIENT_ID;
const RDSTATION_CLIENT_SECRET = process.env.RDSTATION_CLIENT_SECRET;
const RDSTATION_REFRESH_TOKEN = process.env.RDSTATION_REFRESH_TOKEN;

const rdstation_mkt = axios.create({
	baseURL: RDSTATION_URL,
	headers: {
		"Content-Type": "application/json"
	}
});

async function UpdateAccessToken() {
	const credentials = {
		client_id: RDSTATION_CLIENT_ID,
		client_secret: RDSTATION_CLIENT_SECRET,
		refresh_token: RDSTATION_REFRESH_TOKEN
	};
	const response = await rdstation_mkt.post("/auth/token", credentials);
	const token = response.data.access_token;
	rdstation_mkt.defaults.headers["Authorization"] = `Bearer ${token}`;
}

async function GetCRMContact(email) {
	const filter = encodeURIComponent(email);
	const response = await rdstation_crm.get(`/api/v1/contacts?email=${filter}`);
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
	const response = await rdstation_crm.post("/api/v1/contacts", body);
	return response.data;
}

const DEAL_STAGES = [
	{ index: 1, stage_id: "68d14bbd5a3017001e7e3a0e", name: "Iniciar Agendamiento" },
	{ index: 2, stage_id: "68d14bbd5a3017001e7e3a0f", name: "Agendar Demo" },
	{ index: 5, stage_id: "68d14bbd5a3017001e7e3a10", name: "Demo Agendada" },
	{ index: 25, stage_id: "68d14bbd5a3017001e7e3a11", name: "Demo Realizada" },
	{ index: 40, stage_id: "68d14bbd5a3017001e7e3a12", name: "Negociación Comercial" },

	{ index: 0, stage_id: "69176d13cd5edb001e64c5d9", name: "Cerrada Perdida" },
	{ index: 100, stage_id: "69176d0ad5402600168336b1", name: "Cerrada Ganada" }
];

async function CreateDeal(name, stage) {
	const stageInfo = DEAL_STAGES.find(s => s.index === stage) || DEAL_STAGES[0];

	const body = {
		campaign: {
			_id: "68cb06c75243470001ea5a30"
		},
		deal: {
			name: name,
			deal_stage_id: stageInfo.stage_id
		}
	};
	const response = await rdstation_crm.post("/api/v1/deals", body);
	return response.data;
}

async function UpdateContactDeal(dealId, stage) {
	const stageInfo = DEAL_STAGES.find(s => s.index === stage) || DEAL_STAGES[0];
	const state = stage === 100 ? true : stage === 0 ? false : null;

	const body = {
		deal: {
			win: state
		},
		deal_stage_id: stageInfo.stage_id
	};
	const response = await rdstation_crm.put(`/api/v1/deals/${dealId}`, body);
	return response.data;
}

async function SetContactDeal(contactId, dealId) {
	const body = {
		deal_ids: [dealId]
	};
	const response = await rdstation_crm.put(`/api/v1/contacts/${contactId}`, body);
	return response.data;
}

async function GetMKTContact(email) {
	const filter = encodeURIComponent(email);
	try {
		const response = await rdstation_mkt.get(`/platform/contacts/email:${filter}`);
		return response.data;
	} catch (error) {
		if (error.response && error.response.status === 404) {
			return null;
		} else {
			throw error;
		}
	}
}

async function CreateMKTContact(name, phone, email) {
	const body = {
		name: name,
		email: email,
		mobile_phone: phone,
		personal_phone: phone,
		cf_stage: "opportunity"
	};
	const response = await rdstation_crm.post("/api/v1/contacts", body);
	return response.data;
}

async function MarkMKTOpportunity(email) {
	const body = {
		event_type: "OPPORTUNITY",
		event_family: "CDP",
		payload: {
			email: email,
			funnel_name: "default"
		}
	};
	const response = await rdstation_mkt.post("/platform/events?event_type=opportunity", body);
	return response.data;
}

async function ProcessOpportunity(stage, opportunityData) {
	const name = `${opportunityData.firstname || ""} ${opportunityData.lastname || ""}`.trim();
	const phone = opportunityData.phoneInternational?.replace(/\D/g, "") || "";
	var email = opportunityData.email?.toLowerCase();

	if (!email || !email.includes("@")) {
		if (!phone) {
			console.error("Contacto sin email ni teléfono válido");
			return;
		}
		email = GenerateContactId(phone);
	}

	var contact_mkt = null;
	try {
		contact_mkt = await GetMKTContact(email);
	} catch (error) {
		if (error.response && error.response.status === 401) {
			console.info("Token MKT inválido, actualizando...");
			await UpdateAccessToken();
			contact_mkt = await GetMKTContact(email);
		} else console.error("Error al obtener contacto MKT", error.message);
	}

	if (!contact_mkt) {
		console.info(`No se encontró el contacto en MKT, con email: ${email}`);
		contact_mkt = await CreateMKTContact(name, phone, email);
	}
	await MarkMKTOpportunity(email);

	var contact = await GetCRMContact(email);
	if (!contact) {
		console.info(`No se encontró el contacto en CRM, con email: ${email}`);
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

const jobQueue = [];
let processing = false;

async function processQueue() {
	if (processing) return;
	processing = true;
	while (jobQueue.length > 0) {
		const { stage, body } = jobQueue.shift();
		try {
			await ProcessOpportunity(stage, body);
		} catch (error) {
			console.error("Error al migrar oportunidad", error.message, JSON.stringify(body));
		}
		await delay(1000);
	}
	processing = false;
}

function delay(ms) {
	return new Promise(res => setTimeout(res, ms));
}

async function MigrateOpportunity(req, res) {
	const { stage } = req.params;
	const body = req.body;

	var opportunityData = {};
	for (const key in body)
		if (body[key] !== null && body[key] !== "" && body[key] !== false && body[key] !== 0)
			opportunityData[key] = body[key];

	const intStage = parseInt(stage, 10);

	jobQueue.push({ stage: intStage, body: opportunityData });
	processQueue();

	return res.status(200).send("Event received");
}

export { MigrateOpportunity };

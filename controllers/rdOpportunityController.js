import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const RDSTATION_URL = process.env.RDSTATION_URL;
const RDSTATION_CLIENT_ID = process.env.RDSTATION_OPPORTUNITY_CLIENT_ID;
const RDSTATION_CLIENT_SECRET = process.env.RDSTATION_OPPORTUNITY_CLIENT_SECRET;
const RDSTATION_REFRESH_TOKEN = process.env.RDSTATION_OPPORTUNITY_REFRESH_TOKEN;

const rdstation = axios.create({
	baseURL: RDSTATION_URL,
	headers: {
		"Content-Type": "application/json"
	}
});

function SetAccessToken(token) {
	rdstation.defaults.headers["Authorization"] = `Bearer ${token}`;
}

async function UpdateAccessToken() {
	const credentials = {
		grant_type: "refresh_token",
		client_id: RDSTATION_CLIENT_ID,
		client_secret: RDSTATION_CLIENT_SECRET,
		refresh_token: RDSTATION_REFRESH_TOKEN
	};
	try {
		const response = await rdstation.post("/oauth2/token", credentials);
		return response.data.access_token;
	} catch (error) {
		console.error("Error al actualizar token", error.message);
		return null;
	}
}

function GenerateContactId(phone) {
	return `${phone.replace(/\D/g, "")}@email.com`;
}

async function GetContactID(phone, email) {
	try {
		if (email) {
			const filter = encodeURIComponent(`email:${email}`);
			const response = await rdstation.get(`/crm/v2/contacts?filter=${filter}`);
			if (response.data.data && response.data.data.length > 0)
				return response.data.data[0].id;
		}
		const email2 = GenerateContactId(phone);
		const filter = encodeURIComponent(`email:${email2}`);
		const response = await rdstation.get(`/crm/v2/contacts?filter=${filter}`);
		if (response.data.data && response.data.data.length > 0)
			return response.data.data[0].id;
	} catch (error) {
		if (error.response && error.response.status === 401) throw new Error("INVALID_TOKEN");
		console.error("Error al obtener id contacto en crm", JSON.stringify(contactData), error.message);
		return null;
	}
	return null;
}

async function GetContactDeal(contactId) {
	var page = 1;
	while (true) {
		const response = await rdstation.get(`/crm/v2/deals?page[number]=${page}&page[size]=50`);
		if (!response.data.data || response.data.data.length === 0)
			break;
		for (const deal of response.data.data) {
			console.log("Checking deal:", deal.id, "for contact ID:", contactId);
			if (deal.id === contactId)
				return deal;
		}
		page++;
	}
	return null;
}

async function FetchOpportunity(phone, email) {
	console.log("Fetching contact ID for:", phone, email);
	const contactId = await GetContactID(phone, email);
	console.log("Contact ID:", contactId);
	if (!contactId) return null;
	var deal = await GetContactDeal(contactId);
	console.log("Deal:", deal);
	if (!deal) return null;

	const stageId = deal.stage_id;
	const pipelineId = "68d14bbd5a3017001e7e3a0c";

	const response = await rdstation.get(`/crm/v2/pipelines/${pipelineId}/stages/${stageId}`);
	const stage = response.data.data;
	console.log("Stage:", stage);
	deal = {
		stage_name: stage.name,
		stage_description: stage.description,
		stage_objective: stage.objective,
		...deal,
	}
	return deal;
}

async function GetOpportunityRD(req, res) {
	const email = req.query.email;
	const phone = req.query.phone;
	console.log("Fetching opportunity for:", phone, email);
	try {
		const opportunity = await FetchOpportunity(phone, email);
		if (opportunity) return res.status(200).json(opportunity);
	} catch (error) {
		try {
		console.error("Error fetching opportunity:", error.message);
		if (error.message === "INVALID_TOKEN") {
			console.log("Getting new access token");
			const token = await UpdateAccessToken();
			SetAccessToken(token);
			const opportunity = await FetchOpportunity(phone, email);
			if (opportunity) return res.status(200).json(opportunity);
		}
		} catch (error2) {
			return res.status(500).send("Failed to update token");
		}
	}
	return res.status(404).send("Opportunity not found");
}

export { GetOpportunityRD };

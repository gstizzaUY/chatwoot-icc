import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const RDSTATION_URL = process.env.RDSTATION_URL;
const RDSTATION_CLIENT_ID = process.env.RDSTATION_CLIENT_ID;
const RDSTATION_CLIENT_SECRET = process.env.RDSTATION_CLIENT_SECRET;
const RDSTATION_REFRESH_TOKEN = process.env.RDSTATION_REFRESH_TOKEN;
const RDSTATION_CRM_URL = process.env.RDSTATION_CRM_URL || "https://crm.rdstation.com";
const RDSTATION_USER_TOKEN = process.env.RDSTATION_USER_TOKEN;

const crmStation = axios.create({
	baseURL: `${RDSTATION_CRM_URL}/api/v1`,
	params: { token: RDSTATION_USER_TOKEN },
	headers: {
		"Content-Type": "application/json"
	}
});

const DEAL_STAGES = {
	"68d14bbd5a3017001e7e3a0e": "Iniciar Agendamiento",
	"68d14bbd5a3017001e7e3a0f": "Agendar Demo",
	"68d14bbd5a3017001e7e3a10": "Demo Agendada",
	"68d14bbd5a3017001e7e3a11": "Demo Realizada",
	"68d14bbd5a3017001e7e3a12": "Negociación Comercial",
	"69176d13cd5edb001e64c5d9": "Cerrada Perdida",
	"69176d0ad5402600168336b1": "Cerrada Ganada"
};

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
		client_id: RDSTATION_CLIENT_ID,
		client_secret: RDSTATION_CLIENT_SECRET,
		refresh_token: RDSTATION_REFRESH_TOKEN
	};
	try {
		const response = await rdstation.post("/auth/token", credentials);
		return response.data.access_token;
	} catch (error) {
		console.error("Error al actualizar token", error.message);
		return null;
	}
}

function GenerateContactId(phone) {
	if (!phone) return null;
	return `${phone.replace(/\D/g, "")}@email.com`;
}

async function SendEvent(email, event_name) {
	try {
		const response = await rdstation.post("/platform/events?event_type=conversion", {
			event_type: "CONVERSION",
			event_family: "CDP",
			payload: {
				conversion_identifier: event_name,
				email: email
			}
		});
		return response.data;
	} catch (error) {
		if (error.response && error.response.status === 401) throw new Error("INVALID_TOKEN");
		if (error.response && error.response.status === 404) return null;
		console.error("Error al enviar evento", error.message);
		return null;
	}
}

async function GetContact(email) {
	try {
		const response = await rdstation.get(`/platform/contacts/email:${encodeURIComponent(email)}`);
		return response.data;
	} catch (error) {
		if (error.response && error.response.status === 401) throw new Error("INVALID_TOKEN");
		if (error.response && error.response.status === 404) return null;
		console.error("Error al obtener contacto", error.message);
		return null;
	}
}

async function CreateContact(contact) {
	const contactData = {
		name: contact.name,
		email: contact.email || GenerateContactId(contact.phone),
		mobile_phone: contact.phone.replace(/\D/g, ""),
		cf_nickname: contact.username,
		cf_id_equipo: contact.serial,
		cf_tiene_ichef: contact.serial ? "Sí" : "No"
	};
	try {
		const response = await rdstation.post("/platform/contacts", contactData);
		return response.data;
	} catch (error) {
		if (error.response && error.response.status === 401) throw new Error("INVALID_TOKEN");
		console.error("Error al crear contacto", contactData, error.message);
		return null;
	}
}

// Only updates from register
async function UpdateContact(email, contact) {
	const contactData = {
		name: contact.name,
		mobile_phone: contact.phone.replace(/\D/g, ""),
		cf_nickname: contact.username,
		cf_id_equipo: contact.serial,
		cf_tiene_ichef: contact.serial ? "Sí" : "No"
	};
	try {
		const response = await rdstation.patch(`/platform/contacts/email:${encodeURIComponent(email)}`, contactData);
		return response.data;
	} catch (error) {
		if (error.response && error.response.status === 401) throw new Error("INVALID_TOKEN");
		console.error("Error al actualizar contacto", contactData, error.message);
		return null;
	}
}

async function CreateIfNew(contact, do_update) {
	const email = contact.email;
	if (email) {
		const existing_contact = await GetContact(email);
		if (existing_contact) {
			if (do_update) {
				const updated_contact = await UpdateContact(email, contact);
				console.log("Contacto actualizado por email:", updated_contact);
			}
			return;
		}
	} else {
		const id = GenerateContactId(contact.phone);
		const existing_contact = await GetContact(id);
		if (existing_contact) {
			if (do_update) {
				const updated_contact = await UpdateContact(id, contact);
				console.log("Contacto actualizado por celular:", updated_contact);
			}
			return;
		}
	}
	const new_contact = await CreateContact(contact);
	if (new_contact) console.log("Nuevo contacto creado:", new_contact);
}

async function HandleNewContact(contact, do_update) {
	try {
		await CreateIfNew(contact, do_update);
	} catch (error) {
		if (error.message === "INVALID_TOKEN") {
			console.log("Generando nuevo token");
			const token = await UpdateAccessToken();
			SetAccessToken(token);
			await CreateIfNew(contact, do_update);
		}
	}
}

async function FetchContact(phone, email) {
	if (email) {
		const contact = await GetContact(email);
		if (contact) return contact;
	}
	const id = GenerateContactId(phone);
	const contact = await GetContact(id);
	if (contact) return contact;
	return null;
}

async function GetContactRD(req, res) {
	const email = req.query.email;
	const phone = req.query.phone;
	try {
		const contact = await FetchContact(phone, email);
		if (contact) return res.status(200).json(contact);
	} catch (error) {
		if (error.message === "INVALID_TOKEN") {
			console.log("Generando nuevo token");
			const token = await UpdateAccessToken();
			SetAccessToken(token);
			const contact = await FetchContact(phone, email);
			if (contact) return res.status(200).json(contact);
		}
	}
	return res.status(404).send("Contact not found");
}

async function OnNewContact(req, res) {
	const message = req.body;
	if (message.event === "contact_created") {
		const contact = {
			name: message.name,
			email: message.email,
			phone: message.phone_number
		}
		console.log("[contact_created]", contact);
		await HandleNewContact(contact, false);

		const contact_id = contact.email || GenerateContactId(contact.phone);
		try {
			await SendEvent(contact_id, "chatwoot-contacto-nuevo");
		} catch (error) {
			if (error.message === "INVALID_TOKEN") {
				console.log("Generando nuevo token");
				const token = await UpdateAccessToken();
				SetAccessToken(token);
				await SendEvent(contact_id, "chatwoot-contacto-nuevo");
			}
		}
	}
	return res.status(200).send("Event received");
}

async function RegisterContact(req, res) {
	const contact = req.body;
	await HandleNewContact(contact, true);

	const contact_id = contact.email || GenerateContactId(contact.phone);
	try {
		await SendEvent(contact_id, "registro-portal");
	} catch (error) {
		if (error.message === "INVALID_TOKEN") {
			console.log("Generando nuevo token");
			const token = await UpdateAccessToken();
			SetAccessToken(token);
			await SendEvent(contact_id, "registro-portal");
		}
	}
	return res.status(200).send("Event received");
}

async function GetFunnel(email, phone) {
	const id = email || GenerateContactId(phone);
	try {
		const response = await rdstation.get(`/platform/contacts/email:${encodeURIComponent(id)}/funnels/default`);
		return response.data;
	} catch (error) {
		if (error.response && error.response.status === 401) throw new Error("INVALID_TOKEN");
		if (error.response && error.response.status === 404) return null;
		console.error("Error al obtener funnel", error.message);
		return null;
	}
}

async function GetFunnelRD(req, res) {
	const email = req.query.email;
	const phone = req.query.phone;
	try {
		const funnel = await GetFunnel(email, phone);
		if (funnel) return res.status(200).json(funnel);
	} catch (error) {
		if (error.message === "INVALID_TOKEN") {
			console.log("Generando nuevo token");
			const token = await UpdateAccessToken();
			SetAccessToken(token);
			const funnel = await GetFunnel(email, phone);
			if (funnel) return res.status(200).json(funnel);
		}
	}
	return res.status(404).send("Funnel not found");
}

async function GetEvents(uuid, eventType) {
	try {
		const response = await rdstation.get(`/platform/contacts/${uuid}/events?event_type=${eventType}&order=created_at:desc&page=1`);
		return response.data;
	} catch (error) {
		if (error.response && error.response.status === 401) throw new Error("INVALID_TOKEN");
		if (error.response && error.response.status === 404) return null;
		console.error("Error al obtener eventos", error.message);
		return null;
	}
}

async function GetCrmContactByEmail(email) {
	try {
		const response = await crmStation.get("/contacts", { params: { email } });
		if (response.data.total > 0) return response.data.contacts[0];
	} catch (error) {
		console.error("Error al obtener contacto en CRM", error.message);
	}
	return null;
}

async function GetCrmDeal(dealId) {
	try {
		const response = await crmStation.get(`/deals/${dealId}`);
		return response.data;
	} catch (error) {
		console.error("Error al obtener deal en CRM", error.message, dealId);
		return null;
	}
}

async function GetCrmActivities(dealId) {
	try {
		const response = await crmStation.get("/activities", { params: { deal_id: dealId, limit: 200 } });
		return response.data.activities || [];
	} catch (error) {
		console.error("Error al obtener actividades en CRM", error.message);
		return [];
	}
}

function crmStageName(stageId) {
	return DEAL_STAGES[stageId] || stageId;
}

// Timeline del CRM: negocios (creación, etapas, cierre) + anotaciones
async function FetchCrmTimeline(email, phone) {
	const contact = await GetCrmContactByEmail(email || GenerateContactId(phone));
	if (!contact || !Array.isArray(contact.deals)) return [];
	const events = [];
	for (const dealRef of contact.deals) {
		const deal = await GetCrmDeal(dealRef.id);
		if (!deal) continue;

		events.push({
			event_type: "CRM",
			event_identifier: "Negocio creado en RD Station CRM",
			event_timestamp: deal.created_at
		});

		if (Array.isArray(deal.deal_stage_histories)) {
			for (const h of deal.deal_stage_histories) {
				if (!h.start_date) continue;
				events.push({
					event_type: "CRM",
					event_identifier: `Cambió su etapa en el embudo a ${crmStageName(h.deal_stage_id)}`,
					event_timestamp: h.start_date
				});
			}
		}

		if (deal.win === true) {
			events.push({ event_type: "CRM", event_identifier: "Negocio ganado (oportunidad ganada)", event_timestamp: deal.updated_at });
		} else if (deal.win === false) {
			events.push({ event_type: "CRM", event_identifier: "Negocio perdido (oportunidad perdida)", event_timestamp: deal.updated_at });
		}

		const activities = await GetCrmActivities(deal.id);
		for (const a of activities) {
			if (!a.date) continue;
			events.push({
				event_type: "CRM",
				event_identifier: `Anotación: ${a.text || ""}`,
				event_timestamp: a.date
			});
		}
	}
	return events;
}

async function FetchEvents(email, phone) {
	const contact = await FetchContact(phone, email);
	if (!contact) return null;
	const [conversions, opportunities, crmEvents] = await Promise.all([
		GetEvents(contact.uuid, "CONVERSION"),
		GetEvents(contact.uuid, "OPPORTUNITY"),
		FetchCrmTimeline(email, phone)
	]);
	return [...(conversions || []), ...(opportunities || []), ...(crmEvents || [])].sort(
		(a, b) => new Date(b.event_timestamp) - new Date(a.event_timestamp)
	);
}

async function GetEventsRD(req, res) {
	const email = req.query.email;
	const phone = req.query.phone;
	try {
		const events = await FetchEvents(email, phone);
		if (events) return res.status(200).json(events);
	} catch (error) {
		if (error.message === "INVALID_TOKEN") {
			console.log("Generando nuevo token");
			const token = await UpdateAccessToken();
			SetAccessToken(token);
			const events = await FetchEvents(email, phone);
			if (events) return res.status(200).json(events);
		}
	}
	return res.status(404).send("Events not found");
}

async function UpdateContactExtended(email, contactData) {
	try {
		const response = await rdstation.patch(`/platform/contacts/email:${encodeURIComponent(email)}`, contactData);
		return response.data;
	} catch (error) {
		if (error.response && error.response.status === 401) throw new Error("INVALID_TOKEN");
		console.error("Error al actualizar contacto", email, JSON.stringify(contactData), error.message);
		return null;
	}
}

async function UpdateContactRD(req, res) {
	const contact = req.body;
	const email = contact.email || GenerateContactId(contact.phone || contact.mobile_phone);
	const contactData = { ...Object.fromEntries(Object.entries(contact).filter(([key]) => !["email", "phone"].includes(key))) };
	try {
		const updated_contact = await UpdateContactExtended(email, contactData);
		if (updated_contact) return res.status(200).json(updated_contact);
	} catch (error) {
		if (error.message === "INVALID_TOKEN") {
			console.log("Generando nuevo token");
			const token = await UpdateAccessToken();
			SetAccessToken(token);
			const updated_contact = await UpdateContactExtended(email, contactData);
			if (updated_contact) return res.status(200).json(updated_contact);
		}
	}
	return res.status(400).send("Error updating contact");
}

export { OnNewContact, GetContactRD, UpdateContactRD, RegisterContact, GetFunnelRD, GetEventsRD };

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

const rdstation = axios.create({
	baseURL: RDSTATION_URL,
	headers: {
		"Content-Type": "application/json"
	}
});

function SetAccessToken(token) {
	rdstation.defaults.headers["Authorization"] = `Bearer ${token}`;
}

// ─── Campos de la cuenta RD Station (whitelist dinámica con caché) ──────
// GET /platform/contacts/fields devuelve los campos REALES de la cuenta.
// Se cachea en memoria por unos minutos para no golpear la API en cada update.
const FIELDS_CACHE_TTL = 10 * 60 * 1000; // 10 minutos
let rdFieldsCache = null;
let rdFieldsCacheAt = 0;

// Campos que RD devuelve en GET pero NO acepta en PATCH (solo lectura / no editables).
const RD_READONLY_FIELDS = ["links", "uuid", "legal_bases", "tags"];

/**
 * Obtiene (con caché) los api_identifier de campos aceptados por la cuenta RD.
 * @returns {Promise<Set<string>|null>} Set de identificadores o null si no se pudo obtener.
 */
async function getRdEditableFields(retry = true) {
	const now = Date.now();
	if (rdFieldsCache && now - rdFieldsCacheAt < FIELDS_CACHE_TTL) {
		return rdFieldsCache;
	}
	try {
		const response = await rdstation.get("/platform/contacts/fields", {
			params: { page_size: 200 }
		});
		const identifiers = (response.data?.fields || []).map(f => f.api_identifier);
		rdFieldsCache = new Set(identifiers);
		rdFieldsCacheAt = now;
		return rdFieldsCache;
	} catch (error) {
		if (retry && error.response?.status === 401) {
			console.log("Token vencido al obtener campos de RD - refrescando");
			const token = await UpdateAccessToken();
			if (token) SetAccessToken(token);
			return getRdEditableFields(false);
		}
		console.error("Error obteniendo campos de RD Station:", error.message);
		return null;
	}
}

/**
 * Limpia un payload de contacto antes de enviarlo a RD Station:
 *  - Si se puede obtener la whitelist real de la cuenta, conserva SOLO los campos que existen
 *    (así ningún campo editable de la UI se pierde) y descarta readonly/no existentes.
 *  - Si no se puede obtener (fallback), descarta al menos los campos readonly conocidos.
 *
 * @param {Object} contactData - Body del request a limpiar
 * @returns {Promise<Object>} Payload limpio
 */
async function sanitizeContactPayload(contactData) {
	const entries = Object.entries(contactData).filter(([key]) => !RD_READONLY_FIELDS.includes(key));

	const fields = await getRdEditableFields();
	if (!fields) {
		// Fallback: sin whitelist, solo descartamos readonly conocidos.
		return Object.fromEntries(entries);
	}

	return Object.fromEntries(entries.filter(([key]) => fields.has(key)));
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

// Resuelve el nombre de una etapa desde TODOS los embudos del CRM (con caché corta).
let crmStagesCache = null;
let crmStagesCacheAt = 0;

async function crmStageName(stageId) {
	if (!crmStagesCache || Date.now() - crmStagesCacheAt > 10 * 60 * 1000) {
		try {
			const response = await crmStation.get("/deal_pipelines", { params: { limit: 200 } });
			crmStagesCache = {};
			(response.data || []).forEach(p =>
				(p.deal_stages || []).forEach(s => {
					crmStagesCache[s.id] = s.name;
				})
			);
			crmStagesCacheAt = Date.now();
		} catch (error) {
			console.error("Error obteniendo etapas del CRM", error.message);
			return stageId;
		}
	}
	return crmStagesCache[stageId] || stageId;
}

// Timeline del CRM: negocios (creación, etapas, cierre) + anotaciones.
// Solo se muestran los deals del embudo de trabajo (Agendamiento demo);
// los demás embudos (Onboarding, Post-Venta) se manejarán aparte.
const CRM_PIPELINE_NAME = "Agendamiento demo";

async function FetchCrmTimeline(email, phone) {
	const contact = await GetCrmContactByEmail(email || GenerateContactId(phone));
	if (!contact || !Array.isArray(contact.deals)) return [];
	const events = [];
	for (const dealRef of contact.deals) {
		const deal = await GetCrmDeal(dealRef.id);
		if (!deal) continue;
		// Solo deals del embudo de trabajo
		if (deal.deal_pipeline?.name !== CRM_PIPELINE_NAME) continue;

		events.push({
			event_type: "CRM",
			event_identifier: "Negocio creado en RD Station CRM",
			event_timestamp: deal.created_at
		});

		if (Array.isArray(deal.deal_stage_histories)) {
			let lastStageId = null;
			for (const h of deal.deal_stage_histories) {
				if (!h.start_date) continue;
				// RD a veces duplica la entrada de la etapa al crearla (7 ms de diferencia):
				// se omite la entrada consecutiva con la misma etapa
				if (h.deal_stage_id === lastStageId) continue;
				lastStageId = h.deal_stage_id;
				events.push({
					event_type: "CRM",
					event_identifier: `Cambió su etapa en el embudo a ${await crmStageName(h.deal_stage_id)}`,
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
				event_identifier: `Anotación: ${cleanAnnotationText(a.text)}`,
				event_timestamp: a.date
			});
		}
	}
	return events;
}

// Limpia el texto de las anotaciones del CRM: repara mojibake, quita la
// referencia a la IA y normaliza el texto del lead scoring.
function cleanAnnotationText(text) {
	let s = String(text || "");
	// Reparar mojibake (UTF-8 leído como Latin-1): "anotaciÃ³n" → "anotación"
	if (s.includes("Ã") || s.includes("Â")) {
		try {
			s = Buffer.from(s, "latin1").toString("utf8");
		} catch {
			// se deja como está si no se puede reparar
		}
	}
	// Quitar la referencia a la IA
	s = s.replace(/\.\s*Esta anotaci[oó]n se gener[oó] con la ayuda de inteligencia artificial\.?\s*$/i, "");
	// Normalizar el texto del lead scoring
	s = s.replace(/Oportunidad creada a partir de lead Scoring/i, "Oportunidad creada a partir del lead scoring");
	return s.trim();
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
		const err = new Error("RD_UPDATE_ERROR");
		err.status = error.response?.status || 500;
		err.detail = error.response?.data || error.message;
		throw err;
	}
}

async function UpdateContactRD(req, res) {
	const contact = req.body;
	const email = contact.email || GenerateContactId(contact.phone || contact.mobile_phone);
	// Quitar identificadores usados para resolver el contacto (email/phone) y
	// limpiar el payload con whitelist de campos reales de la cuenta RD.
	const contactData = await sanitizeContactPayload(
		Object.fromEntries(Object.entries(contact).filter(([key]) => !["email", "phone"].includes(key)))
	);
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
		if (error.message === "RD_UPDATE_ERROR") {
			console.error("Error actualizando contacto en RD Station:", JSON.stringify(error.detail || {}), "status:", error.status);
			return res.status(error.status || 400).json({
				error: "Error updating contact in RD Station",
				detail: error.detail
			});
		}
	}
	return res.status(400).send("Error updating contact");
}

export { OnNewContact, GetContactRD, UpdateContactRD, RegisterContact, GetFunnelRD, GetEventsRD };

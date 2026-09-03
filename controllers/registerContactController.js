import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const RDSTATION_URL = process.env.RDSTATION_URL;
const RDSTATION_CLIENT_ID = process.env.RDSTATION_CLIENT_ID;
const RDSTATION_CLIENT_SECRET = process.env.RDSTATION_CLIENT_SECRET;
const RDSTATION_REFRESH_TOKEN = process.env.RDSTATION_REFRESH_TOKEN;
const RDSTATION_CRM_URL = process.env.RDSTATION_CRM_URL || "https://crm.rdstation.com";
const RDSTATION_USER_TOKEN = process.env.RDSTATION_USER_TOKEN;

const CHATWOOT_URL = process.env.CHATWOOT_URL || "https://contact-center.5vsa59.easypanel.host";
const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || 2;
const CHATWOOT_API_TOKEN = process.env.API_ACCESS_TOKEN;

const chatwoot = axios.create({
	baseURL: `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}`,
	headers: {
		"Content-Type": "application/json",
		"api_access_token": CHATWOOT_API_TOKEN
	}
});

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
let rdFieldsCache = null; // Map<api_identifier, presentation_type>
let rdFieldsCacheAt = 0;

// Campos que RD devuelve en GET pero NO acepta en PATCH (solo lectura / no editables).
const RD_READONLY_FIELDS = ["links", "uuid", "legal_bases", "tags"];

// Tipos de campo que NO aceptan string vacío (RD responde MUST_BE_VALID_OPTION / etc.)
const RD_OPTION_TYPES = new Set(["COMBO_BOX", "RADIO_BUTTON", "CHECK_BOX"]);

/**
 * Obtiene (con caché) los campos aceptados por la cuenta RD.
 * @returns {Promise<Map<string,string>|null>} Map<api_identifier, presentation_type> o null.
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
		const fieldsMap = new Map();
		(response.data?.fields || []).forEach(f => {
			if (f.api_identifier) fieldsMap.set(f.api_identifier, f.presentation_type || "");
		});
		rdFieldsCache = fieldsMap;
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
 *  - Descarta readonly / campos que no existen en la cuenta (whitelist dinámica).
 *  - Si el campo es de tipo opción (COMBO_BOX/RADIO_BUTTON/CHECK_BOX), descarta valores vacíos,
 *    porque RD rechaza "" en esos campos (MUST_BE_VALID_OPTION).
 *  - Si no se puede obtener la whitelist (fallback), descarta readonly conocidos y vacios
 *    en campos cuyo nombre empiece con cf_ls_ o cf_enc_ (opciones de encuesta).
 *
 * @param {Object} contactData - Body del request a limpiar
 * @returns {Promise<Object>} Payload limpio
 */
async function sanitizeContactPayload(contactData) {
	const entries = Object.entries(contactData).filter(([key]) => !RD_READONLY_FIELDS.includes(key));

	const fields = await getRdEditableFields();
	if (!fields) {
		// Fallback: sin whitelist, descartamos readonly y vacíos en los campos LS/encuesta de opción.
		return Object.fromEntries(
			entries.filter(([key, value]) => {
				if (value === undefined || value === null) return false;
				if (String(value).trim() === "" && /^cf_(ls_|enc_)/.test(key)) return false;
				return true;
			})
		);
	}

	return Object.fromEntries(
		entries.filter(([key, value]) => {
			if (!fields.has(key)) return false;
			if (value === undefined || value === null) return false;
			const type = fields.get(key) || "";
			if (RD_OPTION_TYPES.has(type) && String(value).trim() === "") return false;
			return true;
		})
	);
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

// ─── Sincronización con Chatwoot ──────────────────────────────────────────
// La edición desde la página "Contacto" actualiza RD Station; este bloque
// refleja los mismos cambios en el contacto equivalente de Chatwoot (si existe).

// Campos editables de la página y cómo se escriben en Chatwoot (raíz / custom_attributes).
const NORMALIZE_YES = value => ["sí", "si", "yes", "true", "1"].includes(String(value || "").toLowerCase()) ? "Sí" : "No";

/** Busca un contacto en Chatwoot por email (o fallback por teléfono). */
async function findChatwootContactByEmailOrPhone(email, phone) {
	if (!email && !phone) return null;
	try {
		const q = email || String(phone).replace(/\D/g, "");
		const response = await chatwoot.get("/contacts/search", { params: { q } });
		const contacts = response.data?.payload || [];
		if (contacts.length === 0) return null;

		// Priorizar coincidencia exacta de email si hay varios
		if (email && contacts.length > 1) {
			const exact = contacts.find(c => c.email?.toLowerCase() === String(email).toLowerCase());
			if (exact) return exact;
		}
		return contacts[0];
	} catch (error) {
		console.error("Error buscando contacto en Chatwoot:", error.message);
		return null;
	}
}

/**
 * Arma el payload para actualizar un contacto de Chatwoot a partir de los datos
 * editados en RD (contactData). Respeta protecciones: no degrada tiene_ichef /
 * es_cliente de "Sí", y stage no retrocede (comparando con el contacto actual).
 */
function buildChatwootUpdatePayload(rdContactData, currentChatwootContact) {
	const currentAttrs = currentChatwootContact?.custom_attributes || {};
	const name = rdContactData.name || currentChatwootContact?.name || "";
	const nameParts = String(name).split(" ").filter(Boolean);
	const firstname = nameParts[0] || currentAttrs.firstname || "";
	const lastname = nameParts.slice(1).join(" ") || currentAttrs.lastname || "";

	const payload = {};
	if (name) payload.name = name;
	if (rdContactData.email && rdContactData.email !== currentChatwootContact?.email) {
		payload.email = rdContactData.email;
	}
	if (rdContactData.mobile_phone) {
		const digits = String(rdContactData.mobile_phone).replace(/\D/g, "");
		if (digits) payload.phone_number = `+${digits}`;
	}

	const attrs = {};
	// Identidad
	if (firstname) attrs.firstname = firstname;
	if (lastname) attrs.lastname = lastname;
	if (rdContactData.mobile_phone) attrs.mobile_phone = rdContactData.mobile_phone;
	if (rdContactData.personal_phone) attrs.phone = rdContactData.personal_phone;
	if (rdContactData.country) attrs.country = rdContactData.country;
	if (rdContactData.state) attrs.state = rdContactData.state;
	if (rdContactData.city) attrs.city = rdContactData.city;
	if (rdContactData.cf_address1) attrs.address = rdContactData.cf_address1;
	if (rdContactData.cf_address2) attrs.address2 = rdContactData.cf_address2;
	if (rdContactData.cf_numero_puerta) attrs.numero_puerta = rdContactData.cf_numero_puerta;
	if (rdContactData.cf_zip) attrs.zip = rdContactData.cf_zip;

	// Identificación
	if (rdContactData.cf_cedula) attrs.cedula = rdContactData.cf_cedula;
	if (rdContactData.cf_rut) attrs.rut = rdContactData.cf_rut;

	// Redes sociales
	if (rdContactData.cf_instagram) attrs.instagram = rdContactData.cf_instagram;
	if (rdContactData.cf_facebook) attrs.facebook = rdContactData.cf_facebook;
	if (rdContactData.cf_linkedin) attrs.linkedin = rdContactData.cf_linkedin;
	if (rdContactData.cf_twitter) attrs.twitter = rdContactData.cf_twitter;

	// Stage / estado comercial
	if (rdContactData.cf_stage) {
		// Protección: stage nunca retrocede
		const oldStage = currentAttrs.stage || "";
		const level = s => ({ lead: 0, marketingqualifiedlead: 1, mql: 1, salesqualifiedlead: 2, sql: 2, opportunity: 3, oportunidad: 3, customer: 4, cliente: 4 })[String(s).toLowerCase()];
		const oldLv = level(oldStage);
		const newLv = level(rdContactData.cf_stage);
		if (oldLv === undefined || (newLv !== undefined && newLv >= oldLv)) {
			attrs.stage = rdContactData.cf_stage;
		}
	}

	// tiene_ichef (con protección: no degradar de "Sí")
	if (rdContactData.cf_tiene_ichef) {
		const newVal = NORMALIZE_YES(rdContactData.cf_tiene_ichef);
		if (currentAttrs.tiene_ichef !== "Sí" || newVal === "Sí") {
			attrs.tiene_ichef = newVal;
		}
	}
	// es_cliente derivado de la etapa
	if (attrs.stage && ["customer", "cliente"].includes(String(attrs.stage).toLowerCase())) {
		attrs.es_cliente = "Sí";
	}

	// Encuestas LS (se guardan como texto plano en Chatwoot, igual que en RD)
	const LS_TO_CHATWOOT = {
		cf_ls_seguis_algun_tipo_de_alimentacion: "ls_seguis_algun_tipo_de_alimentacion",
		cf_ls_que_suele_pasar_mas_seguido_en_tu_casa: "ls_que_suele_pasar_mas_seguido_en_tu_casa",
		cf_ls_con_que_frecuencia_comes_comida_casera: "ls_con_que_frecuencia_comes_comida_casera",
		cf_ls_para_cuantas_personas_cocinas_habitualmente: "ls_para_cuantas_personas_cocinas_habitualmente",
		cf_ls_cual_describe_mejor_tu_rutina: "ls_cual_describe_mejor_tu_rutina",
		cf_ls_con_que_frecuencia_cocinas: "ls_con_que_frecuencia_cocinas",
		cf_ls_cual_de_estas_frases_te_representa_mejor: "ls_cual_de_estas_frases_te_representa_mejor"
	};
	for (const [rdKey, cwKey] of Object.entries(LS_TO_CHATWOOT)) {
		if (rdContactData[rdKey]) attrs[cwKey] = rdContactData[rdKey];
	}

	if (Object.keys(attrs).length > 0) {
		payload.custom_attributes = { ...(currentChatwootContact?.custom_attributes || {}), ...attrs };
	}
	return payload;
}

/**
 * Sincroniza los datos editados a Chatwoot (si el contacto existe).
 * No crea contactos; solo actualiza. Nunca lanza (se loguea y se reporta).
 */
async function syncRdContactToChatwoot(email, rdContactData) {
	try {
		const phone = rdContactData.mobile_phone || rdContactData.personal_phone || null;
		const chatwootContact = await findChatwootContactByEmailOrPhone(email, phone);

		if (!chatwootContact || !chatwootContact.id) {
			console.log(`[update-contact] Contacto no encontrado en Chatwoot (email=${email}) - no se crea, solo RD Station`);
			return { synced: false, reason: "not_found_in_chatwoot" };
		}

		const payload = buildChatwootUpdatePayload(rdContactData, chatwootContact);
		if (Object.keys(payload).length === 0) {
			return { synced: false, reason: "no_changes" };
		}

		await chatwoot.put(`/contacts/${chatwootContact.id}`, payload);
		console.log(`[update-contact] Contacto Chatwoot ${chatwootContact.id} actualizado desde RD (email=${email})`);
		return { synced: true, contactId: chatwootContact.id };
	} catch (error) {
		console.error("[update-contact] Error sincronizando a Chatwoot:", error.message);
		return { synced: false, reason: "error", error: error.message };
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
		if (updated_contact) {
			// Reflejar también en Chatwoot (no bloqueante: si falla, se loguea)
			const chatwootSync = await syncRdContactToChatwoot(email, contactData);
			return res.status(200).json({ ...updated_contact, chatwootSync });
		}
	} catch (error) {
		if (error.message === "INVALID_TOKEN") {
			console.log("Generando nuevo token");
			const token = await UpdateAccessToken();
			SetAccessToken(token);
			const updated_contact = await UpdateContactExtended(email, contactData);
			if (updated_contact) {
				const chatwootSync = await syncRdContactToChatwoot(email, contactData);
				return res.status(200).json({ ...updated_contact, chatwootSync });
			}
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

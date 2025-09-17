import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const RDSTATION_URL = process.env.RDSTATION_URL;
const RDSTATION_CLIENT_ID = process.env.RDSTATION_CLIENT_ID;
const RDSTATION_CLIENT_SECRET = process.env.RDSTATION_CLIENT_SECRET;
const RDSTATION_REFRESH_TOKEN = process.env.RDSTATION_REFRESH_TOKEN;

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
	return encodeURIComponent(`${phone.replace(/\D/g, "")}@email.com`);
}

async function GetContact(email) {
	try {
		const response = await rdstation.get(`/platform/contacts/email:${email}`);
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
		cf_id_equipo: contact.serial,
		//cf_username: contact.username,
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

async function UpdateContact(email, contact) {
	const contactData = {
		name: contact.name,
		mobile_phone: contact.phone.replace(/\D/g, ""),
		cf_id_equipo: contact.serial,
		//cf_username: contact.username,
		cf_tiene_ichef: contact.serial ? "Sí" : "No"
	};
	try {
		const response = await rdstation.patch(`/platform/contacts/email:${email}`, contactData);
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
	}
	const id = GenerateContactId(contact.phone);
	const existing_contact = await GetContact(id);
	if (existing_contact) {
		if (do_update) {
			const updated_contact = await UpdateContact(id, contact);
			console.log("Contacto actualizado por celular:", updated_contact);
		}
		return;
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

async function OnNewContact(req, res) {
	const message = req.body;
	if (message.event === "automation_event.conversation_created") {
		const contact = message.meta.sender;
		HandleNewContact(contact, false); // do not await
	}
	return res.status(200).send("Event received");
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

async function RegisterContact(req, res) {
	const contact = req.body;
	HandleNewContact(contact, true); // do not await
	return res.status(200).send("Event received");
}

export { OnNewContact, GetContactRD, RegisterContact };

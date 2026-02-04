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

function GenerateContactId(phone) {
	if (!phone) return null;
	return `${phone.replace(/\D/g, "")}@email.com`;
}

async function UpdateAccessToken() {
	const credentials = {
		client_id: RDSTATION_CLIENT_ID,
		client_secret: RDSTATION_CLIENT_SECRET,
		refresh_token: RDSTATION_REFRESH_TOKEN
	};
	try {
		const response = await rdstation.post("/auth/token", credentials);
		//return response.data.access_token;
		const token = response.data.access_token;
		SetAccessToken(token);
	} catch (error) {
		console.error("Error al actualizar token", error.message);
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

async function CreateContact(contactData) {
	try {
		const response = await rdstation.post("/platform/contacts", contactData);
		return response.data;
	} catch (error) {
		if (error.response && error.response.status === 401) throw new Error("INVALID_TOKEN");
		console.error("Error al crear contacto", contactData, error.message, error.response.data);
		return null;
	}
}

async function UpdateContact(email, contactData) {
	try {
		const response = await rdstation.patch(`/platform/contacts/email:${encodeURIComponent(email)}`, contactData);
		return response.data;
	} catch (error) {
		if (error.response && error.response.status === 401) throw new Error("INVALID_TOKEN");
		console.error("Error al actualizar contacto", email, JSON.stringify(contactData), error.message, error.response.data);
		return null;
	}
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

async function ObtenerCupon(referente, referido) {
	const body = {
		nombre_lover: referente.name,
		celular_lover: referente.mobile_phone,
		nombre_referido: referido.name,
		celular_referido: referido.mobile_phone
	};
	const response = await axios.post("https://ichef.com.uy", body);
	return response.data.codigo_descuento;
}

async function GenerarEnlaceCompra(cupon) {
	return `https://ichef.com.uy/finalizar-compra/?add-to-cart=20513&coupon_code=${cupon}`;
}

async function ObtenerReferidos(req, res) {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	const email = req.query.email;
	try {
		if (!email) return res.status(200).send({ cf_referidos: [] });
		const contact = await GetContact(email);
		if (contact) {
			const referidos = JSON.parse(contact.cf_referidos || "[]");
			return res.status(200).json(referidos);
		}
	} catch (error) {
		if (error.message === "INVALID_TOKEN") {
			await UpdateAccessToken();

			const contact = await GetContact(email);
			if (contact) {
				const referidos = JSON.parse(contact.cf_referidos || "[]");
				return res.status(200).json(referidos);
			}
		}
	}
	return res.status(400).send("Error al obtener referidos");
}

function getCurrentDateTime() {
	const formatter = new Intl.DateTimeFormat("es-UY", {
		timeZone: "America/Montevideo",
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false
	});
	return formatter.format(new Date());
}

function RemoveIDs(contact) {
	return { ...Object.fromEntries(Object.entries(contact).filter(([key]) => !["uuid", "email", "links"].includes(key))) };
}

async function AgregarReferidoLogic(body) {
	const { email, nombre_referido, celular_referido } = body;
	if (!email || !nombre_referido || !celular_referido)
		return [400, { message: "Faltan datos" }];
	let referente = await GetContact(email);
	if (!referente)
		return [400, { message: "No se encontró el referente" }];

	const emailReferido = GenerateContactId(celular_referido);
	const newContactData = {
		name: nombre_referido,
		email: emailReferido,
		mobile_phone: celular_referido,
		cf_referido_por: `${referente.name} (${referente.mobile_phone})`
	};
	let referido = await GetContact(emailReferido);
	if (!referido) {
		referido = await CreateContact(newContactData);
	} else {
		referido = await UpdateContact(emailReferido, RemoveIDs(newContactData));
	}
	if (!referido)
		return [400, { message: "No se pudo crear el referido" }];

	await SendEvent(emailReferido, "referido-portal");
	const cupon = await ObtenerCupon(referente, referido);
	referido.cupon_referido = cupon;
	referido.enlace_compra = GenerarEnlaceCompra(cupon);

	const referidoData = {
		name: nombre_referido,
		phone: celular_referido,
		date: getCurrentDateTime(),
		coupon: cupon,
		//link: referido.enlace_compra
	};
	const referidos = JSON.parse(referente.cf_referidos || "[]");
	referidos.push(referidoData);
	referente.cf_referidos = JSON.stringify(referidos);
	referente = await UpdateContact(email, { cf_referidos: referente.cf_referidos });

	if (!referente)
		return [400, { message: "No se pudo actualizar el referente" }];
	console.log("Referente actualizado:", referente.cf_referidos);

	return [200, referido];
}

async function AgregarReferido(req, res) {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	try {
		const [status, referido] = await AgregarReferidoLogic(req.body);
		return res.status(status).json(referido);
	} catch (error) {
		if (error.message === "INVALID_TOKEN") {
			await UpdateAccessToken();
			const [status, referido] = await AgregarReferidoLogic(req.body);
			return res.status(status).json(referido);
		}
	}
	return res.status(400).send("No se pudo agregar el referido");
}

export { ObtenerReferidos, AgregarReferido };

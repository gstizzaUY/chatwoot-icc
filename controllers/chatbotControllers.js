import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const chatwoot_url = process.env.CHATWOOT_URL;
const api_access_token = process.env.API_ACCESS_TOKEN;
const SAILBOT_API_URL = process.env.SAILBOT_API_URL;
const SAILBOT_AUTH = process.env.SAILBOT_AUTH;

const CHATWOOT_URL_PREFIX = `${chatwoot_url}/api/v1/accounts/2`;

const chatwoot = axios.create({
	baseURL: CHATWOOT_URL_PREFIX,
	headers: {
		"Content-Type": "application/json",
		api_access_token: api_access_token
	}
});

const sailbot = axios.create({
	baseURL: SAILBOT_API_URL,
	headers: {
		"Content-Type": "application/json",
		Authorization: `Basic ${SAILBOT_AUTH}`
	}
});

async function FetchInboxes() {
	try {
		const response = await chatwoot.get("/inboxes");
		return response.data.payload;
	} catch (error) {
		console.error("Error al obtener bandejas de entrada", error.message);
		return null;
	}
}

const INBOX_REVERSE_CACHE = {};

async function GetWppInboxPhoneNumberId(inboxId) {
	if (!INBOX_REVERSE_CACHE[inboxId]) {
		const inboxes = await FetchInboxes();
		const inbox = inboxes.find(
			inbox =>
				inbox.channel_type === "Channel::Whatsapp" &&
				inbox.provider === "whatsapp_cloud" &&
				inbox.id === inboxId
		);
		INBOX_REVERSE_CACHE[inboxId] = inbox.provider_config.phone_number_id;
	}
	return INBOX_REVERSE_CACHE[inboxId];
}

let ID_USER_CACHE = null;

async function GetUserId() {
	try {
		if (!ID_USER_CACHE) {
			const response = await sailbot.post("users/login", {});
			ID_USER_CACHE = response.data.user.idUser;
		}
		return ID_USER_CACHE;
	} catch (error) {
		console.error("Error al obtener el id de usuario", error.message);
		return null;
	}
}

async function GetContactOpenConversation(phoneNumberId, contactPhone) {
	try {
		const response = await sailbot.get(
			`contacts/conversation?externalId=${phoneNumberId}&contactPhone=${contactPhone}`
		);
		return response.data;
	} catch (error) {
		console.error("Error al obtener las conversaciones abiertas", error.message);
		return null;
	}
}

async function DisableBot(idConversation, idSession, idUser) {
	try {
		await sailbot.put(`conversations/${idConversation}/sessions/${idSession}/assign-from-bot/${idUser}`);
	} catch (error) {
		console.error("Error al desactivar el bot", error.message);
	}
}

async function CloseConversation(idConversation, idSession) {
	try {
		await sailbot.put(`conversations/${idConversation}/sessions/${idSession}/mark-resolved?typification=0`); // TODO: fix api
	} catch (error) {
		console.error("Error al cerrar la conversación", error.message);
	}
}

// Desactivar el bot cuando un agente responde
async function HandleOutgoingWppMessage(message) {
	if (
		message.event === "automation_event.message_created" &&
		message.labels.some(label => label === "bot_activo") &&
		message.messages.length > 0 &&
		!message.messages[0].private
	) {
		const msg = message.messages[0];
		console.log("Mensaje saliente", msg.private ? "privado" : "publico", msg.content);

		const inboxId = message.contact_inbox.inbox_id;
		const contactPhone = message.contact_inbox.source_id;
		const phoneNumberId = await GetWppInboxPhoneNumberId(inboxId);
		const userId = await GetUserId();
		const conversation = await GetContactOpenConversation(phoneNumberId, contactPhone);
		if (conversation) {
			const { idConversation, session } = conversation;
			const { idSession } = session;
			await DisableBot(idConversation, idSession, userId);
			console.log("Bot desactivado", idConversation, idSession);
		} else console.warn("No se encontró la conversación", phoneNumberId, contactPhone);
	}
}

// Cuando la conversacion se resuelve, cerrar la sesion del bot
async function HandleSolvedWppConversation(message) {
	if (message.event === "automation_event.conversation_updated" && message.status === "resolved") {
		console.log("Conversación resuelta", message.id, message.status);

		const inboxId = message.contact_inbox.inbox_id;
		const contactPhone = message.contact_inbox.source_id;
		const phoneNumberId = await GetWppInboxPhoneNumberId(inboxId);
		const conversation = await GetContactOpenConversation(phoneNumberId, contactPhone);
		if (conversation) {
			const { idConversation, session } = conversation;
			const { idSession } = session;
			await CloseConversation(idConversation, idSession);
			console.log("Conversación cerrada", idConversation, idSession);
		} else console.warn("No se encontró la conversación", phoneNumberId, contactPhone);
	}
}

async function OnOutgoingWppMessage(req, res) {
	const message = req.body;
	HandleOutgoingWppMessage(message); // do not await
	return res.status(200).send("Event received");
}

async function OnSolvedWppConversation(req, res) {
	const message = req.body;
	HandleSolvedWppConversation(message); // do not await
	return res.status(200).send("Event received");
}

export { OnOutgoingWppMessage, OnSolvedWppConversation };

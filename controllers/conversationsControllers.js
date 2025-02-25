import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const chatwoot_url = process.env.CHATWOOT_URL;
const api_access_token = process.env.API_ACCESS_TOKEN;

const CHATWOOT_URL_PREFIX = `${chatwoot_url}/api/v1/accounts/2`;

const chatwoot = axios.create({
	baseURL: CHATWOOT_URL_PREFIX,
	headers: {
		"Content-Type": "application/json",
		api_access_token: api_access_token
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

const INBOX_CACHE = {};

async function GetWppInboxId(phoneNumberId) {
	if (!INBOX_CACHE[phoneNumberId]) {
		const inboxes = await FetchInboxes();
		const inbox = inboxes.find(
			inbox =>
				inbox.channel_type === "Channel::Whatsapp" &&
				inbox.provider === "whatsapp_cloud" &&
				inbox.provider_config &&
				inbox.provider_config.phone_number_id === phoneNumberId
		);
		INBOX_CACHE[phoneNumberId] = inbox.id;
	}
	return INBOX_CACHE[phoneNumberId];
}

async function GetContactId(contact) {
	const buildPayloadItem = (key, value) => {
		if (!value) return null;
		return {
			attribute_key: key,
			filter_operator: "equal_to",
			values: [value],
			query_operator: "OR"
		};
	};

	const payload = {
		payload: [
			{ id: contact.id, key: "identifier" },
			{ id: contact.email, key: "email" },
			{ id: contact.phone, key: "phone_number" }
		]
			.map(item => buildPayloadItem(item.key, item.id))
			.filter(Boolean)
			.map((item, index, array) => ({
				...item,
				query_operator: index === array.length - 1 ? null : "OR"
			}))
	};

	try {
		const response = await chatwoot.post("/contacts/filter", payload);
		if (response.data.meta.count > 0) {
			return response.data.payload[0].id;
		}
	} catch (error) {
		console.error("Error al obtener contacto", contact, error.message);
		return null;
	}
}

async function GetLastConversationId(contactId, inboxId) {
	try {
		const response = await chatwoot.get(`/contacts/${contactId}/conversations`);
		const conversations = response.data.payload;
		const conversation = conversations.find(
			conversation => conversation.meta.channel === "Channel::Whatsapp" && conversation.inbox_id === inboxId
		);
		if (conversation) return conversation.id;
		console.warn("No se encontro la conversacion", contactId, inboxId);
		return null;
	} catch (error) {
		console.error("Error al obtener conversaciones", contactId, inboxId, error.message);
		return null;
	}
}

async function SendMessage(conversationId, content) {
	const privateMessage = {
		message_type: "outgoing",
		private: true,
		content
	};
	try {
		const response = await chatwoot.post(`/conversations/${conversationId}/messages`, privateMessage);
		return response.data;
	} catch (error) {
		console.error("Error al enviar mensaje", privateMessage, error.message);
		return null;
	}
}

async function ChangeConversationStatus(conversationId, status) {
	try {
		const response = await chatwoot.post(`/conversations/${conversationId}/toggle_status`, {
			status
		});
		return response.data;
	} catch (error) {
		console.error("Error al abrir conversacion", error.message);
		return null;
	}
}

async function Getlabels(conversationId) {
	try {
		const response = await chatwoot.get(`/conversations/${conversationId}/labels`);
		return response.data.payload;
	} catch (error) {
		console.error("Error al obtener etiquetas", error.message);
		return null;
	}
}

async function SetLabels(conversationId, labels) {
	try {
		const response = await chatwoot.post(`/conversations/${conversationId}/labels`, {
			labels
		});
		return response.data;
	} catch (error) {
		console.error("Error al agregar etiquetas", error.message);
		return null;
	}
}

const TAGS_MAPPING = {
	Comercial: "comercial",
	Demo: "demo",
	"Portal de Recetas": "portal_recetas",
	"Soporte Técnico": "soporte_tecnico"
};

// Agregar mensajes enviados por el bot
async function ProcessOutgoingMessage(message) {
	const phoneNumberId = message.phone_number_id;
	const inboxId = await GetWppInboxId(phoneNumberId);

	const contactPhone = message.contact_phone;
	const contact = { phone: contactPhone };
	const contactId = await GetContactId(contact);

	const conversationId = await GetLastConversationId(contactId, inboxId);
	if (conversationId) {
		const BOT_ACTIVE = "bot_activo";
		let labels = await Getlabels(conversationId);
		if (message.in_bot) {
			if (!labels.some(label => label.name === BOT_ACTIVE)) labels.push(BOT_ACTIVE);
		} else labels = labels.filter(label => label !== BOT_ACTIVE);

		const tags = message.tags || [];
		for (const tag of tags) {
			const label = TAGS_MAPPING[tag];
			if (label && !labels.some(label => label.name === label)) labels.push(label);
		}
		await SetLabels(conversationId, labels);

		const messageContent = message.attachment_url
			? `${message.attachment_url}\n${message.body || ""}`
			: message.body;
		await SendMessage(conversationId, messageContent);

		if (!message.in_bot) await ChangeConversationStatus(conversationId, "open");
	}
}

/*
{
	phone_number_id: string,
	contact_phone: string,
	body: string,
	attachment_url: string,
	agent: string,
	in_bot: boolean,
	tags: [string]
}
*/
async function NotifyOutgoingMessage(req, res) {
	const message = req.body;
	ProcessOutgoingMessage(message); // do not await
	return res.status(200).send("Event received");
}

export { NotifyOutgoingMessage };

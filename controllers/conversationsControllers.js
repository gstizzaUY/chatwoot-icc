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
		//console.warn("No se encontro la conversacion", contactId, inboxId);
		return null;
	} catch (error) {
		console.error("Error al obtener conversaciones", contactId, inboxId, error.message);
		return null;
	}
}

async function GetConversationMessages(conversationId) {
	try {
		const response = await chatwoot.get(`/conversations/${conversationId}/messages`);
		return response.data.payload;
	} catch (error) {
		console.error("Error al obtener mensajes de la conversación", conversationId, error.message);
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
		return response.data.payload;
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

// Estados: open, pending, resolved
async function CreateConversation(contactId, inboxId, contactPhone, messageContent) {
	const conversation = {
		inbox_id: inboxId,
		source_id: contactPhone,
		contact_id: contactId,
		status: "resolved",
		message: {
			content: messageContent
		}
	};
	try {
		const response = await chatwoot.post("/conversations", conversation);
		return response.data.id;
	} catch (error) {
		console.error("Error al crear conversación", error.message);
		return null;
	}
}

async function AsignConversationToAgent(conversationId, agentEmailPrefix) {
	try {
		const response = await chatwoot.get("/agents");
		const agents = response.data;
		const agent = agents.find(agent => agent.email.startsWith(agentEmailPrefix));
		if (!agent) {
			console.error("Error al obtener agente con email", agentEmailPrefix);
			return;
		}
		await chatwoot.post(`/conversations/${conversationId}/assignments`, {
			assignee_id: agent.id
		});
	} catch (error) {
		console.error("Error al asignar conversación", conversationId, error.message);
	}
}

async function AsignConversationToTeam(conversationId, teamName) {
	try {
		const response = await chatwoot.get("/teams");
		const teams = response.data;
		const team = teams.find(team => team.name === teamName);
		if (!team) {
			console.error("Error al obtener equipo con nombre", teamName);
			return;
		}
		await chatwoot.post(`/conversations/${conversationId}/assignments`, {
			team_id: team.id
		});
	} catch (error) {
		console.error("Error al asignar conversación", conversationId, error.message);
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

	if (!contactId) {
		console.error("Error al obtener contacto con telefono:", contactPhone);
		console.info(message);
		return;
	}

	let messageContent = message.attachment_url || "";
	if (message.body) messageContent += messageContent ? `\n${message.body}` : message.body;
	if (message.agent !== "Chatbot") messageContent += `\n\n[${message.agent}]`;

	const conversationId = await GetLastConversationId(contactId, inboxId);
	if (!conversationId) {
		const newConversationId = await CreateConversation(contactId, inboxId, contactPhone, messageContent);
		console.log(`Conversación ${newConversationId} creada.`);
		return;
	}

	if (messageContent.includes("derivamos con un asesor")) message.in_bot = false;

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

	await SendMessage(conversationId, messageContent);

	if (message.is_hsm) {
		await ChangeConversationStatus(conversationId, "resolved");
		console.log(`Conversación ${conversationId} resuelta.`);
	} else if (message.in_bot) {
		await ChangeConversationStatus(conversationId, "pending");
		console.log(`Conversación ${conversationId} pendiente.`);
	} else {
		await ChangeConversationStatus(conversationId, "open");
		console.log(`Conversación ${conversationId} abierta.`);

		const messages = await GetConversationMessages(conversationId);
		for (let i = messages.length - 1; i >= 0; i--) {
			const message = messages[i];
			if (!message.sender?.phone_number) { // Mensaje saliente
				continue;
			}
			if (message.content.includes("Quiero más info sobre el iChef Robot")) {
				await AsignConversationToAgent(conversationId, "ncardozo");
				console.log(`Conversación ${conversationId} asignada, contacto inactivo.`);
				break;
			} else {
				await AsignConversationToTeam(conversationId, "ventas");
				console.log(`Conversación ${conversationId} asignada.`);
				break; // El contacto interactuo con el bot
			}
		}
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
	is_hsm: boolean,
	tags: [string]
}
*/
async function NotifyOutgoingMessage(req, res) {
	const message = req.body;
	ProcessOutgoingMessage(message); // do not await
	return res.status(200).send("Event received");
}

export { NotifyOutgoingMessage };

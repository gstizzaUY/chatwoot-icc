import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const chatwoot_url = process.env.CHATWOOT_URL;
const api_access_token = process.env.API_ACCESS_TOKEN;
const CHATWOOT_URL_PREFIX = `${chatwoot_url}/api/v1/accounts/1`;

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
			{ value: contact.id.toString(), key: "identifier" },
			{ value: contact.email, key: "email" },
			{ value: contact.phone, key: "phone_number" }
		]
			.map(item => buildPayloadItem(item.key, item.value))
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
		return null;
	} catch (error) {
		//console.error("Error al obtener contacto", payload, error.message);
		return null;
	}
}

async function CreateContact(contact) {
	const contactData = {
		identifier: contact.id,
		name: contact.name,
		email: contact.email,
		phone_number: contact.phone
	};
	try {
		const response = await chatwoot.post("/contacts", contactData);
		return response.data.payload.contact.id;
	} catch (error) {
		console.error("Error al crear contacto", contactData, error.message);
		return null;
	}
}

async function GetLastConversationId(contactId, inboxId) {
	try {
		const response = await chatwoot.get(`/contacts/${contactId}/conversations`);
		const conversations = response.data.payload;
		const conversation = conversations.find(conversation => conversation.inbox_id === inboxId);
		if (conversation) return conversation.id;
		return null;
	} catch (error) {
		console.error("Error al obtener conversaciones", contactId, inboxId, error.message);
		return null;
	}
}

async function CreateConversation(contactId, inboxId, contactPhone, messageContent) {
	const conversation = {
		inbox_id: inboxId,
		source_id: contactPhone,
		contact_id: contactId,
		status: "open",
		message: {
			message_type: "outgoing",
			private: true,
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

async function AddPrivateMessage(conversationId, content) {
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

/*
{
	"id": "3",
	"email": "dgutierrez@cns.com.uy",
	"phone": "",
	"name": "Daniel Gutierrez",
	"message": "Se aprobó la solicitud de partes del sevicio 12345"
}
*/
async function SendCustomMessage(req, res) {
	const inboxes = await FetchInboxes();
	const inbox = inboxes.find(inbox => inbox.channel_type === "Channel::Api" && inbox.name === "Solicitud Partes");
	if (!inbox) return res.status(404).send("Inbox not found");

	const body = req.body;
	let contactId = await GetContactId(body);
	if (!contactId) {
		const newContactId = await CreateContact(body);
		if (!newContactId) {
			console.error("Failed to create contact for", body);
			return res.status(500).send("Failed to create contact");
		}
		console.log("New contact for", body.id, "created with ID:", newContactId);
		contactId = newContactId;
	}

	const inboxId = inbox.id;
	const contactPhoneOrId = body.phone || body.id;
	const messageContent = body.message;
	const conversationId = await GetLastConversationId(contactId, inboxId);
	if (!conversationId) {
		const newConversationId = await CreateConversation(contactId, inboxId, contactPhoneOrId, messageContent);
		if (!newConversationId) {
			console.error("Failed to create conversation for contact ID:", contactId);
			return res.status(500).send("Failed to create conversation");
		}
		return res.status(200).send({
			conversationId: newConversationId
		});
	}
	const message = await AddPrivateMessage(conversationId, messageContent);
	if (!message) {
		console.error("Failed to add message to conversation ID:", conversationId);
		return res.status(500).send("Failed to add message");
	}
	return res.status(200).send(message);
}

export { SendCustomMessage };

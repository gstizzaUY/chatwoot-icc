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
		api_access_token: api_access_token,
	},
});

async function UpdateContactIdentifier(contactId, newIdentifier) {
	const contact = {
		identifier: newIdentifier,
	};
	try {
		const response = await chatwoot.put(`/contacts/${contactId}`, contact);
		return response.data;
	} catch (error) {
		console.error("Error al actualizar contacto", error.message);
		return null;
	}
}

async function GetConversationsFromInbox(inbox_id, page) {
	const conversation = {
		payload: [
			{
				attribute_key: "inbox_id",
				filter_operator: "equal_to",
				values: [inbox_id],
			},
		],
	};
	try {
		const response = await chatwoot.post(`/conversations/filter?page=${page}`, conversation);
		return response.data.payload;
	} catch (error) {
		console.error("Error al obtener conversaciones", error.message);
		return null;
	}
}

async function main() {
	let page = 1;
	let conversations = [];
	const INBOX_ID = 32;
	do {
		console.log(`Procesando página ${page}`);
		conversations = await GetConversationsFromInbox(INBOX_ID, page);
		for (const conversation of conversations) {
			const contactId = conversation.meta.sender.id;
			const contactIdentifier = conversation.meta.sender.identifier;
			const contactPhone = conversation.meta.sender.phone_number.replace("+", "");
			const newIdentifier = contactPhone + "@s.whatsapp.net";
			if (contactIdentifier !== newIdentifier) {
				const updatedContact = await UpdateContactIdentifier(contactId, newIdentifier);
				if (updatedContact) console.log(`Contacto ${contactId} / ${contactPhone} actualizado`);
			}
		}
		page++;
	} while (conversations.length > 0);
}

main();

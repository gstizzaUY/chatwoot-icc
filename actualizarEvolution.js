import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const chatwoot_url = process.env.CHATWOOT_URL;
const api_access_token = process.env.API_ACCESS_TOKEN;

const CHATWOOT_URL_PREFIX = `${chatwoot_url}/api/v1/accounts/2`;
const INBOX_ID = 32;

const chatwoot = axios.create({
	baseURL: CHATWOOT_URL_PREFIX,
	headers: {
		"Content-Type": "application/json",
		api_access_token: api_access_token,
	},
});

async function UpdateContact(contactId, phone) {
	const contact = {
		identifier: phone + "@s.whatsapp.net",
	};
	try {
		const response = await chatwoot.put(`/contacts/${contactId}`, contact);
		return response.data;
	} catch (error) {
		console.error("Error al actualizar contacto", error.message);
		return null;
	}
}

async function GetConversations(page) {
	const conversation = {
		payload: [
			{
				attribute_key: "inbox_id",
				filter_operator: "equal_to",
				values: [INBOX_ID],
			},
		],
	};
	try {
		const response = await chatwoot.post(
			`/conversations/filter?page=${page}`,
			conversation
		);
		return response.data.payload;
	} catch (error) {
		console.error("Error al obtener conversaciones", error.message);
		return null;
	}
}

async function main() {
	let page = 1;
	let conversations = [];
	do {
		console.log(`Procesando página ${page}`);
		conversations = await GetConversations(page);
		for (const conversation of conversations) {
			//const conversationId = conversation.id;
			const contactId = conversation.meta.sender.id;
			const contactIdentifier = conversation.meta.sender.identifier;
			const contactPhone = conversation.meta.sender.phone_number.replace("+", "");
			if (contactIdentifier !== contactPhone + "@s.whatsapp.net") {
				const updatedContact = await UpdateContact(contactId, contactPhone);
				if (updatedContact)
					console.log(`Contacto ${contactId} / ${contactPhone} actualizado`);
			}
		}
		page++;
	} while (conversations.length > 0);
}

main();

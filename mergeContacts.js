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

async function ListContacts(page) {
	try {
		const response = await chatwoot.get(`/contacts?page=${page}`);
		return response.data.payload;
	} catch (error) {
		console.error(`Failed to list contacts on page ${page}`, error.message);
		return null;
	}
}

async function GetContactByPhone(phone) {
	try {
		const response = await chatwoot.post("/contacts/filter",
			{
				payload: [
					{
						attribute_key: "phone_number",
						filter_operator: "equal_to",
						values: [
							phone
						]
					}
				]
			});
		return response.data.payload[0] || null;
	} catch (error) {
		console.error(`Failed to get contact by phone ${phone}`, error.message);
		return null;
	}
}

async function MergeContacts(base, mergee) {
	try {
		const response = await chatwoot.post(`actions/contact_merge`, {
			base_contact_id: base,
			mergee_contact_id: mergee
		});
		return response.data.payload;
	} catch (error) {
		console.error(`Failed to merge contacts ${base} and ${mergee}`, error.message);
		return null;
	}
}

async function updateAllContacts() {
	let page = 0;
	let contacts = [];
	do {
		console.log(`Processing page #${page}`);
		contacts = await ListContacts(page);
		for (const contact of contacts) {
			// Tech contacts don't have a listed phone
			if (!contact.phone_number)
				continue;

			if (contact.phone_number.startsWith("+5980")) {
				const fixedPhone = "598" + contact.phone_number.slice(5);
				const originalContact = await GetContactByPhone(fixedPhone);
				if (originalContact) {
					console.log(`Merging contact ${contact.id} into ${originalContact.id}`);
					const mergedContact = await MergeContacts(originalContact.id, contact.id);
					if (mergedContact) {
						console.log(`Contacts merged: ${mergedContact.id}`);
					}
				} else
					console.log(`No contact found for phone ${fixedPhone}`);
				//return;
			}
		}
		page++;
	} while (contacts.length > 0);
	console.log("Done.");
}

await updateAllContacts();

#!/usr/bin/env node
/**
 * Re-sincroniza las etiquetas de conversaciones de Chatwoot a partir del estado
 * ACTUAL del contacto (custom_attributes.stage/cf_stage, tiene_ichef) según el
 * LABEL_SOURCE vigente en el entorno (o el override --source).
 *
 * Agrega la etiqueta operativa `tiene_ichef` cuando el contacto la tiene en "Sí"
 * y repinta las etiquetas de etapa:
 *   - cf_stage  → deriva del stage del contacto (quita lead si ya es customer...).
 *   - lifecycle → consulta el funnel de RD (Lead/Qualified Lead/Client + oportunidad).
 *
 * Uso:
 *   node scripts/resync-contact-labels.js --conversationId=16347 --dry-run
 *   node scripts/resync-contact-labels.js --conversationId=16347
 *   node scripts/resync-contact-labels.js --email=foo@bar.com --dry-run
 *   node scripts/resync-contact-labels.js --contactId=27309
 *   node scripts/resync-contact-labels.js --all-open --dry-run
 *   node scripts/resync-contact-labels.js --source=cf_stage --all-open
 *
 * Flags:
 *   --conversationId  Solo esa conversación.
 *   --email           Conversaciones (abiertas) del contacto con ese email.
 *   --contactId       Conversaciones (abiertas) de ese contacto.
 *   --all-open        Todas las conversaciones abiertas de la cuenta.
 *   --source          Override de LABEL_SOURCE (lifecycle | cf_stage).
 *   --dry-run         Loguea los cambios sin escribir en Chatwoot.
 */
import dotenv from "dotenv";
dotenv.config();
import axios from "axios";
import { fileURLToPath } from "url";
import path from "path";
import { LABEL_SOURCE } from "../src/utils/stage-labels.utils.js";
import { syncConversationLabels } from "../src/utils/sync-labels.utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHATWOOT_URL = process.env.CHATWOOT_URL;
const ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || 2;
const HEADERS = { api_access_token: process.env.API_ACCESS_TOKEN };

function parseArgs() {
	const args = {};
	process.argv.slice(2).forEach(a => {
		if (a.startsWith("--")) {
			const [k, v] = a.slice(2).split("=");
			args[k] = v === undefined ? true : v;
		}
	});
	return args;
}

async function getAllOpenConversations() {
	const all = [];
	let page = 1;
	for (let i = 0; i < 50; i++) {
		const r = await axios.get(`${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations`, {
			headers: HEADERS,
			params: { page, per_page: 100, status: "open" }
		});
		const payload = r.data.data?.payload || [];
		all.push(...payload);
		if (!r.data.data?.meta?.next) break;
		page += 1;
	}
	return all;
}

async function getConversationById(conversationId) {
	try {
		const r = await axios.get(`${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations/${conversationId}`, {
			headers: HEADERS
		});
		return r.data;
	} catch (error) {
		console.error(`Error obteniendo conversación ${conversationId}:`, error.message);
		return null;
	}
}

async function getContactById(contactId) {
	try {
		const r = await axios.get(`${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}/contacts/${contactId}`, {
			headers: HEADERS
		});
		return r.data.payload;
	} catch (error) {
		console.error(`Error obteniendo contacto ${contactId}:`, error.message);
		return null;
	}
}

async function findContactByEmail(email) {
	const payload = {
		payload: [
			{
				attribute_key: "email",
				filter_operator: "equal_to",
				values: [email],
				query_operator: null
			}
		]
	};
	try {
		const r = await axios.post(`${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}/contacts/filter`, payload, {
			headers: HEADERS
		});
		if (r.data.meta.count > 0) return r.data.payload[0];
		return null;
	} catch (error) {
		console.error("Error buscando contacto por email:", error.message);
		return null;
	}
}

async function resyncOne(conversation, source, dryRun) {
	const sender = conversation?.meta?.sender || {};
	const contactId = sender.id || conversation.contact_id;

	if (!contactId) {
		console.log(`- Conversación ${conversation.id}: sin contact_id en sender, se omite`);
		return { processed: 0, changed: 0 };
	}

	const contact = await getContactById(contactId);
	if (!contact) {
		console.log(`- Conversación ${conversation.id}: contacto ${contactId} no encontrado, se omite`);
		return { processed: 0, changed: 0 };
	}

	const result = await syncConversationLabels({
		conversationId: conversation.id,
		contact,
		source,
		dryRun
	});

	return { processed: 1, changed: result?.changed ? 1 : 0 };
}

async function main() {
	const args = parseArgs();
	const source = args.source || LABEL_SOURCE;
	const dryRun = args["dry-run"] === true;

	console.log(`Fuente de etiquetas: ${source} | dry-run: ${dryRun}`);

	const targets = [];

	if (args.conversationId) {
		const conv = await getConversationById(Number(args.conversationId));
		if (conv) targets.push(conv);
	} else if (args.email) {
		const contact = await findContactByEmail(args.email);
		if (!contact) {
			console.log(`Contacto no encontrado para email ${args.email}`);
			return;
		}
		const convs = await getAllOpenConversations();
		targets.push(...convs.filter(c => c.meta?.sender?.email === args.email));
	} else if (args.contactId) {
		const convs = await getAllOpenConversations();
		targets.push(...convs.filter(c => (c.meta?.sender?.id || c.contact_id) === Number(args.contactId)));
	} else if (args["all-open"]) {
		targets.push(...(await getAllOpenConversations()));
	} else {
		console.log("Uso: --conversationId | --email | --contactId | --all-open  (opcional --source / --dry-run)");
		return;
	}

	console.log(`Conversaciones objetivo: ${targets.length}`);

	let processed = 0;
	let changed = 0;
	for (const conv of targets) {
		const res = await resyncOne(conv, source, dryRun);
		processed += res.processed;
		changed += res.changed;
	}

	console.log(`Resumen: ${processed} procesadas | ${changed} con cambios | dry-run=${dryRun}`);
}

await main();

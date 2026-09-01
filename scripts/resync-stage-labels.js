#!/usr/bin/env node
/**
 * Re-sincroniza las etiquetas de etapa de las conversaciones de Chatwoot
 * según la fuente elegida (cf_stage o lifecycle del funnel de RD).
 *
 * Uso:
 *   node scripts/resync-stage-labels.js --source=lifecycle --dry-run
 *   node scripts/resync-stage-labels.js --source=lifecycle --email=ogerwer@ichef.uy
 *   node scripts/resync-stage-labels.js --source=cf_stage
 *   node scripts/resync-stage-labels.js --snapshot           # respaldo de labels actuales
 *
 * --dry-run: loguea los cambios sin escribir.
 * --email:   procesa solo las conversaciones de ese contacto.
 */
import dotenv from "dotenv";
dotenv.config();
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { STAGE_LABELS, getStageLabelsForContact } from "../src/utils/stage-labels.utils.js";

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

async function getAllConversations() {
	const all = [];
	let page = 1;
	for (let i = 0; i < 50; i++) {
		const r = await axios.get(`${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations`, {
			headers: HEADERS,
			params: { page, per_page: 100 }
		});
		const payload = r.data.data?.payload || [];
		all.push(...payload);
		if (!r.data.data?.meta?.next) break;
		page += 1;
	}
	return all;
}

async function snapshot() {
	const convs = await getAllConversations();
	const snap = {};
	convs.forEach(c => {
		const sender = c.meta?.sender || {};
		snap[c.id] = {
			contact_id: sender.id,
			email: sender.email,
			labels: c.labels || []
		};
	});
	const file = path.join(__dirname, "..", "exports", `labels-snapshot-${new Date().toISOString().slice(0, 10)}.json`);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(snap, null, 2));
	console.log(`Snapshot guardado: ${file} (${convs.length} conversaciones)`);
}

async function resync({ source, dryRun, emailFilter }) {
	const convs = await getAllConversations();
	console.log(`Conversaciones: ${convs.length} | fuente: ${source} | dry-run: ${dryRun}`);

	let processed = 0;
	let changed = 0;
	for (const conv of convs) {
		const sender = conv.meta?.sender || {};
		const email = sender.email;
		if (emailFilter && email !== emailFilter) continue;

		if (!email) {
			console.log(`- Conversación ${conv.id}: sin email, se omite (labels sin cambios)`);
			continue;
		}

		// cf_stage del contacto en Chatwoot (si existe)
		const cfStage = sender.custom_attributes?.stage || sender.custom_attributes?.cf_stage || undefined;

		const stageLabels = await getStageLabelsForContact({ email, cfStage, source });
		if (stageLabels === null) {
			console.log(`- Conversación ${conv.id} (${email}): fuente no disponible, labels sin cambios`);
			continue;
		}

		const current = conv.labels || [];
		const next = [
			...current.filter(l => !STAGE_LABELS.includes(l)),
			...stageLabels
		];

		processed++;
		if (JSON.stringify(current.sort()) === JSON.stringify(next.sort())) continue;
		changed++;

		console.log(`- Conversación ${conv.id} (${email}): [${current.join(", ")}] → [${next.join(", ")}]`);

		if (!dryRun) {
			await axios.post(
				`${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations/${conv.id}/labels`,
				{ labels: next },
				{ headers: HEADERS }
			);
		}
	}
	console.log(`Resumen: ${processed} procesadas | ${changed} con cambios | dry-run=${dryRun}`);
}

const args = parseArgs();

if (args.snapshot) {
	await snapshot();
} else {
	const source = args.source || process.env.LABEL_SOURCE || "cf_stage";
	await resync({ source, dryRun: args["dry-run"] === true, emailFilter: args.email });
}
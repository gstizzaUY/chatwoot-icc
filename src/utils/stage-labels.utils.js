import dotenv from "dotenv";
dotenv.config();
import axios from "axios";
import chatwootClient from "../clients/chatwoot.client.js";

// ─── Configuración de origen de etiquetas de etapa ──────────────────
// LABEL_SOURCE=cf_stage   → comportamiento actual (mapea cf_stage del contacto)
// LABEL_SOURCE=lifecycle  → usa lifecycle_stage + opportunity del funnel de RD
// LABEL_SYNC_DRY_RUN=true → loguea los cambios sin escribir en Chatwoot
export const LABEL_SOURCE = (process.env.LABEL_SOURCE || "cf_stage").toLowerCase();
export const LABEL_DRY_RUN = process.env.LABEL_SYNC_DRY_RUN === "true";

// Etiquetas de etapa gestionadas por este sistema (se remueven y re-agregan)
export const STAGE_LABELS = ["lead", "mql", "sql", "oportunidad", "cliente", "lead_calificado"];

// ─── Mapeos ─────────────────────────────────────────────────────────

function lifecycleToLabel(lifecycle) {
	const map = {
		Lead: "lead",
		"Qualified Lead": "lead_calificado",
		Client: "cliente",
		Customer: "cliente"
	};
	return map[lifecycle] || null;
}

function cfStageToLabel(cfStage) {
	const map = {
		lead: "lead",
		marketingQualifiedLead: "mql",
		salesQualifiedLead: "sql",
		opportunity: "oportunidad",
		customer: "cliente"
	};
	return map[cfStage] || null;
}

/**
 * Resuelve las etiquetas de etapa según la fuente.
 * Devuelve:
 *   - Array de labels a aplicar (puede incluir "oportunidad" si hay oportunidad abierta)
 *   - null cuando NO se puede determinar → el llamador NO debe tocar las etiquetas
 */
export function resolveStageLabels({ cfStage, lifecycle, opportunity }, source = LABEL_SOURCE) {
	if (source === "lifecycle") {
		if (!lifecycle) return null;
		const label = lifecycleToLabel(lifecycle);
		if (!label) return null;
		const labels = [label];
		if (opportunity === true) labels.push("oportunidad");
		return labels;
	}

	// Comportamiento actual (cf_stage)
	const label = cfStageToLabel(cfStage);
	return label ? [label] : null;
}

// ─── Funnel de RD Station (con OAuth2 auto-refresh) ─────────────────

const RDSTATION_URL = process.env.RDSTATION_URL || "https://api.rd.services";

let rdAccessToken = null;

async function refreshRdToken() {
	const response = await axios.post(`${RDSTATION_URL}/auth/token`, {
		client_id: process.env.RDSTATION_CLIENT_ID,
		client_secret: process.env.RDSTATION_CLIENT_SECRET,
		refresh_token: process.env.RDSTATION_REFRESH_TOKEN
	});
	rdAccessToken = response.data.access_token;
	return rdAccessToken;
}

async function rdGet(path, retry = true) {
	if (!rdAccessToken) await refreshRdToken();
	try {
		const response = await axios.get(`${RDSTATION_URL}${path}`, {
			headers: { Authorization: `Bearer ${rdAccessToken}` }
		});
		return response.data;
	} catch (error) {
		if (error.response?.status === 401 && retry) {
			await refreshRdToken();
			return rdGet(path, false);
		}
		throw error;
	}
}

async function getContactFunnel(email) {
	if (!email) return null;
	try {
		return await rdGet(`/platform/contacts/email:${encodeURIComponent(email)}/funnels/default`);
	} catch (error) {
		if (error.response?.status === 404) return null;
		console.error("Error al obtener funnel de RD Station:", error.message);
		return null;
	}
}

/**
 * Obtiene las etiquetas de etapa para un contacto según la config.
 * Devuelve null si no se puede determinar (no tocar labels).
 */
export async function getStageLabelsForContact({ email, cfStage, source }) {
	const useSource = source || LABEL_SOURCE;
	if (useSource === "lifecycle") {
		const funnel = await getContactFunnel(email);
		if (!funnel) return null;
		return resolveStageLabels(
			{
				lifecycle: funnel.lifecycle_stage,
				opportunity: funnel.opportunity === true
			},
			useSource
		);
	}
	return resolveStageLabels({ cfStage }, useSource);
}

// Utilidad para logs de dry-run
export function logLabelChange(conversationId, currentLabels, newLabels) {
	if (!LABEL_DRY_RUN) return;
	console.log(
		`[DRY-RUN] Conversación ${conversationId}: ${JSON.stringify(currentLabels)} → ${JSON.stringify(newLabels)}`
	);
}

// Genera el email con el que RD registra contactos sin email (phone@email.com)
function generateContactId(phone) {
	if (!phone) return null;
	return `${String(phone).replace(/\D/g, "")}@email.com`;
}

/**
 * Repinta las etiquetas de etapa de una conversación desde el funnel de RD.
 * Solo actúa con LABEL_SOURCE=lifecycle (en cf_stage el comportamiento actual no cambia).
 *
 * Devuelve:
 *   - { changed, labels, dryRun } cuando se repintó
 *   - null cuando no aplica (fuente cf_stage, sin identificador, funnel inaccesible o sin cambios)
 */
export async function refreshStageLabelsForConversation({ conversationId, email, phone }) {
	if (LABEL_SOURCE !== "lifecycle") return null;

	const rdEmail = email || generateContactId(phone);
	if (!rdEmail) return null;

	const funnel = await getContactFunnel(rdEmail);
	if (!funnel) return null;

	const stageLabels = resolveStageLabels({
		lifecycle: funnel.lifecycle_stage,
		opportunity: funnel.opportunity === true
	});
	if (!stageLabels) return null;

	let current = [];
	try {
		const conv = await chatwootClient.getConversation(conversationId);
		current = conv?.labels || [];
	} catch (error) {
		console.warn(`⚠️ No se pudo obtener conversación ${conversationId} para repintar etiquetas:`, error.message);
		return null;
	}

	const next = [...current.filter(l => !STAGE_LABELS.includes(l)), ...stageLabels];
	const same =
		current.length === next.length &&
		[...current].sort().join("|") === [...next].sort().join("|");
	if (same) return { changed: false, labels: next };

	if (LABEL_DRY_RUN) {
		logLabelChange(conversationId, current, next);
		return { changed: false, labels: next, dryRun: true };
	}

	await chatwootClient.setLabels(conversationId, next);
	return { changed: true, labels: next };
}
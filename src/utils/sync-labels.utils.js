import dotenv from "dotenv";
dotenv.config();
import chatwootClient from "../clients/chatwoot.client.js";
import {
	STAGE_LABELS,
	LABEL_SOURCE,
	LABEL_DRY_RUN,
	resolveStageLabels,
	getContactFunnel
} from "./stage-labels.utils.js";

/**
 * Utilidad de sincronización de etiquetas de CONVERSACIÓN a partir del estado
 * del CONTACTO en Chatwoot. Es agnóstica a la fuente de etiquetas de etapa:
 * respeta `LABEL_SOURCE` del entorno (igual que Resumen/webhook/flujo V1):
 *
 *   - LABEL_SOURCE=lifecycle → consulta el funnel de RD Station por email/phone
 *     (vía refreshStageLabelsForConversation). Si no hay funnel NO toca la etapa.
 *   - LABEL_SOURCE=cf_stage  → deriva la etapa del stage/cf_stage del contacto
 *     y remueve etiquetas de etapa desactualizadas.
 *
 * La etiqueta operativa `tiene_ichef` se gestiona de forma independiente:
 *   - Se AGREGA cuando el contacto tiene custom_attributes.tiene_ichef === "Sí".
 *   - NUNCA se borra (evita regresiones si el atributo no está en "Sí").
 *
 * Las notas internas `[Agente IA]` (etiquetas largas con timestamp) se preservan
 * siempre: solo se recomponen las etiquetas de etapa y las operativas.
 */

/** Etiqueta operativa que refleja que el contacto posee un iChef. */
export const OPERATIONAL_LABEL_TIENE_ICHEF = "tiene_ichef";

/**
 * Resuelve las etiquetas de etapa a aplicar para una conversación según el
 * LABEL_SOURCE vigente.
 *
 * @param {Object} contact - Contacto actual de Chatwoot (getContactById)
 * @param {string} [source] - Fuente override (lifecycle | cf_stage)
 * @returns {Promise<{ stageLabels: string[]|null, refreshFn: string|null }>}
 *   stageLabels: labels de etapa a aplicar (null = no tocar etapa)
 *   refreshFn:   identificador del mecanismo usado (para logging)
 */
export async function resolveConversationStageLabels(contact, source = LABEL_SOURCE) {
	const email = contact?.email || null;
	const phone = contact?.phone_number || null;

	if (source === "lifecycle") {
		// Delegar al repintado desde funnel de RD (mismo mecanismo que webhook/Resumen)
		const rdEmail = email || (phone ? String(phone).replace(/\D/g, "") + "@email.com" : null);
		const funnel = rdEmail ? await getContactFunnel(rdEmail) : null;
		if (!funnel) {
			return { stageLabels: null, refreshFn: null };
		}
		return {
			stageLabels: resolveStageLabels(
				{
					lifecycle: funnel.lifecycle_stage,
					opportunity: funnel.opportunity === true
				},
				"lifecycle"
			),
			refreshFn: "lifecycle"
		};
	}

	// cf_stage (default): deriva del stage/cf_stage del contacto en Chatwoot
	const cfStage =
		contact?.custom_attributes?.stage ||
		contact?.custom_attributes?.cf_stage ||
		undefined;
	const stageLabels = resolveStageLabels({ cfStage }, "cf_stage");
	return { stageLabels, refreshFn: "cf_stage" };
}

/**
 * Aplica las etiquetas operativas (tiene_ichef) a una lista de labels actual.
 * NUNCA remueve la etiqueta tiene_ichef (evita regresiones).
 *
 * @param {Array} currentLabels - Labels actuales de la conversación
 * @param {Object} contact - Contacto de Chatwoot
 * @returns {Array} - Labels actualizadas
 */
export function applyOperationalLabels(currentLabels, contact) {
	const labels = [...currentLabels];
	const tieneIchef = contact?.custom_attributes?.tiene_ichef;

	if (tieneIchef === "Sí" && !labels.includes(OPERATIONAL_LABEL_TIENE_ICHEF)) {
		labels.push(OPERATIONAL_LABEL_TIENE_ICHEF);
	}

	return labels;
}

/**
 * Recalcula y aplica las etiquetas de una conversación a partir del contacto.
 *
 * Preserva etiquetas NO gestionadas (notas [Agente IA], labels manuales, etc.)
 * y solo recompone:
 *   - Etiquetas de etapa (lead/mql/sql/oportunidad/cliente/lead_calificado)
 *     según LABEL_SOURCE.
 *   - Etiqueta operativa `tiene_ichef`.
 *
 * @param {Object} params
 * @param {number} params.conversationId - ID de la conversación en Chatwoot
 * @param {Object} params.contact - Contacto (objeto de getContactById: custom_attributes, email, phone_number)
 * @param {string} [params.source] - Override de LABEL_SOURCE (lifecycle | cf_stage)
 * @param {boolean} [params.dryRun] - Loguea sin escribir
 * @returns {Promise<{ changed: boolean, labels: string[], skipped?: string }>}
 */
export async function syncConversationLabels({ conversationId, contact, source, dryRun }) {
	const useDryRun = dryRun !== undefined ? dryRun : LABEL_DRY_RUN;

	let conv = null;
	let current = [];
	try {
		conv = await chatwootClient.getConversation(conversationId);
		current = conv?.labels || [];
	} catch (error) {
		console.warn(`⚠️ No se pudo obtener conversación ${conversationId}:`, error.message);
		return { changed: false, labels: current, skipped: "no_conversation" };
	}

	// 1. Etapa según LABEL_SOURCE
	const { stageLabels, refreshFn } = await resolveConversationStageLabels(contact, source);

	// Etiquetas preservadas: las que NO son de etapa (notas IA, manuales, etc.)
	let next = current.filter(label => !STAGE_LABELS.includes(label));

	if (stageLabels && stageLabels.length > 0) {
		next = [...next, ...stageLabels];
	}

	// 2. Etiqueta operativa tiene_ichef
	next = applyOperationalLabels(next, contact);

	// 3. Deduplicar conservando orden
	next = [...new Set(next)];

	const same =
		current.length === next.length &&
		[...current].sort().join("|") === [...next].sort().join("|");

	if (same) {
		return { changed: false, labels: next };
	}

	if (useDryRun) {
		console.log(`[DRY-RUN] Conversación ${conversationId}: ${JSON.stringify(current)} → ${JSON.stringify(next)}`);
		return { changed: false, labels: next, dryRun: true, wouldChange: true };
	}

	try {
		await chatwootClient.setLabels(conversationId, next);
		console.log(`🏷️ Conversación ${conversationId} etiquetada (${refreshFn || "source"}) -> ${JSON.stringify(next)}`);
		return { changed: true, labels: next };
	} catch (error) {
		console.warn(`⚠️ No se pudieron actualizar etiquetas de conversación ${conversationId}:`, error.message);
		return { changed: false, labels: next, skipped: "set_labels_error" };
	}
}

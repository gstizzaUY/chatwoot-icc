import axios from "axios";
import dotenv from "dotenv";
import rdStationClient from "../src/clients/rdstation.client.js";
import chatwootClient from "../src/clients/chatwoot.client.js";
import { applyStageLabelsToConversation, resolveStageLabels } from "../src/utils/stage-labels.utils.js";

dotenv.config();

const RDSTATION_CRM_URL = process.env.RDSTATION_CRM_URL;
const RDSTATION_USER_TOKEN = process.env.RDSTATION_USER_TOKEN;

const DEAL_PIPELINE_NAME = "Agendamiento demo";

const rdstation = axios.create({
	baseURL: RDSTATION_CRM_URL,
	params: { token: RDSTATION_USER_TOKEN },
	headers: {
		"Content-Type": "application/json"
	}
});

function GenerateContactId(phone) {
	if (!phone) return null;
	return `${phone.replace(/\D/g, "")}@email.com`;
}

async function GetContactCRM(phone, email) {
	try {
		if (email) {
			const filter = encodeURIComponent(`${email}`);
			const response = await rdstation.get(`/api/v1/contacts?email=${filter}`);
			if (response.data.total > 0) {
				const contacts = response.data.contacts || [];
				// Si hay duplicados con el mismo email, priorizar el que tiene deals (oportunidades)
				return contacts.find(c => (c.deals || []).length > 0) || contacts[0];
			}
		}
		const email2 = GenerateContactId(phone);
		const filter = encodeURIComponent(`${email2}`);
		const response = await rdstation.get(`/api/v1/contacts?email=${filter}`);
		if (response.data.total > 0) {
			const contacts = response.data.contacts || [];
			return contacts.find(c => (c.deals || []).length > 0) || contacts[0];
		}
	} catch (error) {
		console.error("Error al obtener contacto en crm", error.message);
		return null;
	}
	return null;
}

async function FetchOpportunity(phone, email) {
	var contact = await GetContactCRM(phone, email);
	if (!contact) return null;

	for (let i = 0; i < contact.deals.length; i++) {
		const dealId = contact.deals[i].id;
		try {
			const response = await rdstation.get(`/api/v1/deals/${dealId}`);
			contact.deals[i] = response.data;
		} catch (error) {
			console.error("Error al obtener oportunidad en crm", error.message, dealId);
			continue;
		}
	}
	return contact;
}

async function GetOpportunityRD(req, res) {
	const email = req.query.email;
	const phone = req.query.phone;
	const opportunity = await FetchOpportunity(phone, email);
	if (opportunity) return res.status(200).json(opportunity);
	return res.status(404).send("Opportunity not found");
}

async function UpdateOpportunityStage(req, res) {
	const { dealId, stageId, lostReasonId } = req.body;

	var state = null;
	if (stageId === "69176d0ad5402600168336b1") state = true // Ganada
	else if (stageId === "69176d13cd5edb001e64c5d9") state = false // Perdida

	const body = {
		deal_stage_id: stageId,
		deal: {
			win: state,
			deal_lost_reason_id: state === false ? lostReasonId : null,
			deal_lost_note: state === false ? "Oportunidad perdida" : null
		}
	};

	try {
		const response = await rdstation.put(`/api/v1/deals/${dealId}`, body);
		return res.status(200).json(response.data);
	} catch (error) {
		console.error("Error al actualizar etapa de oportunidad en crm", error.message);
		return res.status(500).send("Error al actualizar etapa de oportunidad");
	}
}

async function CreateOpportunity(req, res) {
	const { contact, stageId } = req.body;

	if (!contact?.name || !contact?.email) {
		return res.status(400).json({ success: false, error: "El contacto debe tener nombre y email" });
	}

	// Validar que la etapa exista en el embudo y NO sea terminal (Ganada/Perdida)
	try {
		const pipeline = await GetAgendamientoDemoPipeline();
		const stage = (pipeline?.deal_stages || []).find(s => s.id === stageId);
		if (!stage) {
			return res.status(400).json({
				success: false,
				error: `Etapa inválida para crear oportunidad. Válidas: ${(pipeline?.deal_stages || []).map(s => s.name).join(", ")}`
			});
		}
		if (stage.name === "Cerrada Ganada" || stage.name === "Cerrada Perdida") {
			return res.status(400).json({
				success: false,
				error: "No se puede crear una oportunidad directamente en etapa terminal (Cerrada Ganada/Perdida). Creala en una etapa abierta y cerrala después."
			});
		}
	} catch (error) {
		console.error("Error validando etapa para crear oportunidad", error.message);
		return res.status(500).json({ success: false, error: "Error al validar la etapa" });
	}

	// Regla: la oportunidad siempre debe quedar vinculada a un contacto que exista en RD Marketing.
	// Si el contacto no existe en la plataforma, se crea primero (antes de crear el deal en el CRM).
	try {
		const platformContact = await rdStationClient.getContact(contact.email);
		if (!platformContact) {
			console.log(`Contacto no existe en RD Marketing, creándolo: ${contact.email}`);
			await rdStationClient.createContact({
				name: contact.name,
				email: contact.email,
				mobile_phone: contact.phone ? String(contact.phone).replace(/\D/g, "") : undefined
			});
			console.log(`Contacto creado en RD Marketing: ${contact.email}`);
		}
	} catch (error) {
		console.error("Error asegurando contacto en RD Marketing", error.message);
		return res.status(500).json({
			success: false,
			error: "No se pudo verificar/crear el contacto en RD Marketing: " +
				JSON.stringify(error.response?.data?.errors || error.message)
		});
	}

	const body = {
		campaign: {
			_id: "68cb06c75243470001ea5a30"
		},
		contacts: [
			{
				name: contact.name,
				emails: [
					{
						email: contact.email
					}
				],
				phones: [
					{
						type: "cellphone",
						phone: contact.phone
					}
				]
			}
		],
		deal: {
			name: contact.name,
			deal_stage_id: stageId
		}
	};

	try {
		const response = await rdstation.post("/api/v1/deals", body);
		return res.status(200).json(response.data);
	} catch (error) {
		console.error("Error al crear oportunidad en crm", error.message);
		return res.status(500).send("Error al crear oportunidad");
	}
}

async function GetPipelinesRD(req, res) {
	try {
		const response = await rdstation.get("/api/v1/deal_pipelines", { params: { limit: 200 } });
		const pipelines = (response.data || [])
			.filter(p => p.name === DEAL_PIPELINE_NAME)
			.map(p => ({
				id: p.id,
				name: p.name,
				deal_stages: (p.deal_stages || [])
					.map(s => ({ id: s.id, name: s.name, order: s.order }))
					.sort((a, b) => a.order - b.order)
			}));
		return res.status(200).json(pipelines);
	} catch (error) {
		console.error("Error al obtener pipelines", error.message);
		return res.status(500).send("Error al obtener pipelines");
	}
}

async function GetLostReasonsRD(req, res) {
	try {
		const response = await rdstation.get("/api/v1/deal_lost_reasons", { params: { limit: 200 } });
		const reasons = (response.data?.deal_lost_reasons || []).map(r => ({ id: r._id, name: r.name }));
		return res.status(200).json(reasons);
	} catch (error) {
		console.error("Error al obtener motivos de pérdida", error.message);
		return res.status(500).send("Error al obtener motivos de pérdida");
	}
}

// ─── Endpoint para n8n: actualizar calificación y/o etapa del deal ──

const QUALIFICATION_MAP = {
	lead: "Lead",
	lead_calificado: "Qualified Lead",
	"lead calificado": "Qualified Lead",
	cliente: "Client",
	// valores crudos de RD (por compatibilidad)
	"qualified lead": "Qualified Lead",
	client: "Client"
};

const CLOSE_STAGE_NAMES = ["Cerrada Ganada", "Cerrada Perdida"];

async function GetAgendamientoDemoPipeline() {
	const response = await rdstation.get("/api/v1/deal_pipelines", { params: { limit: 200 } });
	const pipeline = (response.data || []).find(p => p.name === DEAL_PIPELINE_NAME);
	if (!pipeline) return null;
	return {
		id: pipeline.id,
		name: pipeline.name,
		deal_stages: (pipeline.deal_stages || [])
			.map(s => ({ id: s.id, name: s.name, order: s.order }))
			.sort((a, b) => a.order - b.order)
	};
}

async function ResolveLostReasonId(lostReasonName) {
	const response = await rdstation.get("/api/v1/deal_lost_reasons", { params: { limit: 200 } });
	const reason = (response.data?.deal_lost_reasons || []).find(
		r => r.name.toLowerCase() === String(lostReasonName).toLowerCase()
	);
	return reason ? reason._id : null;
}

async function UpdateContactStageApi(req, res) {
	// 1. Autenticación
	if (req.headers["x-export-token"] !== process.env.EXPORT_SECRET) {
		return res.status(401).json({ success: false, error: "Token inválido" });
	}

	const { email, qualification, deal_stage, lost_reason } = req.body || {};

	// 2. Validaciones
	if (!email) {
		return res.status(400).json({ success: false, error: "El campo 'email' es obligatorio" });
	}
	if (!qualification && !deal_stage) {
		return res.status(400).json({
			success: false,
			error: "Nada que actualizar: enviá 'qualification' y/o 'deal_stage'"
		});
	}

	let lifecycleValue = null;
	if (qualification) {
		const norm = String(qualification).toLowerCase().trim();
		lifecycleValue = QUALIFICATION_MAP[norm];
		if (!lifecycleValue) {
			return res.status(400).json({
				success: false,
				error: "Valor inválido para 'qualification'. Válidos: lead, lead_calificado, cliente"
			});
		}
	}

	let targetStage = null; // { id, name }
	if (deal_stage) {
		const pipeline = await GetAgendamientoDemoPipeline();
		if (!pipeline) {
			return res.status(500).json({ success: false, error: "Embudo 'Agendamiento demo' no encontrado" });
		}
		const byId = pipeline.deal_stages.find(s => s.id === deal_stage);
		const byName = pipeline.deal_stages.find(
			s => s.name.toLowerCase() === String(deal_stage).toLowerCase()
		);
		targetStage = byId || byName;
		if (!targetStage) {
			return res.status(400).json({
				success: false,
				error: `Etapa inválida para 'deal_stage'. Válidas: ${pipeline.deal_stages.map(s => s.name).join(", ")}`
			});
		}
		if (targetStage.name === "Cerrada Perdida" && !lost_reason) {
			return res.status(400).json({
				success: false,
				error: "Para 'Cerrada Perdida' el campo 'lost_reason' es obligatorio"
			});
		}
	}

	// 3. Actualizar calificación (funnel)
	let qualificationResult = null;
	if (lifecycleValue) {
		try {
			// RD exige el campo opportunity (no puede ser null): se preserva el valor vigente
			const currentFunnel = await rdStationClient.getFunnel("email", email);
			const opportunity = currentFunnel?.opportunity === true;
			qualificationResult = await rdStationClient.updateFunnel("email", email, {
				lifecycle_stage: lifecycleValue,
				opportunity
			});
		} catch (error) {
			const status = error.response?.status;
			if (status === 404) {
				return res.status(404).json({ success: false, error: "Contacto no encontrado en RD Station" });
			}
			console.error("Error actualizando funnel:", error.message);
			return res.status(500).json({ success: false, error: error.response?.data || error.message });
		}
	}

	// 4. Actualizar etapa del deal
	let dealResult = { updated: false, reason: "not_requested" };
	if (targetStage) {
		try {
			const pipeline = await GetAgendamientoDemoPipeline();
			const contact = await GetContactCRM(null, email);
			if (!contact || !Array.isArray(contact.deals) || contact.deals.length === 0) {
				dealResult = { updated: false, reason: "no_open_deal" };
			} else {
				const openDeals = [];
				for (const dealRef of contact.deals) {
					const dealRes = await rdstation.get(`/api/v1/deals/${dealRef.id}`);
					const deal = dealRes.data;
					// Solo deals abiertos del embudo de trabajo (Agendamiento demo)
					const inPipeline =
						deal.deal_pipeline?.id === pipeline?.id ||
						deal.deal_pipeline?.name === DEAL_PIPELINE_NAME;
					if (deal.win === null && inPipeline) openDeals.push(deal);
				}

				if (openDeals.length === 0) {
					dealResult = { updated: false, reason: "no_open_deal" };
				} else {
					let lostReasonId = null;
					if (targetStage.name === "Cerrada Perdida") {
						lostReasonId = await ResolveLostReasonId(lost_reason);
						if (!lostReasonId) {
							return res.status(400).json({
								success: false,
								error: `Motivo de pérdida inválido: '${lost_reason}'`
							});
						}
					}

					const updatedDeals = [];
					for (const deal of openDeals) {
						const win = targetStage.name === "Cerrada Ganada" ? true :
							targetStage.name === "Cerrada Perdida" ? false : null;
						const body = {
							deal_stage_id: targetStage.id,
							deal: {
								win,
								deal_lost_reason_id: win === false ? lostReasonId : null,
								deal_lost_note: win === false ? "Oportunidad perdida" : null
							}
						};
						await rdstation.put(`/api/v1/deals/${deal.id}`, body);
						updatedDeals.push({ id: deal.id, stage: targetStage.name, win });
					}
					dealResult = { updated: true, deals: updatedDeals };
				}
			}
		} catch (error) {
			console.error("Error actualizando etapa del deal:", error.message);
			dealResult = { updated: false, reason: "error", error: error.response?.data || error.message };
		}
	}

	// 5. Repintar etiquetas de Chatwoot (solo conversaciones open/snoozed)
	let labelsResult = { updated: 0, skipped_resolved: 0, details: [] };
	try {
		const funnel = qualificationResult || (await rdStationClient.getFunnel("email", email));
		const stageLabels = funnel
			? resolveStageLabels({ lifecycle: funnel.lifecycle_stage, opportunity: funnel.opportunity === true })
			: null;

		if (stageLabels) {
			const chatwootContact = await chatwootClient.findContact({ email });
			if (chatwootContact?.id) {
				const conversations = await chatwootClient.getConversationsByContact(chatwootContact.id);
				for (const conv of conversations) {
					const result = await applyStageLabelsToConversation({
						conversationId: conv.id,
						stageLabels,
						allowedStatuses: ["open", "snoozed"]
					});
					if (result?.changed) labelsResult.updated += 1;
					else if (result?.skipped) labelsResult.skipped_resolved += 1;
					labelsResult.details.push({
						conversation_id: conv.id,
						status: conv.status,
						labels: result?.labels || []
					});
				}
			}
		}
	} catch (error) {
		console.warn("⚠️ No se pudieron repintar etiquetas de Chatwoot:", error.message);
	}

	return res.status(200).json({ success: true, qualification: qualificationResult, deal: dealResult, labels: labelsResult });
}

export { GetOpportunityRD, UpdateOpportunityStage, CreateOpportunity, GetPipelinesRD, GetLostReasonsRD, UpdateContactStageApi };

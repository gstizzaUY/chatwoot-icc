import express from "express";
import { NotifyOutgoingMessage } from "../controllers/conversationsControllers.js";
import { OnOutgoingWppMessage, OnSolvedWppConversation } from "../controllers/chatbotControllers.js";
import { OnNewContact, GetContactRD, UpdateContactRD, RegisterContact } from "../controllers/registerContactController.js";
import { GetOpportunityRD, UpdateOpportunityStage, CreateOpportunity } from "../controllers/rdOpportunityController.js";
import { MigrateOpportunity } from "../controllers/migrateOpportunityController.js";

import { ObtenerReferidos, AgregarReferido } from "../controllers/referidosController.js";

const router = express.Router();

router.post("/outgoing-message", NotifyOutgoingMessage); // Bot
router.post("/outgoing-wpp-message", OnOutgoingWppMessage); // Agente
router.post("/new-contact", OnNewContact); // Registrar en RD Station
router.post("/solved-wpp-conversation", OnSolvedWppConversation); // Cerrar conversación
router.get("/get-contact", GetContactRD); // Proxy obtener contacto RD Station
router.get("/get-opportunity", GetOpportunityRD); // Obtener oportunidad RD Station
router.post("/update-contact", UpdateContactRD); // Actualizar contacto RD Station
router.post("/register-contact", RegisterContact); // Registrar usuario iChef
router.post("/update-opportunity-stage", UpdateOpportunityStage); // Actualizar etapa de oportunidad
router.post("/create-opportunity", CreateOpportunity); // Crear oportunidad

router.post("/migrate/:stage", MigrateOpportunity);

router.get("/referidos", ObtenerReferidos); // Obtener referidos de un contacto
router.put("/agregar-referido", AgregarReferido); // Agregar referido a un contacto

export default router;

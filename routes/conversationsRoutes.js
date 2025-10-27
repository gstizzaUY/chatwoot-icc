import express from "express";
import { NotifyOutgoingMessage } from "../controllers/conversationsControllers.js";
import { OnOutgoingWppMessage, OnSolvedWppConversation } from "../controllers/chatbotControllers.js";
import { OnNewContact, GetContactRD, UpdateContactRD, RegisterContact } from "../controllers/registerContactController.js";
import { GetOpportunityRD } from "../controllers/rdOpportunityController.js";

const router = express.Router();

router.post("/outgoing-message", NotifyOutgoingMessage); // Bot
router.post("/outgoing-wpp-message", OnOutgoingWppMessage); // Agente
router.post("/new-contact", OnNewContact); // Registrar en RD Station
router.post("/solved-wpp-conversation", OnSolvedWppConversation); // Cerrar conversación
router.get("/get-contact", GetContactRD); // Proxy obtener contacto RD Station
router.get("/get-opportunity", GetOpportunityRD); // Obtener oportunidad RD Station
router.post("/update-contact", UpdateContactRD); // Actualizar contacto RD Station
router.post("/register-contact", RegisterContact); // Registrar usuario iChef

export default router;

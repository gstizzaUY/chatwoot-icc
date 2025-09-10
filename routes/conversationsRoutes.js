import express from "express";
import { NotifyOutgoingMessage } from "../controllers/conversationsControllers.js";
import { OnOutgoingWppMessage, OnSolvedWppConversation } from "../controllers/chatbotControllers.js";
import { OnNewContact, GetContactRD } from "../controllers/registerContactController.js";

const router = express.Router();

router.post("/outgoing-message", NotifyOutgoingMessage); // Bot
router.post("/outgoing-wpp-message", OnOutgoingWppMessage); // Agente
router.post("/new-contact", OnNewContact); // Registrar en RD Station
router.post("/solved-wpp-conversation", OnSolvedWppConversation); // Cerrar conversación
router.get("/get-contact", GetContactRD); // Proxy obtener contacto RD Station

export default router;

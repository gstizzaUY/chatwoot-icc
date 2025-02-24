import express from "express";
import { NotifyOutgoingMessage } from "../controllers/conversationsControllers.js";
import {
	OnOutgoingWppMessage,
	OnSolvedWppConversation
} from "../controllers/chatbotControllers.js";

const router = express.Router();

router.post("/outgoing-message", NotifyOutgoingMessage); // Bot
router.post("/outgoing-wpp-message", OnOutgoingWppMessage); // Agente
router.post("/solved-wpp-conversation", OnSolvedWppConversation);

export default router;

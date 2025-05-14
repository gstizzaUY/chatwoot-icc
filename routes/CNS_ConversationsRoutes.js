import express from "express";
import { FindConversation, NotifyOutgoingMessage } from "../controllers/CNS_ConversationsControllers.js";
import {
	OnOutgoingWppMessage,
	OnSolvedWppConversation
} from "../controllers/CNS_ChatbotControllers.js";

const router = express.Router();

router.get("/find-conversation", FindConversation); // Bot
router.post("/outgoing-message", NotifyOutgoingMessage); // Bot
router.post("/outgoing-wpp-message", OnOutgoingWppMessage); // Agente
router.post("/solved-wpp-conversation", OnSolvedWppConversation);

export default router;

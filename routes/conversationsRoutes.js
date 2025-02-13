import express from "express";
import { NotifyOutgoingMessage } from "../controllers/conversationsControllers.js";

const router = express.Router();

router.post("/outgoing-message", NotifyOutgoingMessage);

export default router;

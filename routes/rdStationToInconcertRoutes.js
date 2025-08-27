import express from 'express';
import { rdStationToInconcertController } from '../controllers/rdStationToInconcertControllers.js';

const router = express.Router();

router.post('/leads-to-inconcert', rdStationToInconcertController);

export default router;

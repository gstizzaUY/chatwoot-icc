import express from 'express';
import { masterSushi } from '../controllers/rdStationToInconcertControllers.js';

const router = express.Router();

router.post('/masterclass-sushi',  masterSushi);

export default router;

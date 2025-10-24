import express from 'express';
import { masterSushi, demoOnline } from '../controllers/rdStationToInconcertControllers.js';

const router = express.Router();


router.post('/masterclass-sushi', masterSushi);
router.post('/demo-online', demoOnline);

export default router;

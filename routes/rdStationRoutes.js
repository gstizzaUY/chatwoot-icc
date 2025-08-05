import express from 'express';
import { importarContactos } from '../controllers/rdStationControllers.js';

const router = express.Router();



router.post('/importar-contactos', importarContactos);


export default router;
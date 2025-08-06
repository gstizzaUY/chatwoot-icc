import express from 'express';
import { importarContactos, actualizarContacto } from '../controllers/rdStationControllers.js';

const router = express.Router();



router.post('/importar-contactos', importarContactos);
router.post('/actualizar-contacto', actualizarContacto);


export default router;
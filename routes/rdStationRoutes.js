import express from 'express';
import { importarContactos, actualizarContacto, registrarDemo } from '../controllers/rdStationControllers.js';

const router = express.Router();



router.post('/importar-contactos', importarContactos);
router.post('/actualizar-contacto', actualizarContacto);
router.post('/registro-demo', registrarDemo);


export default router;
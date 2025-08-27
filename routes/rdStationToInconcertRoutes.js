import express from 'express';
import { masterSushi } from '../controllers/rdStationToInconcertControllers.js';

const router = express.Router();

// Middleware para logging de todas las requests a esta ruta
router.use((req, res, next) => {
    console.log('=== RUTA rdStationToInconcert ACCEDIDA ===');
    console.log('Método:', req.method);
    console.log('URL completa:', req.originalUrl);
    console.log('Path:', req.path);
    console.log('Timestamp:', new Date().toISOString());
    next();
});

router.post('/masterclass-sushi', masterSushi);

export default router;

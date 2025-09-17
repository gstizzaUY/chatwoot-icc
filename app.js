import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import dotenv from 'dotenv';
import contactsRoutes from './routes/contactsRoutes.js';
import customAtributesRoutes from './routes/customAtributesRoutes.js';
import dealsRoutes from './routes/dealsRoutes.js';
import conversationsRoutes from './routes/conversationsRoutes.js';
import CNS_ConversationsRoutes from './routes/CNS_ConversationsRoutes.js';
import inconcertRoutes from './routes/inconcertRoutes.js';
import rdStationRoutes from './routes/rdStationRoutes.js';
import rdStationToInconcertRoutes from './routes/rdStationToInconcertRoutes.js';

dotenv.config();

console.log('🔄 Iniciando aplicación...');
console.log('🔧 Variables de entorno cargadas');
console.log('📊 Puerto configurado:', process.env.PORT || 4000);

const app = express();
const port = process.env.PORT || 4000;

app.use(morgan('dev'));
app.use(express.json());
app.use(cors());


app.get('/', (req, res) => {
    res.send('API funcionando');
});

// Routes

app.use('/api/contacts', contactsRoutes);
app.use('/api/custom_atributes', customAtributesRoutes);
app.use('/api/deals', dealsRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/api/cns-conversations', CNS_ConversationsRoutes);
app.use('/api/inconcert', inconcertRoutes);

app.use('/api/rd-station', rdStationRoutes);
app.use('/api/rd-to-inconcert', rdStationToInconcertRoutes);

app.listen(port, () => {
    console.log(`Servidor corriendo en puerto ${port}`);
    console.log('✅ Aplicación iniciada correctamente');
});

// Manejo de errores para debug en deploy
process.on('uncaughtException', (error) => {
    console.error('❌ Error no capturado:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promise rechazada:', reason);
    console.error('En promise:', promise);
    process.exit(1);
});

process.on('SIGTERM', () => {
    console.log('🔄 SIGTERM recibido - cerrando aplicación...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🔄 SIGINT recibido - cerrando aplicación...');
    process.exit(0);
});

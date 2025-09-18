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

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
app.use('/api/contacts', contactsRoutes); // Importación masiva de contactos desde inConcert a Chatwoot, Crea Contactos Nuevos desde ICC, Actualiza y Borra Contactos en Chatwoot desde inConcert
app.use('/api/custom_atributes', customAtributesRoutes); // Crea los Atributos Personalizados y los Lista y Borra en Chatwoot
app.use('/api/deals', dealsRoutes); // Desde inConcert a Chatwoot: Importa masivamente las oportunidades, Crea Nuevas Oportunidades, Actualiza Oportunidades en Chatwoot
app.use('/api/conversations', conversationsRoutes);
app.use('/api/cns-conversations', CNS_ConversationsRoutes);
app.use('/api/inconcert', inconcertRoutes); // Rutas de InConcert


app.use('/api/rd-station', rdStationRoutes); // Importación masiva desde InConcert a RD Station, Actualiza Contactos en RD Station, Registra Demos en RD Station
app.use('/api/rd-to-inconcert', rdStationToInconcertRoutes); // Crea los Contactos en inConcert desde RD Station

app.use('/api/actualizacion-firmware', rdStationRoutes); // Rutas de Actualización de Firmware')

app.listen(port, () => {
    console.log(`Servidor corriendo en puerto ${port}`);
    console.log('✅ Aplicación iniciada correctamente');
});

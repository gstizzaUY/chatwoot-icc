import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import dotenv from 'dotenv';
import contactsRoutes from './routes/contactsRoutes.js';
import customAtributesRoutes from './routes/customAtributesRoutes.js';
import dealsRoutes from './routes/dealsRoutes.js';


dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

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

app.listen(port, () => {
    console.log(`Servidor corriendo en puerto ${port}`);
});
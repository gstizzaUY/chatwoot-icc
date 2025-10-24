import express from 'express';
import { createContact, importContacts, filterContacts, updateContact, deleteContact } from '../controllers/contactsControllers.js';

const router = express.Router();

router.post('/import', importContacts); // Importación masiva de contactos desde inConcert a Chatwoot
router.post('/create', createContact); // Crea Contactos Nuevos desde ICC
router.post('/filter', filterContacts); // Filtra Contactos en Chatwoot
router.post('/update', updateContact); // Actualiza Contactos en Chatwoot desde inConcert
router.post('/delete', deleteContact); // Borra Contactos en Chatwoot desde inConcert


export default router;
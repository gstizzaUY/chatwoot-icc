import express from 'express';
import { createContact, importContacts, filterContacts, updateContact, deleteContact } from '../controllers/contactsControllers.js';

const router = express.Router();

router.post('/import', importContacts);
router.post('/create', createContact);
router.post('/filter', filterContacts);
router.post('/update', updateContact);
router.post('/delete', deleteContact);


export default router;
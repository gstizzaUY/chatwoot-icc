import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import rdStationClient from '../clients/rdstation.client.js';

dotenv.config();

const CRM_URL = (process.env.RDSTATION_CRM_URL || 'https://crm.rdstation.com').replace(/\/+$/, '');
const CRM_TOKEN = process.env.RDSTATION_USER_TOKEN;
const RESOURCES_PATH = process.env.RD_AFFILIATE_RESOURCES_PATH
    || path.join(process.cwd(), 'data', 'rd-affiliate-resources.json');

let resourcesCache = null;

function requireCrmConfiguration() {
    if (!CRM_TOKEN) {
        throw new Error('RDSTATION_USER_TOKEN no configurado');
    }
}

function crmClient() {
    requireCrmConfiguration();

    return axios.create({
        baseURL: `${CRM_URL}/api/v1`,
        params: { token: CRM_TOKEN },
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        timeout: 30000,
    });
}

/**
 * IDs de campos/campaña creados en Fase 0.
 * Si el archivo no existe, el servicio falla de forma controlada; nunca
 * inventa IDs ni altera recursos.
 */
export async function getAffiliateResources() {
    if (resourcesCache) {
        return resourcesCache;
    }

    const raw = await fs.readFile(RESOURCES_PATH, 'utf8');
    resourcesCache = JSON.parse(raw);

    return resourcesCache;
}

export async function findMarketingContact(email) {
    if (!email) {
        return null;
    }

    return rdStationClient.getContact(email);
}

/**
 * Busca un contacto en RD CRM por email. Devuelve el contacto con su lista
 * resumida de deals, priorizando el que ya tiene oportunidades.
 */
export async function findCrmContactByEmail(email) {
    if (!email) {
        return null;
    }

    const response = await crmClient().get('/contacts', {
        params: { email },
    });

    const contacts = Array.isArray(response.data?.contacts)
        ? response.data.contacts
        : [];

    if (contacts.length === 0) {
        return null;
    }

    return contacts.find((contact) => (contact.deals || []).length > 0) || contacts[0];
}

/**
 * Busca un contacto en RD CRM por teléfono, usando el mismo email sintético
 * que RD Marketing para contactos sin email.
 */
export async function findCrmContactByPhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) {
        return null;
    }

    return findCrmContactByEmail(`${digits}@email.com`);
}

/**
 * Busca el deal abierto del contacto en el pipeline indicado.
 * No crea nada: es la base de la estrategia de reutilización de la Fase 4.
 */
export async function findOpenCrmDealForContact(contact, pipelineName = 'Agendamiento demo') {
    const deals = Array.isArray(contact?.deals) ? contact.deals : [];

    for (const dealRef of deals) {
        const dealId = dealRef?.id || dealRef?._id;
        if (!dealId) {
            continue;
        }

        const response = await crmClient().get(`/deals/${encodeURIComponent(dealId)}`);
        const deal = response.data;

        if (!deal || deal.win !== null) {
            continue;
        }

        if (pipelineName && deal.deal_pipeline?.name !== pipelineName) {
            continue;
        }

        return deal;
    }

    return null;
}

export async function upsertMarketingContact(contactData, previousEmail = null) {
    return rdStationClient.upsertContact(contactData, previousEmail);
}

export async function sendMarketingConversionEvent(email, identifier, fields = {}) {
    return rdStationClient.sendConversionEvent(email, identifier, fields);
}

export async function createCrmDeal(dealPayload) {
    const response = await crmClient().post('/deals', dealPayload);
    return response.data;
}

export async function updateCrmDeal(dealId, dealPayload) {
    const response = await crmClient().put(`/deals/${encodeURIComponent(dealId)}`, dealPayload);
    return response.data;
}

/**
 * Crea una anotación en un deal de RD CRM.
 *
 * Usa la API v1 de actividades con User Token. El endpoint exacto/payload debe
 * validarse en la fase de integración de oportunidades antes de usarlo en
 * producción.
 */
export async function createCrmDealNote({ dealId, userId, text }) {
    if (!dealId || !userId || !text) {
        throw new Error('dealId, userId y text son obligatorios para la nota RD CRM');
    }

    const response = await crmClient().post('/activities', {
        activity: {
            deal_id: String(dealId),
            user_id: String(userId),
            text: String(text),
        },
    });

    return response.data;
}

export function mapDealCustomFields(resources, values) {
    const fields = resources?.rd_crm?.deal_custom_fields || {};
    const payload = [];

    for (const [resourceKey, value] of Object.entries(values || {})) {
        const field = fields[resourceKey];
        if (!field?.id || value === undefined || value === null || value === '') {
            continue;
        }

        payload.push({
            custom_field_id: field.id,
            value: String(value),
        });
    }

    return payload;
}

export default {
    getAffiliateResources,
    findMarketingContact,
    findCrmContactByEmail,
    findCrmContactByPhone,
    findOpenCrmDealForContact,
    upsertMarketingContact,
    sendMarketingConversionEvent,
    createCrmDeal,
    updateCrmDeal,
    createCrmDealNote,
    mapDealCustomFields,
};

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
    upsertMarketingContact,
    sendMarketingConversionEvent,
    createCrmDeal,
    updateCrmDeal,
    createCrmDealNote,
    mapDealCustomFields,
};

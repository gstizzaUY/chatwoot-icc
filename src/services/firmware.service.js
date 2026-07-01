import axios from 'axios';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import rdStationClient from '../clients/rdstation.client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', '..', 'data');

const ICHEF_API = 'https://www.ichef.uy:8443/ICHEF-WAR/soporte/info';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const VALIDATOR_FILES = {
    cns: 'firmware_validador_cns.json',
    nube: 'firmware_validador_nube.json',
};

const EMAIL_FILES = {
    cns: resolve(DATA_DIR, 'usuarios_validador_cns.json'),
    nube: resolve(DATA_DIR, 'lista_validador_nube_verdes.json'),
};

const ROJO_FILES = {
    cns: resolve(DATA_DIR, 'usuarios_validador_cns_rojos.json'),
    nube: null,
};

// Progress tracking for async operations
const progressState = {};

function getProgress(validator) {
    return progressState[validator] || null;
}

function setProgress(validator, p) {
    progressState[validator] = p;
}

function clearProgress(validator) {
    delete progressState[validator];
}

function loadEmails(validator) {
    const items = [];

    // Cargar verdes
    const verdePath = EMAIL_FILES[validator];
    if (existsSync(verdePath)) {
        const raw = JSON.parse(readFileSync(verdePath, 'utf-8'));
        if (Array.isArray(raw) && raw.length > 0) {
            const key = validator === 'cns' ? 'email' : 'lista_validador_nube';
            const emails = raw[0]?.[key] || [];
            emails.forEach(email => items.push({ email, source: 'verde' }));
        }
    }

    // Cargar rojos (solo CNS por ahora)
    const rojoPath = ROJO_FILES[validator];
    if (rojoPath && existsSync(rojoPath)) {
        const raw = JSON.parse(readFileSync(rojoPath, 'utf-8'));
        const emails = raw?.Email || [];
        emails.forEach(email => items.push({ email, source: 'rojo' }));
    }

    return items;
}

function getResultPath(validator) {
    return resolve(DATA_DIR, VALIDATOR_FILES[validator]);
}

function loadResults(validator) {
    const filePath = getResultPath(validator);
    if (!existsSync(filePath)) return [];
    return JSON.parse(readFileSync(filePath, 'utf-8'));
}

function saveResults(validator, data) {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(getResultPath(validator), JSON.stringify(data, null, 2));
}

async function fetchFirmwareInfo(email) {
    try {
        const response = await axios.get(`${ICHEF_API}?email=${encodeURIComponent(email)}`, {
            httpsAgent,
            timeout: 15000,
        });
        return { email, data: response.data, error: null };
    } catch (error) {
        const status = error.response?.status || '?';
        const msg = error.code === 'ECONNRESET'
            ? 'Connection reset'
            : error.code === 'ETIMEDOUT'
                ? 'Timeout'
                : error.message;
        return { email, data: null, error: `HTTP ${status}: ${msg}` };
    }
}

async function fetchAll(validator, { onProgress } = {}) {
    const items = loadEmails(validator);
    const results = [];
    let success = 0;
    let fail = 0;

    setProgress(validator, { status: 'running', index: 0, total: items.length, email: '', success: 0, fail: 0 });

    for (let i = 0; i < items.length; i++) {
        const { email, source } = items[i];
        const result = await fetchFirmwareInfo(email);
        result.source = source;
        results.push(result);
        if (result.data) success++;
        else fail++;
        const p = { status: 'running', index: i + 1, total: items.length, email, success, fail };
        setProgress(validator, p);
        if (onProgress) onProgress({ index: i + 1, total: items.length, email, ok: !!result.data });
    }

    saveResults(validator, results);
    setProgress(validator, { status: 'done', index: items.length, total: items.length, email: '', success, fail });
    return { results, total: items.length, success, fail };
}

async function fetchSingle(email) {
    return await fetchFirmwareInfo(email);
}

async function refreshSingle(validator, email) {
    const result = await fetchFirmwareInfo(email);
    const results = loadResults(validator);
    const idx = results.findIndex(r => r.email === email);
    if (idx !== -1) {
        result.source = results[idx].source;
        results[idx] = result;
    } else {
        result.source = 'verde';
        results.push(result);
    }
    saveResults(validator, results);
    return result;
}

async function updateRDSingle(email) {
    const result = await fetchFirmwareInfo(email);
    if (!result.data) {
        return { success: false, email, error: result.error || 'No se pudo obtener datos del endpoint' };
    }

    const { robotId, firmwareVersion } = result.data;
    const updateData = {};
    if (robotId) updateData.cf_id_equipo = robotId;
    if (firmwareVersion) updateData.cf_version_firmware = firmwareVersion;

    if (Object.keys(updateData).length === 0) {
        return { success: false, email, error: 'No se obtuvieron robotId ni firmwareVersion' };
    }

    try {
        await rdStationClient.updateContact(email, updateData);
        return { success: true, email, updatedFields: updateData };
    } catch (error) {
        return { success: false, email, error: error.message };
    }
}

async function updateRDAll(validator, { onProgress } = {}) {
    const items = loadEmails(validator).filter(i => i.source === 'verde');
    const results2 = [];
    let success = 0;
    let fail = 0;

    for (let i = 0; i < items.length; i++) {
        const { email } = items[i];
        const rdResult = await updateRDSingle(email);
        results2.push(rdResult);
        if (rdResult.success) success++;
        else fail++;
        if (onProgress) onProgress({ index: i + 1, total: items.length, ...rdResult });
    }

    return { results: results2, total: items.length, success, fail };
}

export default {
    VALIDATOR_FILES,
    loadEmails,
    loadResults,
    saveResults,
    fetchFirmwareInfo,
    fetchAll,
    fetchSingle,
    refreshSingle,
    updateRDSingle,
    updateRDAll,
    getProgress,
    clearProgress,
};

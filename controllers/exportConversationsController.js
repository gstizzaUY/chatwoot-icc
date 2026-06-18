import axios from 'axios';
import dotenv from 'dotenv';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const chatwoot_url = process.env.CHATWOOT_URL;
const api_access_token = process.env.API_ACCESS_TOKEN;
const DEFAULT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || 2;

const RDSTATION_URL = process.env.RDSTATION_URL;
const RDSTATION_CLIENT_ID = process.env.RDSTATION_CLIENT_ID;
const RDSTATION_CLIENT_SECRET = process.env.RDSTATION_CLIENT_SECRET;
const RDSTATION_REFRESH_TOKEN = process.env.RDSTATION_REFRESH_TOKEN;

/** Crea un cliente Chatwoot para la cuenta indicada */
export function makeChatwoot(accountId) {
    return axios.create({
        baseURL: `${chatwoot_url}/api/v1/accounts/${accountId}`,
        headers: { 'Content-Type': 'application/json', 'api_access_token': api_access_token }
    });
}

const rdstation = axios.create({
    baseURL: RDSTATION_URL,
    headers: { 'Content-Type': 'application/json' }
});

// --- Job store en memoria ---
const jobs = new Map();

// Limpiar jobs más viejos de 4 horas cada 30 minutos
setInterval(() => {
    const FOUR_HOURS = 4 * 60 * 60 * 1000;
    const now = Date.now();
    for (const [jobId, job] of jobs.entries()) {
        if (now - job.createdAt > FOUR_HOURS) {
            if (job.filePath && fs.existsSync(job.filePath)) fs.unlink(job.filePath, () => {});
            jobs.delete(jobId);
        }
    }
}, 30 * 60 * 1000);

// --- Helpers internos ---

async function updateRDStationToken() {
    try {
        const response = await rdstation.post('/auth/token', {
            client_id: RDSTATION_CLIENT_ID,
            client_secret: RDSTATION_CLIENT_SECRET,
            refresh_token: RDSTATION_REFRESH_TOKEN
        });
        rdstation.defaults.headers['Authorization'] = `Bearer ${response.data.access_token}`;
        return response.data.access_token;
    } catch {
        return null;
    }
}

function generateContactId(phone) {
    if (!phone) return null;
    return `${phone.replace(/\D/g, '')}@email.com`;
}

async function getContactFromRDStation(email, phone) {
    try {
        let identifier = email || generateContactId(phone);
        if (!identifier) return null;
        const response = await rdstation.get(`/platform/contacts/email:${encodeURIComponent(identifier)}`);
        return response.data;
    } catch (error) {
        if (error.response?.status === 404) return null;
        if (error.response?.status === 401) throw new Error('INVALID_TOKEN');
        return null;
    }
}

async function fetchInboxes(chatwoot) {
    const response = await chatwoot.get('/inboxes');
    return response.data.payload;
}

async function fetchTeams(chatwoot) {
    const response = await chatwoot.get('/teams');
    return response.data;
}

async function fetchAgents(chatwoot) {
    const response = await chatwoot.get('/agents');
    return response.data;
}

/**
 * Parsea un query param que puede ser: "14", "14,8" o un array ["14","8"] (param repetido).
 * Devuelve un array de números. Si no hay valores válidos, devuelve null.
 */
function parseIds(param) {
    if (!param) return null;
    const raw = Array.isArray(param) ? param.join(',') : param;
    const ids = raw.split(',').map(v => parseInt(v.trim())).filter(v => !isNaN(v));
    return ids.length > 0 ? ids : null;
}

/**
 * Obtiene una página de conversaciones usando arrays de IDs para cada filtro.
 * @param {number[]} inboxIds  - IDs de inboxes (requerido)
 * @param {number[]|null} teamIds  - IDs de equipos (opcional)
 * @param {number[]|null} agentIds - IDs de agentes (opcional)
 * @param {string|null} dateFrom  - Fecha inicio en formato 'YYYY-MM-DD' (opcional)
 * @param {string|null} dateTo    - Fecha fin en formato 'YYYY-MM-DD' (opcional)
 */
async function getConversationsPage(chatwoot, inboxIds, page = 1, teamIds = null, agentIds = null, dateFrom = null, dateTo = null) {
    try {
        const hasTeam   = teamIds?.length > 0;
        const hasAgent  = agentIds?.length > 0;
        const hasDateFrom = dateFrom != null;
        const hasDateTo   = dateTo   != null;
        const hasMore = hasTeam || hasAgent || hasDateFrom || hasDateTo;

        const filters = [
            {
                attribute_key: 'inbox_id',
                filter_operator: 'equal_to',
                values: inboxIds,
                query_operator: hasMore ? 'and' : null
            }
        ];
        if (hasTeam) {
            filters.push({
                attribute_key: 'team_id',
                filter_operator: 'equal_to',
                values: teamIds,
                query_operator: (hasAgent || hasDateFrom || hasDateTo) ? 'and' : null
            });
        }
        if (hasAgent) {
            filters.push({
                attribute_key: 'assignee_id',
                filter_operator: 'equal_to',
                values: agentIds,
                query_operator: (hasDateFrom || hasDateTo) ? 'and' : null
            });
        }
        if (hasDateFrom) {
            filters.push({
                attribute_key: 'created_at',
                filter_operator: 'is_greater_than',
                values: [dateFrom],
                query_operator: hasDateTo ? 'AND' : null
            });
        }
        if (hasDateTo) {
            filters.push({
                attribute_key: 'created_at',
                filter_operator: 'is_less_than',
                values: [dateTo],
                query_operator: null
            });
        }
        const response = await chatwoot.post(`/conversations/filter?page=${page}`, { payload: filters });
        return response.data.payload || [];
    } catch {
        return [];
    }
}

async function getContactDetails(chatwoot, contactId) {
    try {
        const response = await chatwoot.get(`/contacts/${contactId}`);
        return response.data.payload;
    } catch {
        return null;
    }
}

async function getConversationMessages(chatwoot, conversationId) {
    try {
        const response = await chatwoot.get(`/conversations/${conversationId}/messages`);
        return response.data.payload || [];
    } catch {
        return [];
    }
}

/**
 * @param {number[]} inboxIds
 * @param {string}   inboxLabel  - Texto descriptivo para el nombre del archivo
 * @param {number[]|null} teamIds
 * @param {number[]|null} agentIds
 * @param {function|null} onProgress
 * @param {string|null} dateFrom  - Fecha inicio en formato 'YYYY-MM-DD' (opcional)
 * @param {string|null} dateTo    - Fecha fin en formato 'YYYY-MM-DD' (opcional)
 */
export async function buildExportFile(chatwoot, inboxIds, inboxLabel, teamIds, agentIds, onProgress = null, dateFrom = null, dateTo = null) {
    const conversationsData = [];
    const messagesData = [];
    const allCustomAttributeKeys = new Set();
    const processedContacts = new Map();

    let totalProcessed = 0;
    const processedCids = new Set();

    for (const inboxId of inboxIds) {
        let inboxPage = 1;
        while (true) {
            const conversations = await getConversationsPage(chatwoot, [inboxId], inboxPage, teamIds, agentIds, dateFrom, dateTo);
            if (conversations.length === 0) break;

            for (const conversation of conversations) {
                if (processedCids.has(conversation.id)) continue;
                processedCids.add(conversation.id);
                totalProcessed++;
            if (onProgress) onProgress(totalProcessed);
            let contact = processedContacts.get(conversation.meta.sender.id);
            if (!contact) {
                contact = await getContactDetails(chatwoot, conversation.meta.sender.id);
                if (contact) processedContacts.set(conversation.meta.sender.id, contact);
            }

            let rdContact = null;
            try {
                rdContact = await getContactFromRDStation(contact?.email, contact?.phone_number);
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                if (error.message === 'INVALID_TOKEN') {
                    await updateRDStationToken();
                    try { rdContact = await getContactFromRDStation(contact?.email, contact?.phone_number); } catch { /* no-op */ }
                }
            }

            const messages = await getConversationMessages(chatwoot, conversation.id);

            const rdCustomAttrs = {};
            if (rdContact) {
                Object.keys(rdContact).forEach(key => {
                    if (key.startsWith('cf_')) {
                        rdCustomAttrs[key] = rdContact[key];
                        allCustomAttributeKeys.add(key);
                    }
                });
                ['mobile_phone', 'personal_phone', 'city', 'state', 'country', 'company', 'job_title', 'tags', 'legal_bases'].forEach(field => {
                    if (rdContact[field]) {
                        const key = `rd_${field}`;
                        rdCustomAttrs[key] = rdContact[field];
                        allCustomAttributeKeys.add(key);
                    }
                });
            }

            conversationsData.push({
                conversationId: conversation.id,
                status: conversation.status,
                createdAt: new Date(conversation.created_at * 1000).toLocaleString('es-UY'),
                lastActivityAt: conversation.last_activity_at ? new Date(conversation.last_activity_at * 1000).toLocaleString('es-UY') : '',
                labels: conversation.labels?.join(', ') || '',
                unreadCount: conversation.unread_count || 0,
                channel: conversation.meta?.channel || '',
                sourceId: conversation.meta?.sender?.phone_number || conversation.contact_inbox?.source_id || '',
                contactId: contact?.id || '',
                contactName: contact?.name || '',
                contactEmail: contact?.email || '',
                contactPhone: contact?.phone_number || '',
                contactIdentifier: contact?.identifier || '',
                assigneeName: conversation.meta?.assignee?.name || '',
                teamName: conversation.meta?.team?.name || '',
                totalMessages: messages.length,
                customAttributes: rdCustomAttrs,
                rdContactFound: rdContact ? 'Sí' : 'No'
            });

            for (const message of messages) {
                let attachmentsList = '';
                if (message.attachments?.length > 0) {
                    attachmentsList = message.attachments.map(att => `${att.file_type}: ${att.data_url || att.thumb_url || 'N/A'}`).join(' | ');
                }
                messagesData.push({
                    conversationId: conversation.id,
                    messageId: message.id,
                    timestamp: new Date(message.created_at * 1000).toLocaleString('es-UY'),
                    messageType: message.message_type,
                    contentType: message.content_type || 'text',
                    senderName: message.sender?.name || 'Sistema',
                    senderRole: message.sender?.type || 'system',
                    senderEmail: message.sender?.email || '',
                    content: message.content || '',
                    isPrivate: message.private ? 'Sí' : 'No',
                    status: message.status || '',
                    attachments: attachmentsList,
                    contactId: contact?.id || '',
                    contactName: contact?.name || '',
                    contactEmail: contact?.email || '',
                    contactPhone: contact?.phone_number || '',
                    contactIdentifier: contact?.identifier || '',
                    customAttributes: rdCustomAttrs
                });
            } // end for messages

            } // end for conversation

            inboxPage++;
            await new Promise(resolve => setTimeout(resolve, 500));
        } // end while per-inbox
    } // end for inboxId

    // Construir Excel
    const sortedCustomKeys = Array.from(allCustomAttributeKeys).sort();
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Conversaciones');
    const messagesSheet = workbook.addWorksheet('Mensajes');

    const conversationsColumns = [
        { header: 'ID Conversación', key: 'conversationId', width: 15 },
        { header: 'Estado', key: 'status', width: 12 },
        { header: 'Fecha Creación', key: 'createdAt', width: 20 },
        { header: 'Última Actividad', key: 'lastActivityAt', width: 20 },
        { header: 'Etiquetas', key: 'labels', width: 30 },
        { header: 'Mensajes Sin Leer', key: 'unreadCount', width: 15 },
        { header: 'Canal', key: 'channel', width: 20 },
        { header: 'Source ID', key: 'sourceId', width: 20 },
        { header: 'ID Contacto', key: 'contactId', width: 15 },
        { header: 'Nombre Completo', key: 'contactName', width: 25 },
        { header: 'Email', key: 'contactEmail', width: 30 },
        { header: 'Teléfono', key: 'contactPhone', width: 20 },
        { header: 'Identificador', key: 'contactIdentifier', width: 20 },
    ];
    sortedCustomKeys.forEach(key => conversationsColumns.push({ header: `CF: ${key}`, key: `cf_${key}`, width: 25 }));
    conversationsColumns.push(
        { header: 'Contacto en RD Station', key: 'rdContactFound', width: 20 },
        { header: 'Agente Asignado', key: 'assigneeName', width: 25 },
        { header: 'Equipo Asignado', key: 'teamName', width: 25 },
        { header: 'Total Mensajes', key: 'totalMessages', width: 15 }
    );
    worksheet.columns = conversationsColumns;

    const messagesColumns = [
        { header: 'ID Conversación', key: 'conversationId', width: 15 },
        { header: 'ID Mensaje', key: 'messageId', width: 15 },
        { header: 'Fecha/Hora', key: 'timestamp', width: 20 },
        { header: 'Tipo', key: 'messageType', width: 12 },
        { header: 'Tipo Contenido', key: 'contentType', width: 15 },
        { header: 'Remitente', key: 'senderName', width: 25 },
        { header: 'Rol', key: 'senderRole', width: 15 },
        { header: 'Email Remitente', key: 'senderEmail', width: 30 },
        { header: 'Contenido', key: 'content', width: 80 },
        { header: 'Mensaje Privado', key: 'isPrivate', width: 15 },
        { header: 'Estado', key: 'status', width: 12 },
        { header: 'Archivos Adjuntos', key: 'attachments', width: 50 },
        { header: 'ID Contacto', key: 'contactId', width: 15 },
        { header: 'Nombre Contacto', key: 'contactName', width: 25 },
        { header: 'Email Contacto', key: 'contactEmail', width: 30 },
        { header: 'Teléfono Contacto', key: 'contactPhone', width: 20 },
        { header: 'Identificador', key: 'contactIdentifier', width: 20 },
    ];
    sortedCustomKeys.forEach(key => messagesColumns.push({ header: `CF: ${key}`, key: `cf_${key}`, width: 25 }));
    messagesSheet.columns = messagesColumns;

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4CAF50' } };
    messagesSheet.getRow(1).font = { bold: true };
    messagesSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2196F3' } };

    conversationsData.forEach(convData => {
        const rowData = {
            conversationId: convData.conversationId, status: convData.status, createdAt: convData.createdAt,
            lastActivityAt: convData.lastActivityAt, labels: convData.labels, unreadCount: convData.unreadCount,
            channel: convData.channel, sourceId: convData.sourceId, contactId: convData.contactId,
            contactName: convData.contactName, contactEmail: convData.contactEmail, contactPhone: convData.contactPhone,
            contactIdentifier: convData.contactIdentifier,
        };
        sortedCustomKeys.forEach(key => { rowData[`cf_${key}`] = convData.customAttributes[key] || ''; });
        rowData.rdContactFound = convData.rdContactFound;
        rowData.assigneeName = convData.assigneeName;
        rowData.teamName = convData.teamName;
        rowData.totalMessages = convData.totalMessages;
        worksheet.addRow(rowData);
    });

    messagesData.forEach(msgData => {
        const rowData = {
            conversationId: msgData.conversationId, messageId: msgData.messageId, timestamp: msgData.timestamp,
            messageType: msgData.messageType, contentType: msgData.contentType, senderName: msgData.senderName,
            senderRole: msgData.senderRole, senderEmail: msgData.senderEmail, content: msgData.content,
            isPrivate: msgData.isPrivate, status: msgData.status, attachments: msgData.attachments,
            contactId: msgData.contactId, contactName: msgData.contactName, contactEmail: msgData.contactEmail,
            contactPhone: msgData.contactPhone, contactIdentifier: msgData.contactIdentifier,
        };
        sortedCustomKeys.forEach(key => { rowData[`cf_${key}`] = msgData.customAttributes[key] || ''; });
        messagesSheet.addRow(rowData);
    });

    // Guardar en disco y devolver la ruta
    const exportsDir = path.join(__dirname, '..', 'exports');
    if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

    const sanitize = (s) => s.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s_-]/g, '').trim().replace(/\s+/g, '_').slice(0, 60);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const teamSuffix  = teamIds?.length  > 0 ? `_eq${teamIds.join('-')}`   : '';
    const agentSuffix = agentIds?.length > 0 ? `_ag${agentIds.join('-')}` : '';
    const dateSuffix  = (dateFrom || dateTo)
        ? `_${dateFrom || 'inicio'}_${dateTo || 'hoy'}`
        : '';
    const labelPart = sanitize(inboxLabel);
    const fileName = `conversaciones_${labelPart}${teamSuffix}${agentSuffix}${dateSuffix}_${timestamp}.xlsx`
        .replace(/_+/g, '_'); // collapse multiple underscores
    const filePath = path.join(exportsDir, fileName);

    await workbook.xlsx.writeFile(filePath);
    return { filePath, fileName };
}

// --- Controlador HTTP ---

/** Middleware de autenticación compartido */
function requireToken(req, res) {
    const secret = process.env.EXPORT_SECRET;
    if (secret && req.headers['x-export-token'] !== secret) {
        res.status(401).json({ error: 'Token de exportación inválido o ausente.' });
        return false;
    }
    return true;
}

/**
 * Valida y devuelve accountId desde el query param.
 * Si no se proporciona o es inválido, escribe el error en res y devuelve null.
 */
function requireAccountId(query, res) {
    const id = parseInt(query.accountId);
    if (!id || isNaN(id)) {
        res.status(400).json({ error: 'Se requiere el parámetro accountId (número entero).' });
        return null;
    }
    return id;
}

/**
 * GET /api/export/options?accountId=2
 * Devuelve inboxes, equipos y agentes en una sola llamada.
 * Usar esto antes de exportar para conocer los IDs disponibles.
 */
export async function GetOptions(req, res) {
    if (!requireToken(req, res)) return;
    const accountId = requireAccountId(req.query, res);
    if (!accountId) return;
    try {
        const chatwoot = makeChatwoot(accountId);
        const [inboxes, teams, agents] = await Promise.all([
            fetchInboxes(chatwoot),
            fetchTeams(chatwoot),
            fetchAgents(chatwoot)
        ]);
        res.json({
            accountId,
            inboxes: inboxes.map(i => ({ id: i.id, name: i.name, channel_type: i.channel_type })),
            teams:   teams.map(t => ({ id: t.id, name: t.name })),
            agents:  agents.map(a => ({ id: a.id, name: a.name, email: a.email, role: a.role }))
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener opciones.', detail: error.message });
    }
}

/**
 * GET /api/export/inboxes?accountId=2
 * Devuelve la lista de inboxes disponibles en la cuenta.
 */
export async function GetInboxes(req, res) {
    if (!requireToken(req, res)) return;
    const accountId = requireAccountId(req.query, res);
    if (!accountId) return;
    try {
        const chatwoot = makeChatwoot(accountId);
        const inboxes = await fetchInboxes(chatwoot);
        res.json({
            accountId,
            inboxes: inboxes.map(i => ({ id: i.id, name: i.name, channel_type: i.channel_type }))
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener inboxes.', detail: error.message });
    }
}

/**
 * GET /api/export/teams?accountId=2
 * Devuelve la lista de equipos disponibles en la cuenta.
 */
export async function GetTeams(req, res) {
    if (!requireToken(req, res)) return;
    const accountId = requireAccountId(req.query, res);
    if (!accountId) return;
    try {
        const chatwoot = makeChatwoot(accountId);
        const teams = await fetchTeams(chatwoot);
        res.json({ accountId, teams: teams.map(t => ({ id: t.id, name: t.name })) });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener equipos.', detail: error.message });
    }
}

/**
 * GET /api/export/agents?accountId=2
 * Devuelve la lista de agentes disponibles en la cuenta.
 */
export async function GetAgents(req, res) {
    if (!requireToken(req, res)) return;
    const accountId = requireAccountId(req.query, res);
    if (!accountId) return;
    try {
        const chatwoot = makeChatwoot(accountId);
        const agents = await fetchAgents(chatwoot);
        res.json({
            accountId,
            agents: agents.map(a => ({ id: a.id, name: a.name, email: a.email, role: a.role }))
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener agentes.', detail: error.message });
    }
}

/**
 * POST /api/export/conversations?accountId=2&inboxId=14&teamId=4
 * Inicia la exportación en background y responde INMEDIATAMENTE con un jobId.
 * No bloquea la conexión — evita el timeout 524 de Cloudflare y similares.
 */
export async function StartExport(req, res) {
    if (!requireToken(req, res)) return;

    const accountId = requireAccountId(req.query, res);
    if (!accountId) return;

    const inboxIds  = parseIds(req.query.inboxId);
    const teamIds   = parseIds(req.query.teamId);
    const agentIds  = parseIds(req.query.agentId);
    // Pasar las fechas como strings 'YYYY-MM-DD' directamente a Chatwoot
    // Chatwoot espera strings de fecha, NO Unix timestamps
    const dateFrom  = req.query.dateFrom || null;
    const dateTo    = req.query.dateTo   || null;

    if (!inboxIds) {
        return res.status(400).json({ error: 'Se requiere al menos un inboxId válido. Ej: inboxId=14 o inboxId=14,8' });
    }
    // Validar formato de fechas YYYY-MM-DD
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (dateFrom && !dateRegex.test(dateFrom)) {
        return res.status(400).json({ error: 'dateFrom debe tener formato YYYY-MM-DD. Ej: 2026-01-01' });
    }
    if (dateTo && !dateRegex.test(dateTo)) {
        return res.status(400).json({ error: 'dateTo debe tener formato YYYY-MM-DD. Ej: 2026-12-31' });
    }
    if (dateFrom && isNaN(new Date(dateFrom).getTime())) {
        return res.status(400).json({ error: 'dateFrom no es una fecha válida. Ej: 2026-01-01' });
    }
    if (dateTo && isNaN(new Date(dateTo).getTime())) {
        return res.status(400).json({ error: 'dateTo no es una fecha válida. Ej: 2026-12-31' });
    }

    const jobId = crypto.randomUUID();
    jobs.set(jobId, { status: 'processing', progress: 0, filePath: null, fileName: null, error: null, createdAt: Date.now() });

    // Responde inmediatamente antes de iniciar el proceso pesado
    res.status(202).json({
        jobId,
        status: 'processing',
        statusUrl: `/api/export/status/${jobId}`,
        downloadUrl: `/api/export/download/${jobId}`
    });

    // Procesar en background sin bloquear
    (async () => {
        try {
            const chatwoot = makeChatwoot(accountId);
            const allInboxes = await fetchInboxes(chatwoot);
            const validInboxes = allInboxes.filter(i => inboxIds.includes(i.id));
            const notFound = inboxIds.filter(id => !allInboxes.find(i => i.id === id));

            if (notFound.length > 0) {
                const job = jobs.get(jobId);
                if (job) { job.status = 'error'; job.error = `inboxId no encontrados en la cuenta ${accountId}: ${notFound.join(', ')}`; }
                return;
            }

            const inboxLabel = validInboxes.length === 1
                ? validInboxes[0].name
                : validInboxes.slice(0, 3).map(i => i.name).join('_y_') + `_y_${validInboxes.length - 3}_mas`;

            await updateRDStationToken();

            const job = jobs.get(jobId);
            const { filePath, fileName } = await buildExportFile(
                chatwoot, inboxIds, inboxLabel, teamIds, agentIds,
                (current) => { if (job) job.progress = current; },
                dateFrom, dateTo
            );
            if (job) { job.status = 'done'; job.filePath = filePath; job.fileName = fileName; }
        } catch (error) {
            const job = jobs.get(jobId);
            if (job) { job.status = 'error'; job.error = error.message; }
            console.error(`[Export Job ${jobId}] Error:`, error.message);
        }
    })();
}

/**
 * GET /api/export/status/:jobId
 * Devuelve el estado del job. Hacer polling cada 5-10 segundos.
 */
export async function GetExportStatus(req, res) {
    if (!requireToken(req, res)) return;
    const { jobId } = req.params;
    const job = jobs.get(jobId);

    if (!job) return res.status(404).json({ error: 'Job no encontrado o expirado (máx. 1 hora).' });

    res.json({
        jobId,
        status: job.status,
        conversacionesProcesadas: job.progress,
        fileName: job.status === 'done' ? job.fileName : null,
        downloadUrl: job.status === 'done' ? `/api/export/download/${jobId}` : null,
        error: job.error || null
    });
}

/**
 * GET /api/export/download/:jobId
 * Descarga el Excel generado. Solo disponible cuando status === "done".
 * El archivo y el job se eliminan del servidor tras la descarga.
 */
export async function DownloadExport(req, res) {
    if (!requireToken(req, res)) return;
    const { jobId } = req.params;
    const job = jobs.get(jobId);

    if (!job) return res.status(404).json({ error: 'Job no encontrado o expirado (máx. 1 hora).' });

    if (job.status === 'processing') {
        return res.status(202).json({
            status: 'processing',
            conversacionesProcesadas: job.progress,
            message: `Exportación en proceso. Consultá el estado en /api/export/status/${jobId}`
        });
    }

    if (job.status === 'error') return res.status(500).json({ status: 'error', error: job.error });

    if (!job.filePath || !fs.existsSync(job.filePath)) {
        return res.status(404).json({ error: 'Archivo no disponible.' });
    }

    res.download(job.filePath, job.fileName, (err) => {
        jobs.delete(jobId);
        fs.unlink(job.filePath, () => {});
        if (err && !res.headersSent) res.status(500).json({ error: 'Error al enviar el archivo.' });
    });
}

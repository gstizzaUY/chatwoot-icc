import axios from 'axios';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Inicializar __filename y __dirname primero
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar dotenv desde backend/.env explícitamente
dotenv.config({ path: path.join(__dirname, '.env') });

console.log('¿Existe .env en backend?', fs.existsSync(path.join(__dirname, '.env')));
console.log('CHATWOOT_URL:', process.env.CHATWOOT_URL);
console.log('API_ACCESS_TOKEN:', process.env.API_ACCESS_TOKEN ? '***' : '(vacío)');
console.log('RDSTATION_URL:', process.env.RDSTATION_URL);
console.log('RDSTATION_CLIENT_ID:', process.env.RDSTATION_CLIENT_ID ? '***' : '(vacío)');
console.log('RDSTATION_CLIENT_SECRET:', process.env.RDSTATION_CLIENT_SECRET ? '***' : '(vacío)');
console.log('RDSTATION_REFRESH_TOKEN:', process.env.RDSTATION_REFRESH_TOKEN ? '***' : '(vacío)');

const chatwoot_url = process.env.CHATWOOT_URL;
const api_access_token = process.env.API_ACCESS_TOKEN;
const ACCOUNT_ID = 2; // Ajustar según tu cuenta

const RDSTATION_URL = process.env.RDSTATION_URL;
const RDSTATION_CLIENT_ID = process.env.RDSTATION_CLIENT_ID;
const RDSTATION_CLIENT_SECRET = process.env.RDSTATION_CLIENT_SECRET;
const RDSTATION_REFRESH_TOKEN = process.env.RDSTATION_REFRESH_TOKEN;

const chatwoot = axios.create({
    baseURL: `${chatwoot_url}/api/v1/accounts/${ACCOUNT_ID}`,
    headers: {
        'Content-Type': 'application/json',
        'api_access_token': api_access_token
    }
});

const rdstation = axios.create({
    baseURL: RDSTATION_URL,
    headers: {
        'Content-Type': 'application/json'
    }
});

// Sistema de logging
let logFilePath = '';
let logStream = null;

/**
 * Inicializa el sistema de logging
 */
function initializeLogger(inboxName) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const logsDir = path.join(__dirname, 'logs');
    
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }
    
    const logFileName = `export_${inboxName.replace(/[^a-z0-9]/gi, '_')}_${timestamp}.log`;
    logFilePath = path.join(logsDir, logFileName);
    logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    
    log('info', '='.repeat(80));
    log('info', `Iniciando exportación de conversaciones`);
    log('info', `Inbox: ${inboxName}`);
    log('info', `Fecha: ${new Date().toLocaleString('es-UY')}`);
    log('info', '='.repeat(80));
}

/**
 * Escribe un mensaje en el log
 */
function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    
    if (logStream) {
        logStream.write(logMessage + '\n');
        if (data) {
            logStream.write(JSON.stringify(data, null, 2) + '\n');
        }
    }
}

/**
 * Cierra el sistema de logging
 */
function closeLogger() {
    if (logStream) {
        log('info', '='.repeat(80));
        log('info', 'Exportación finalizada');
        log('info', '='.repeat(80));
        logStream.end();
    }
}

/**
 * Actualiza el token de acceso de RD Station
 */
async function updateRDStationToken() {
    const credentials = {
        client_id: RDSTATION_CLIENT_ID,
        client_secret: RDSTATION_CLIENT_SECRET,
        refresh_token: RDSTATION_REFRESH_TOKEN
    };
    try {
        log('debug', 'Actualizando token de RD Station');
        const response = await rdstation.post('/auth/token', credentials);
        rdstation.defaults.headers['Authorization'] = `Bearer ${response.data.access_token}`;
        log('info', 'Token de RD Station actualizado exitosamente');
        return response.data.access_token;
    } catch (error) {
        console.error('Error al actualizar token de RD Station:', error.message);
        log('error', 'Error al actualizar token de RD Station', { error: error.message, stack: error.stack });
        return null;
    }
}

/**
 * Genera un ID de contacto basado en el teléfono
 */
function generateContactId(phone) {
    if (!phone) return null;
    return `${phone.replace(/\D/g, '')}@email.com`;
}

/**
 * Obtiene datos completos de un contacto desde RD Station
 * @param {string} email - Email del contacto
 * @param {string} phone - Teléfono del contacto
 */
async function getContactFromRDStation(email, phone) {
    try {
        let identifier = email;
        
        // Si no hay email, generar ID desde el teléfono
        if (!identifier && phone) {
            identifier = generateContactId(phone);
        }
        
        if (!identifier) {
            log('debug', 'No se puede consultar RD Station sin email o teléfono');
            return null;
        }

        log('debug', `Consultando RD Station para: ${identifier}`);
        const response = await rdstation.get(`/platform/contacts/email:${encodeURIComponent(identifier)}`);
        log('debug', `Contacto encontrado en RD Station: ${identifier}`);
        return response.data;
    } catch (error) {
        if (error.response && error.response.status === 404) {
            log('debug', `Contacto no encontrado en RD Station: ${email || phone}`);
            return null;
        }
        if (error.response && error.response.status === 401) {
            throw new Error('INVALID_TOKEN');
        }
        console.error(`Error al obtener contacto de RD Station:`, error.message);
        log('error', `Error al obtener contacto de RD Station`, { 
            email, 
            phone, 
            error: error.message, 
            status: error.response?.status 
        });
        return null;
    }
}

/**
 * Obtiene todas las bandejas de entrada (inboxes)
 */
async function fetchInboxes() {
    try {
        log('info', 'Obteniendo lista de inboxes');
        const response = await chatwoot.get('/inboxes');
        log('info', `Se encontraron ${response.data.payload.length} inboxes`);
        return response.data.payload;
    } catch (error) {
        console.error('Error al obtener inboxes:', error.message);
        log('error', 'Error al obtener inboxes', { error: error.message, stack: error.stack });
        return [];
    }
}

/**
 * Obtiene conversaciones de un inbox específico con paginación
 * @param {number} inboxId - ID del inbox
 * @param {number} page - Número de página
 * @param {number|null} teamId - ID del equipo (opcional)
 */
async function getConversationsFromInbox(inboxId, page = 1, teamId = null) {
    try {
        const filters = [
            {
                attribute_key: 'inbox_id',
                filter_operator: 'equal_to',
                values: [inboxId],
                query_operator: teamId ? 'and' : null
            }
        ];

        // Agregar filtro de equipo si se proporciona
        if (teamId) {
            filters.push({
                attribute_key: 'team_id',
                filter_operator: 'equal_to',
                values: [teamId],
                query_operator: null
            });
        }

        const payload = { payload: filters };

        log('debug', `Obteniendo conversaciones página ${page}${teamId ? ` (Equipo: ${teamId})` : ''}`);
        const response = await chatwoot.post(`/conversations/filter?page=${page}`, payload);
        log('debug', `Página ${page}: ${response.data.payload?.length || 0} conversaciones encontradas`);
        return response.data.payload || [];
    } catch (error) {
        console.error(`Error al obtener conversaciones página ${page}:`, error.message);
        log('error', `Error al obtener conversaciones página ${page}`, { error: error.message, stack: error.stack });
        return [];
    }
}

/**
 * Obtiene datos completos de un contacto
 * @param {number} contactId - ID del contacto
 */
async function getContactDetails(contactId) {
    try {
        log('debug', `Obteniendo detalles del contacto ${contactId}`);
        const response = await chatwoot.get(`/contacts/${contactId}`);
        return response.data.payload;
    } catch (error) {
        console.error(`Error al obtener contacto ${contactId}:`, error.message);
        log('error', `Error al obtener contacto ${contactId}`, { error: error.message, stack: error.stack });
        return null;
    }
}

/**
 * Obtiene mensajes de una conversación
 * @param {number} conversationId - ID de la conversación
 */
async function getConversationMessages(conversationId) {
    try {
        log('debug', `Obteniendo mensajes de la conversación ${conversationId}`);
        const response = await chatwoot.get(`/conversations/${conversationId}/messages`);
        log('debug', `Conversación ${conversationId}: ${response.data.payload?.length || 0} mensajes`);
        return response.data.payload || [];
    } catch (error) {
        console.error(`Error al obtener mensajes de conversación ${conversationId}:`, error.message);
        log('error', `Error al obtener mensajes de conversación ${conversationId}`, { error: error.message, stack: error.stack });
        return [];
    }
}

/**
 * Exporta conversaciones a Excel con dos hojas: Conversaciones y Mensajes
 * @param {number} inboxId - ID del inbox a exportar
 * @param {string} inboxName - Nombre del inbox
 * @param {number|null} teamId - ID del equipo para filtrar (opcional)
 */
async function exportConversationsToExcel(inboxId, inboxName, teamId = null) {
    console.log(`\n📊 Iniciando exportación del inbox: ${inboxName} (ID: ${inboxId})${teamId ? ` - Equipo ID: ${teamId}` : ''}`);
    log('info', `Iniciando exportación del inbox: ${inboxName} (ID: ${inboxId})${teamId ? ` - Equipo ID: ${teamId}` : ''}`);
    
    // Colecciones para almacenar datos temporalmente
    const conversationsData = [];
    const messagesData = [];
    const allCustomAttributeKeys = new Set();
    const processedContacts = new Map(); // Cache de contactos
    
    let page = 1;
    let hasMorePages = true;
    let totalConversations = 0;
    let totalMessages = 0;

    // PASO 1: Recolectar todos los datos
    console.log('📦 Fase 1: Recolectando datos...');
    log('info', 'Iniciando fase de recolección de datos');
    
    while (hasMorePages) {
        console.log(`📄 Procesando página ${page}...`);
        const conversations = await getConversationsFromInbox(inboxId, page, teamId);

        if (conversations.length === 0) {
            hasMorePages = false;
            break;
        }

        for (const conversation of conversations) {
            totalConversations++;
            console.log(`  ⏳ Procesando conversación ${totalConversations}: ID ${conversation.id}`);
            log('info', `Procesando conversación ${totalConversations}: ID ${conversation.id}`, {
                status: conversation.status,
                contactId: conversation.meta.sender.id
            });

            // Obtener datos del contacto de Chatwoot (usar cache si existe)
            let contact = processedContacts.get(conversation.meta.sender.id);
            if (!contact) {
                contact = await getContactDetails(conversation.meta.sender.id);
                if (contact) {
                    processedContacts.set(conversation.meta.sender.id, contact);
                }
            }

            // Obtener datos completos desde RD Station
            let rdContact = null;
            try {
                rdContact = await getContactFromRDStation(contact?.email, contact?.phone_number);
                // Pequeña pausa para no sobrecargar RD Station API
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                if (error.message === 'INVALID_TOKEN') {
                    log('info', 'Token de RD Station inválido, renovando...');
                    await updateRDStationToken();
                    // Reintentar
                    try {
                        rdContact = await getContactFromRDStation(contact?.email, contact?.phone_number);
                    } catch (retryError) {
                        log('error', 'Error al reintentar consulta de RD Station', { error: retryError.message });
                    }
                }
            }

            // Obtener mensajes de la conversación
            const messages = await getConversationMessages(conversation.id);
            console.log(`     📨 ${messages.length} mensajes encontrados`);
            log('info', `Conversación ${conversation.id}: ${messages.length} mensajes encontrados`);

            // Extraer campos personalizados de RD Station y recolectar todas las claves
            const rdCustomAttrs = {};
            
            if (rdContact) {
                // Extraer todos los campos custom (cf_*) de RD Station
                Object.keys(rdContact).forEach(key => {
                    if (key.startsWith('cf_')) {
                        rdCustomAttrs[key] = rdContact[key];
                        allCustomAttributeKeys.add(key);
                    }
                });
                
                // También agregar campos estándar de RD Station que no estén en Chatwoot
                const standardFields = ['name', 'email', 'mobile_phone', 'personal_phone', 'city', 'state', 'country', 'company', 'job_title', 'tags', 'legal_bases'];
                standardFields.forEach(field => {
                    if (rdContact[field] && field !== 'name' && field !== 'email') {
                        const key = `rd_${field}`;
                        rdCustomAttrs[key] = rdContact[field];
                        allCustomAttributeKeys.add(key);
                    }
                });
            }

            // Preparar datos para la hoja de conversaciones
            const rowData = {
                // Datos de conversación
                conversationId: conversation.id,
                status: conversation.status,
                createdAt: new Date(conversation.created_at * 1000).toLocaleString('es-UY'),
                lastActivityAt: conversation.last_activity_at 
                    ? new Date(conversation.last_activity_at * 1000).toLocaleString('es-UY') 
                    : '',
                labels: conversation.labels?.join(', ') || '',
                unreadCount: conversation.unread_count || 0,
                channel: conversation.meta?.channel || '',
                sourceId: conversation.meta?.sender?.phone_number || conversation.contact_inbox?.source_id || '',

                // Datos del contacto
                contactId: contact?.id || '',
                contactName: contact?.name || '',
                contactEmail: contact?.email || '',
                contactPhone: contact?.phone_number || '',
                contactIdentifier: contact?.identifier || '',

                // Información adicional
                assigneeName: conversation.meta?.assignee?.name || '',
                teamName: conversation.meta?.team?.name || '',
                totalMessages: messages.length,
                
                // Guardar todos los custom attributes de RD Station
                customAttributes: rdCustomAttrs,
                rdContactFound: rdContact ? 'Sí' : 'No'
            };

            conversationsData.push(rowData);

            // Agregar todos los mensajes a la colección temporal
            for (const message of messages) {
                totalMessages++;
                
                // Procesar attachments si existen
                let attachmentsList = '';
                if (message.attachments && message.attachments.length > 0) {
                    attachmentsList = message.attachments.map(att => 
                        `${att.file_type}: ${att.data_url || att.thumb_url || 'N/A'}`
                    ).join(' | ');
                }

                const messageData = {
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
                    
                    // Datos del contacto para referencia
                    contactId: contact?.id || '',
                    contactName: contact?.name || '',
                    contactEmail: contact?.email || '',
                    contactPhone: contact?.phone_number || '',
                    contactIdentifier: contact?.identifier || '',
                    
                    // Guardar todos los custom attributes de RD Station
                    customAttributes: rdCustomAttrs
                };

                messagesData.push(messageData);
            }
        }

        page++;
        
        // Pequeña pausa para no sobrecargar la API
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`\n✅ Total de conversaciones procesadas: ${totalConversations}`);
    console.log(`✅ Total de mensajes exportados: ${totalMessages}`);
    console.log(`📋 Campos personalizados encontrados: ${allCustomAttributeKeys.size}`);
    log('info', `Total de conversaciones procesadas: ${totalConversations}`);
    log('info', `Total de mensajes exportados: ${totalMessages}`);
    log('info', `Contactos únicos procesados: ${processedContacts.size}`);
    log('info', `Campos personalizados encontrados: ${allCustomAttributeKeys.size}`, { 
        campos: Array.from(allCustomAttributeKeys).sort() 
    });

    // PASO 2: Crear el Excel con columnas dinámicas
    console.log('\n📝 Fase 2: Creando archivo Excel con columnas dinámicas...');
    log('info', 'Creando archivo Excel con columnas dinámicas');
    
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Conversaciones');
    const messagesSheet = workbook.addWorksheet('Mensajes');

    // Crear columnas base para Conversaciones
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

    // Agregar columnas dinámicas de campos personalizados para Conversaciones
    const sortedCustomKeys = Array.from(allCustomAttributeKeys).sort();
    sortedCustomKeys.forEach(key => {
        conversationsColumns.push({
            header: `CF: ${key}`,
            key: `cf_${key}`,
            width: 25
        });
    });

    // Agregar columnas finales para Conversaciones
    conversationsColumns.push(
        { header: 'Contacto en RD Station', key: 'rdContactFound', width: 20 },
        { header: 'Agente Asignado', key: 'assigneeName', width: 25 },
        { header: 'Equipo Asignado', key: 'teamName', width: 25 },
        { header: 'Total Mensajes', key: 'totalMessages', width: 15 }
    );

    worksheet.columns = conversationsColumns;

    // Crear columnas base para Mensajes
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

    // Agregar las mismas columnas dinámicas de campos personalizados para Mensajes
    sortedCustomKeys.forEach(key => {
        messagesColumns.push({
            header: `CF: ${key}`,
            key: `cf_${key}`,
            width: 25
        });
    });

    messagesSheet.columns = messagesColumns;

    // Aplicar estilos a los encabezados
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4CAF50' }
    };

    messagesSheet.getRow(1).font = { bold: true };
    messagesSheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF2196F3' }
    };

    // PASO 3: Escribir los datos en el Excel
    console.log('📥 Fase 3: Escribiendo datos en Excel...');
    log('info', 'Escribiendo datos en las hojas de Excel');

    // Escribir conversaciones
    conversationsData.forEach(convData => {
        const rowData = {
            conversationId: convData.conversationId,
            status: convData.status,
            createdAt: convData.createdAt,
            lastActivityAt: convData.lastActivityAt,
            labels: convData.labels,
            unreadCount: convData.unreadCount,
            channel: convData.channel,
            sourceId: convData.sourceId,
            contactId: convData.contactId,
            contactName: convData.contactName,
            contactEmail: convData.contactEmail,
            contactPhone: convData.contactPhone,
            contactIdentifier: convData.contactIdentifier,
        };

        // Agregar campos personalizados dinámicamente
        sortedCustomKeys.forEach(key => {
            rowData[`cf_${key}`] = convData.customAttributes[key] || '';
        });

        // Agregar campos finales
        rowData.rdContactFound = convData.rdContactFound;
        rowData.assigneeName = convData.assigneeName;
        rowData.teamName = convData.teamName;
        rowData.totalMessages = convData.totalMessages;

        worksheet.addRow(rowData);
    });

    // Escribir mensajes
    messagesData.forEach(msgData => {
        const rowData = {
            conversationId: msgData.conversationId,
            messageId: msgData.messageId,
            timestamp: msgData.timestamp,
            messageType: msgData.messageType,
            contentType: msgData.contentType,
            senderName: msgData.senderName,
            senderRole: msgData.senderRole,
            senderEmail: msgData.senderEmail,
            content: msgData.content,
            isPrivate: msgData.isPrivate,
            status: msgData.status,
            attachments: msgData.attachments,
            contactId: msgData.contactId,
            contactName: msgData.contactName,
            contactEmail: msgData.contactEmail,
            contactPhone: msgData.contactPhone,
            contactIdentifier: msgData.contactIdentifier,
        };

        // Agregar campos personalizados dinámicamente
        sortedCustomKeys.forEach(key => {
            rowData[`cf_${key}`] = msgData.customAttributes[key] || '';
        });

        messagesSheet.addRow(rowData);
    });

    // Guardar el archivo
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const teamSuffix = teamId ? `_team${teamId}` : '';
    const fileName = `conversaciones_${inboxName.replace(/[^a-z0-9]/gi, '_')}${teamSuffix}_${timestamp}.xlsx`;
    const filePath = path.join(__dirname, 'exports', fileName);

    // Crear carpeta exports si no existe
    const exportsDir = path.join(__dirname, 'exports');
    if (!fs.existsSync(exportsDir)) {
        fs.mkdirSync(exportsDir, { recursive: true });
    }

    log('info', `Guardando archivo Excel: ${filePath}`);
    await workbook.xlsx.writeFile(filePath);
    console.log(`\n✅ Archivo exportado exitosamente: ${filePath}`);
    log('info', `Archivo exportado exitosamente: ${filePath}`);

    return filePath;
}

/**
 * Función principal para seleccionar inbox y exportar
 */
async function main() {
    try {
        console.log('🚀 Iniciando exportación de conversaciones...\n');

        // Inicializar token de RD Station
        console.log('🔑 Autenticando con RD Station...');
        const token = await updateRDStationToken();
        if (!token) {
            console.error('❌ No se pudo obtener token de RD Station');
            console.log('⚠️  Continuando sin datos de RD Station...\n');
        } else {
            console.log('✅ Autenticación con RD Station exitosa\n');
        }

        // Obtener todos los inboxes
        const inboxes = await fetchInboxes();

        if (inboxes.length === 0) {
            console.error('❌ No se encontraron inboxes');
            log('error', 'No se encontraron inboxes');
            return;
        }

        console.log('📥 Inboxes disponibles:');
        inboxes.forEach((inbox, index) => {
            console.log(`  ${index + 1}. ${inbox.name} (ID: ${inbox.id}) - ${inbox.channel_type}`);
        });

        // Aquí puedes seleccionar el inbox manualmente o configurarlo
        // Para este ejemplo, exportaremos todos los inboxes
        console.log('\n🔄 Selecciona el INBOX a exportar modificando el script\n');
        
        // CONFIGURACIÓN: Cambiar estos valores para exportar un inbox y equipo específico
        const INBOX_ID_TO_EXPORT = 14; // Cambiar por el ID del inbox que deseas exportar
        const TEAM_ID_TO_EXPORT = 4; // Cambiar por el ID del equipo (o null para todos)
        
        const selectedInbox = inboxes.find(inbox => inbox.id === INBOX_ID_TO_EXPORT);
        
        if (!selectedInbox) {
            console.error(`❌ No se encontró el inbox con ID ${INBOX_ID_TO_EXPORT}`);
            log('error', `No se encontró el inbox con ID ${INBOX_ID_TO_EXPORT}`);
            return;
        }

        // Inicializar el logger
        initializeLogger(selectedInbox.name);
        
        if (TEAM_ID_TO_EXPORT) {
            console.log(`🔍 Filtrando por equipo ID: ${TEAM_ID_TO_EXPORT}\n`);
            log('info', `Aplicando filtro de equipo: ${TEAM_ID_TO_EXPORT}`);
        }
        
        await exportConversationsToExcel(selectedInbox.id, selectedInbox.name, TEAM_ID_TO_EXPORT);

        console.log('\n✨ Exportación completada exitosamente!\n');
        console.log(`📄 Log guardado en: ${logFilePath}`);

    } catch (error) {
        console.error('❌ Error en la exportación:', error.message);
        console.error(error);
        log('error', 'Error fatal en la exportación', { error: error.message, stack: error.stack });
    } finally {
        closeLogger();
    }
}

// Ejecutar el script
main();

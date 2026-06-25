import OpenAI from 'openai';
import dotenv from 'dotenv';
import contextBuilderService from '../../services/shared/context-builder.service.js';
import crmSyncService from '../../services/shared/crm-sync.service.js';
import fieldProtectionService from '../../services/shared/field-protection.service.js';
import chatwootClient from '../../clients/chatwoot.client.js';

dotenv.config();

/**
 * Clase base abstracta para todos los agentes IA
 * Define interfaz común y lógica compartida
 */
class BaseAgent {
    constructor(config) {
        this.agentType = config.agentType;
        this.channels = config.channels || [];
        
        // Inicializar OpenAI
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY no configurada');
        }

        this.openai = new OpenAI({ apiKey });
        this.model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

        // Servicios compartidos
        this.contextBuilder = contextBuilderService;
        this.crmSync = crmSyncService;
        this.fieldProtection = fieldProtectionService;

        console.log(`✅ Agente ${this.agentType} inicializado`);
    }

    /**
     * MÉTODOS ABSTRACTOS - Deben ser implementados por cada agente
     */

    /**
     * Obtiene el prompt del sistema específico del agente
     * @abstract
     * @returns {string}
     */
    getSystemPrompt() {
        throw new Error('getSystemPrompt() debe ser implementado por el agente');
    }

    /**
     * Construye el prompt del usuario específico del agente
     * @abstract
     * @param {Object} context - Contexto de la conversación
     * @returns {string}
     */
    buildUserPrompt(context) {
        throw new Error('buildUserPrompt() debe ser implementado por el agente');
    }

    /**
     * Procesa el resultado del análisis de IA
     * @abstract
     * @param {Object} aiResult - Resultado del análisis
     * @param {Object} context - Contexto de la conversación
     * @returns {Promise<Object>}
     */
    async processResult(aiResult, context) {
        throw new Error('processResult() debe ser implementado por el agente');
    }

    /**
     * MÉTODOS COMPARTIDOS - Usados por todos los agentes
     */

    /**
     * Ejecuta el agente para una conversación
     * 
     * @param {number} conversationId - ID de la conversación
     * @param {Object} options - Opciones de ejecución
     * @returns {Promise<Object>} - Resultado de la ejecución
     */
    async execute(conversationId, options = {}) {
        console.log(`🤖 Ejecutando agente ${this.agentType} en conversación ${conversationId}`);

        try {
            // 1. Construir contexto
            const context = await this.buildContext(conversationId, options);

            // 2. Validar que hay mensajes
            if (!context.messages || context.messages.length === 0) {
                console.log('⚠️  No hay mensajes para analizar');
                return {
                    success: false,
                    reason: 'no_messages'
                };
            }

            // 3. Analizar con IA
            const analysis = await this.analyzeWithAI(context);

            // 4. Procesar resultado
            const result = await this.processResult(analysis, context);

            console.log(`✅ Agente ${this.agentType} completado exitosamente`);

            return {
                success: true,
                agentType: this.agentType,
                conversationId,
                result
            };
        } catch (error) {
            console.error(`❌ Error en agente ${this.agentType}:`, error.message);
            throw error;
        }
    }

    /**
     * Construye contexto para el análisis
     * 
     * @param {number} conversationId - ID de la conversación
     * @param {Object} options - Opciones
     * @returns {Promise<Object>} - Contexto construido
     */
    async buildContext(conversationId, options = {}) {
        const includeHistory = options.includeHistory !== false; // Default true

        const context = await this.contextBuilder.buildContext(conversationId, {
            includeHistory,
            includeContact: true,
            maxMessages: options.maxMessages || null,
            processMultimedia: true  // Activar procesamiento de multimedia
        });

        // Filtrar mensajes para análisis
        context.filteredMessages = this.contextBuilder.filterMessagesForAnalysis(context.messages);

        return context;
    }

    /**
     * Analiza conversación con IA
     * 
     * @param {Object} context - Contexto de la conversación
     * @returns {Promise<Object>} - Resultado del análisis
     */
    async analyzeWithAI(context) {
        console.log(`🤖 Analizando con IA (modelo: ${this.model})...`);

        try {
            // Preparar prompts
            const systemPrompt = this.getSystemPrompt();
            const userPrompt = this.buildUserPrompt(context);

            // Llamar a OpenAI
            const completion = await this.openai.chat.completions.create({
                model: this.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.3,
                max_completion_tokens: 1500
            });

            const result = JSON.parse(completion.choices[0].message.content);

            console.log('✅ Análisis de IA completado');

            return result;
        } catch (error) {
            console.error('❌ Error en análisis con IA:', error.message);
            throw error;
        }
    }

    /**
     * Actualiza contacto en Chatwoot
     * 
     * @param {number} contactId - ID del contacto
     * @param {Object} currentContact - Contacto actual
     * @param {Object} extractedInfo - Información extraída
     * @param {Object} options - Opciones adicionales
     * @returns {Promise<Object>} - Resultado de actualización
     */
    async updateChatwoot(contactId, currentContact, extractedInfo, options = {}) {
        return await this.crmSync.updateChatwoot(
            contactId,
            currentContact,
            extractedInfo,
            { ...options, agentType: this.agentType }
        );
    }

    /**
     * Sincroniza con RD Station
     * 
     * @param {Object} chatwootContact - Contacto de Chatwoot
     * @param {Object} extractedInfo - Información extraída
     * @param {string} originalEmail - Email original
     * @returns {Promise<Object>} - Resultado de sincronización
     */
    async syncRDStation(chatwootContact, extractedInfo, originalEmail) {
        return await this.crmSync.syncRDStation(
            chatwootContact,
            extractedInfo,
            originalEmail
        );
    }

    /**
     * Sincroniza ambos CRMs
     * 
     * @param {number} contactId - ID del contacto
     * @param {Object} currentContact - Contacto actual
     * @param {Object} extractedInfo - Información extraída
     * @param {Object} options - Opciones
     * @returns {Promise<Object>} - Resultados de sincronización
     */
    async syncBothCRMs(contactId, currentContact, extractedInfo, options = {}) {
        return await this.crmSync.syncBoth(
            contactId,
            currentContact,
            extractedInfo,
            { ...options, agentType: this.agentType }
        );
    }

    /**
     * Crea nota interna en la conversación
     * 
     * @param {number} conversationId - ID de la conversación
     * @param {string} content - Contenido de la nota
     * @param {boolean} isPrivate - Si es nota privada (default: true)
     * @returns {Promise<void>}
     */
    async createInternalNote(conversationId, content, isPrivate = true) {
        try {
            const prefixedContent = `[Agente IA] ${content}`;

            await chatwootClient.sendMessage(conversationId, {
                content: prefixedContent,
                message_type: 'outgoing',
                private: isPrivate
            });

            console.log(`📝 Nota interna creada en conversación ${conversationId}`);

            // Restaurar estado "no leído" para no confundir a operadores humanos
            await chatwootClient.markAsUnread(conversationId);
            console.log(`   ✅ Conversación ${conversationId} marcada como no leída`);
        } catch (error) {
            console.warn('⚠️  No se pudo crear nota interna:', error.message);
        }
    }

    /**
     * Valida si un campo puede actualizarse
     * 
     * @param {string} field - Nombre del campo
     * @param {any} oldValue - Valor actual
     * @param {any} newValue - Nuevo valor
     * @returns {Object} - { allowed: boolean, reason: string }
     */
    validateFieldUpdate(field, oldValue, newValue) {
        return this.fieldProtection.validateUpdate(field, oldValue, newValue);
    }

    /**
     * Aplica reglas de negocio a información extraída
     * 
     * @param {Object} extractedInfo - Información extraída
     * @param {Object} currentContact - Contacto actual
     * @param {Object} previousData - Datos previos (opcional)
     * @returns {Object} - Información validada
     */
    applyBusinessRules(extractedInfo, currentContact, previousData = null) {
        return this.fieldProtection.applyBusinessRules(
            extractedInfo,
            currentContact,
            previousData
        );
    }
}

export default BaseAgent;

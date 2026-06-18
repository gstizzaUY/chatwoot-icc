/**
 * Servicio de análisis de conversaciones usando IA (OpenAI)
 * Extrae información estructurada de conversaciones de manera inteligente
 */

import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

class AIAnalysisService {
    constructor() {
        const apiKey = process.env.OPENAI_API_KEY;
        
        if (!apiKey) {
            console.warn('⚠️  OPENAI_API_KEY no configurada. El análisis con IA está deshabilitado.');
            console.warn('   Se usará análisis básico por regex.');
            this.enabled = false;
            return;
        }

        this.client = new OpenAI({ apiKey });
        this.model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
        this.enabled = true;
        
        console.log(`✅ Servicio de IA inicializado (modelo: ${this.model})`);
    }

    /**
     * Analiza una conversación completa con IA
     * Extrae información estructurada, sentimiento y resumen
     * 
     * @param {Array} messages - Mensajes de la conversación actual
     * @param {Object} currentContact - Contacto actual con sus datos
     * @param {Array} previousConversations - Conversaciones previas del contacto (opcional)
     * @param {Object} multimediaProcessed - Información procesada de multimedia (opcional)
     * @returns {Promise<Object>} - Análisis completo consolidado de todas las conversaciones
     */
    async analyzeConversation(messages, currentContact = {}, previousConversations = [], multimediaProcessed = null) {
        if (!this.enabled) {
            throw new Error('Servicio de IA no está habilitado. Verifica OPENAI_API_KEY en .env');
        }

        try {
            console.log('🤖 Iniciando análisis multi-conversación con IA...');
            
            // PASO 1: Analizar conversaciones previas para extraer información acumulada
            let consolidatedInfo = null;
            let multiChannelContext = null;
            
            if (previousConversations && previousConversations.length > 0) {
                console.log(`📚 Analizando ${previousConversations.length} conversaciones previas...`);
                consolidatedInfo = await this._analyzeAllPreviousConversations(previousConversations, currentContact);
                multiChannelContext = this._buildMultiChannelSummary(consolidatedInfo.conversationsSummaries);
            }
            
            // PASO 2: Preparar el contexto de la conversación actual
            const conversationText = this._formatMessagesForAI(messages, multimediaProcessed);
            
            // PASO 3: Crear el prompt para la IA (con información consolidada de conversaciones previas)
            const systemPrompt = this._buildSystemPrompt();
            const userPrompt = this._buildUserPrompt(
                conversationText, 
                currentContact, 
                consolidatedInfo, 
                multiChannelContext
            );

            console.log('🤖 Enviando conversación actual + contexto multi-canal a IA...');
            
            // PASO 4: Llamar a OpenAI para analizar la conversación actual
            const completion = await this.client.chat.completions.create({
                model: this.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.3,
                max_tokens: 1500 // Aumentado para soportar más contexto
            });

            const result = JSON.parse(completion.choices[0].message.content);
            
            // PASO 5: Consolidar información de conversación actual + conversaciones previas
            const finalResult = this._consolidateInformation(
                result, 
                consolidatedInfo?.extractedFields,
                multiChannelContext
            );
            
            console.log('✅ Análisis multi-conversación completado');
            console.log('🔍 Información consolidada:', {
                email: finalResult.email,
                tiene_ichef: finalResult.tiene_ichef,
                es_cliente: finalResult.es_cliente,
                conversaciones_analizadas: (previousConversations?.length || 0) + 1,
                confidence: finalResult.confidence
            });

            return this._normalizeAIResponse(finalResult);

        } catch (error) {
            console.error('❌ Error en análisis con IA:', error.message);
            throw error;
        }
    }

    /**
     * Formatea los mensajes para enviar a la IA
     * Incluye transcripciones de audio y análisis de imágenes
     * @private
     */
    _formatMessagesForAI(messages, multimediaProcessed = null) {
        const formattedMessages = messages
            // Filtrar solo mensajes con contenido
            .filter(msg => {
                // Incluir si tiene contenido de texto
                if (msg.content && msg.content.trim().length > 0) {
                    return true;
                }
                
                // Incluir si tiene attachments (multimedia)
                if (msg.attachments && msg.attachments.length > 0) {
                    return true;
                }
                
                return false;
            })
            // Filtrar notas automáticas del sistema
            .filter(msg => {
                // Ignorar SOLO notas privadas que son resúmenes automáticos del sistema
                if (msg.private && msg.content_type === 'text') {
                    const isAutoSummary = 
                        msg.content.includes('📋 RESUMEN DE LA CONVERSACIÓN') ||
                        msg.content.includes('Análisis generado automáticamente') ||
                        msg.content.includes('😊 SENTIMIENTO:') ||
                        msg.content.includes('🔍 INFORMACIÓN DETECTADA') ||
                        msg.content.includes('[Agente IA]');
                    
                    return !isAutoSummary;
                }
                return true;
            })
            .map((msg, index) => {
                const sender = msg.message_type === 0 ? 'Cliente' : 'Agente';
                let content = msg.content?.trim() || '';
                const isAgentNote = msg.private ? ' [NOTA PRIVADA AGENTE]' : '';
                
                // Agregar información de multimedia procesada
                if (msg.attachments && msg.attachments.length > 0 && multimediaProcessed) {
                    const multimediaInfo = this._getMultimediaInfoForMessage(msg.id, multimediaProcessed);
                    if (multimediaInfo) {
                        content += (content ? '\n' : '') + multimediaInfo;
                    }
                }
                
                return `[${index + 1}] ${sender}${isAgentNote}: ${content}`;
            })
            .join('\n');
        
        return formattedMessages;
    }

    /**
     * Formatea conversaciones previas para contexto
     * @private
     */
    _formatPreviousConversations(conversations) {
        if (!conversations || conversations.length === 0) {
            return null;
        }

        // Extraer solo resúmenes de conversaciones anteriores (últimas 5)
        const summaries = conversations
            .filter(conv => {
                // Solo conversaciones resueltas con resumen
                return conv.status === 'resolved' && 
                       conv.custom_attributes?.last_conversation_summary;
            })
            .slice(0, 5) // Últimas 5 conversaciones
            .map((conv, index) => {
                const date = new Date(conv.created_at).toLocaleDateString('es-UY');
                const channel = conv.inbox?.name || 'Canal desconocido';
                const summary = conv.custom_attributes.last_conversation_summary;
                
                return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 Conversación anterior #${index + 1}
   📆 Fecha: ${date}
   📱 Canal: ${channel}
   📝 Resumen:
${summary}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
            })
            .join('\n\n');

        return summaries;
    }

    /**
     * Obtiene información de multimedia para un mensaje específico
     * @private
     */
    _getMultimediaInfoForMessage(messageId, multimediaProcessed) {
        if (!multimediaProcessed) return null;
        
        let info = [];
        
        // Buscar transcripciones de audio
        if (multimediaProcessed.transcriptions) {
            multimediaProcessed.transcriptions.forEach(transcript => {
                info.push(`[AUDIO TRANSCRITO]: ${transcript.text}`);
            });
        }
        
        // Buscar análisis de imágenes
        if (multimediaProcessed.imageAnalysis) {
            multimediaProcessed.imageAnalysis.forEach(image => {
                if (image.description) {
                    info.push(`[IMAGEN]: ${image.description}`);
                }
                if (image.contact_info_found && image.email) {
                    info.push(`[INFO DE IMAGEN - Email]: ${image.email}`);
                }
                if (image.contact_info_found && image.mobile_phone) {
                    info.push(`[INFO DE IMAGEN - Teléfono]: ${image.mobile_phone}`);
                }
            });
        }
        
        return info.length > 0 ? info.join('\n') : null;
    }

    /**
     * Analiza todas las conversaciones previas y extrae información consolidada
     * @private
     * @param {Array} conversations - Conversaciones previas
     * @param {Object} currentContact - Contacto actual
     * @returns {Promise<Object>} - Información consolidada de todas las conversaciones
     */
    async _analyzeAllPreviousConversations(conversations, currentContact) {
        const conversationsSummaries = [];
        const extractedFields = {};
        
        // Filtrar solo conversaciones resueltas (últimas 10 para no sobrecargar)
        const resolvedConversations = conversations
            .filter(conv => conv.status === 'resolved')
            .slice(0, 10);
        
        console.log(`📊 Procesando ${resolvedConversations.length} conversaciones previas...`);
        
        for (const [index, conv] of resolvedConversations.entries()) {
            try {
                const date = new Date(conv.created_at).toLocaleDateString('es-UY');
                const channel = conv.inbox?.name || 'Canal desconocido';
                const summary = conv.custom_attributes?.last_conversation_summary || null;
                
                // Si tiene resumen, extraer información directamente del resumen
                if (summary) {
                    // Extraer información estructurada del resumen usando IA
                    const extractedFromSummary = await this._extractInfoFromSummary(summary, channel, date);
                    
                    conversationsSummaries.push({
                        date,
                        channel,
                        summary,
                        extracted: extractedFromSummary
                    });
                    
                    // Acumular campos extraídos (priorizar más recientes)
                    this._mergeExtractedFields(extractedFields, extractedFromSummary, index);
                }
                
                // Delay pequeño para no sobrecargar la API
                if (index < resolvedConversations.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            } catch (error) {
                console.warn(`⚠️  Error analizando conversación previa: ${error.message}`);
                // Continuar con la siguiente conversación
            }
        }
        
        console.log(`✅ Análisis de conversaciones previas completado: ${conversationsSummaries.length} conversaciones procesadas`);
        
        return {
            conversationsSummaries,
            extractedFields
        };
    }

    /**
     * Extrae información estructurada de un resumen de conversación
     * @private
     */
    async _extractInfoFromSummary(summary, channel, date) {
        try {
            const prompt = `Analiza este resumen de una conversación previa y extrae SOLO información factual del contacto que esté explícitamente mencionada.

RESUMEN (Canal: ${channel}, Fecha: ${date}):
${summary}

Extrae SOLO campos que estén EXPLÍCITAMENTE mencionados:
- tiene_ichef: Si menciona tener/usar un iChef → "Sí", si NO lo menciona → null
- es_cliente: Si menciona compra/contexto post-compra → "Sí", si NO lo menciona → null
- email, phone, city, state, country: Solo si están mencionados explícitamente
- Cualquier otro dato mencionado explícitamente

IMPORTANTE: 
- NO INVENTES DATOS
- Si un dato NO está en el resumen, devuelve null
- Devuelve SOLO campos con información verificable

Responde con JSON con los campos detectados.`;

            const completion = await this.client.chat.completions.create({
                model: this.model,
                messages: [
                    { role: 'system', content: 'Eres un extractor preciso de información. SOLO extraes datos explícitamente mencionados.' },
                    { role: 'user', content: prompt }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.1, // Muy bajo para precisión
                max_tokens: 300
            });

            return JSON.parse(completion.choices[0].message.content);
        } catch (error) {
            console.warn(`⚠️  Error extrayendo info de resumen: ${error.message}`);
            return {};
        }
    }

    /**
     * Merge campos extraídos priorizando conversaciones más recientes
     * @private
     */
    _mergeExtractedFields(target, source, priority) {
        for (const [key, value] of Object.entries(source)) {
            if (value === null || value === undefined || value === '') continue;
            
            // Si no existe o la prioridad es mejor (más reciente), actualizar
            if (!target[key] || !target[`${key}_priority`] || priority < target[`${key}_priority`]) {
                target[key] = value;
                target[`${key}_priority`] = priority;
            }
        }
    }

    /**
     * Construye resumen de hallazgos multi-canal
     * @private
     */
    _buildMultiChannelSummary(conversationsSummaries) {
        if (!conversationsSummaries || conversationsSummaries.length === 0) {
            return null;
        }

        const channels = [...new Set(conversationsSummaries.map(c => c.channel))];
        const summary = conversationsSummaries
            .map((conv, index) => {
                const fieldsFound = Object.keys(conv.extracted || {}).filter(k => !k.endsWith('_priority')).length;
                const hasImportantInfo = conv.extracted?.tiene_ichef || conv.extracted?.es_cliente || fieldsFound > 2;
                const indicator = hasImportantInfo ? '🔍' : '📝';
                
                return `${indicator} ${conv.date} (${conv.channel}): ${conv.summary.substring(0, 150)}${conv.summary.length > 150 ? '...' : ''}`;
            })
            .join('\n');

        return {
            channels,
            totalConversations: conversationsSummaries.length,
            summary
        };
    }

    /**
     * Consolida información de múltiples fuentes con priorización
     * @private
     * @param {Object} currentAnalysis - Análisis de conversación actual
     * @param {Object} previousFields - Campos extraídos de conversaciones previas
     * @param {Object} multiChannelContext - Contexto multi-canal
     * @returns {Object} - Información consolidada
     */
    _consolidateInformation(currentAnalysis, previousFields = {}, multiChannelContext = null) {
        const consolidated = { ...currentAnalysis };
        
        // REGLA: Priorizar información de conversación actual, pero preservar campos críticos previos
        const criticalFields = ['tiene_ichef', 'es_cliente', 'id_equipo', 'email', 'phone', 'mobile_phone'];
        
        for (const field of criticalFields) {
            // Si no hay valor en conversación actual pero sí en previas, usar el previo
            if ((!consolidated[field] || consolidated[field] === null) && previousFields[field]) {
                console.log(`📋 Usando ${field} de conversaciones previas: ${previousFields[field]}`);
                consolidated[field] = previousFields[field];
            }
            
            // PROTECCIÓN: tiene_ichef y es_cliente NUNCA retroceden de "Sí"
            if ((field === 'tiene_ichef' || field === 'es_cliente') && previousFields[field] === 'Sí') {
                if (consolidated[field] !== 'Sí') {
                    console.log(`🛡️  Preservando ${field}=Sí de conversaciones previas (no retroceder)`);
                    consolidated[field] = 'Sí';
                }
            }
        }
        
        // Otros campos no críticos: priorizar conversación actual, usar previos solo si están vacíos
        const otherFields = Object.keys(previousFields).filter(k => 
            !criticalFields.includes(k) && 
            !k.endsWith('_priority') &&
            (!consolidated[k] || consolidated[k] === null)
        );
        
        for (const field of otherFields) {
            if (previousFields[field]) {
                consolidated[field] = previousFields[field];
            }
        }
        
        // Agregar contexto multi-canal a metadata
        if (multiChannelContext) {
            consolidated.multi_channel_context = {
                total_conversations: multiChannelContext.totalConversations,
                channels: multiChannelContext.channels,
                summary: multiChannelContext.summary
            };
        }
        
        return consolidated;
    }

    /**
     * Construye el prompt del sistema
     * @private
     */
    _buildSystemPrompt() {
        return `Eres un analista experto de conversaciones para iChef. iChef es una empresa que vende robots de cocina en Uruguay y otros países. iChef tiene un portal de recetas muy completo, actualizado y con ingredientes uruguayos.

Tu tarea es analizar una conversación completa entre un agente humano y un contacto (cliente o prospecto) dentro de Chatwoot que acaba de cerrarse, y extraer información relevante para actualizar el CRM (Chatwoot y RD Station).

CONTEXTO IMPORTANTE: El contacto puede tener conversaciones previas y datos en el sistema. NO dejes que eso influya en tu análisis de ESTA conversación específica. Analiza SOLO lo que se dijo en los mensajes actuales.

OBJETIVOS:
1. Generar un RESUMEN claro y útil de la conversación (OBLIGATORIO, 3-5 líneas)
   - Resume QUÉ preguntó el cliente, QUÉ le respondió el agente, y CUÁL fue el resultado
   - Enfócate en: consulta principal, acciones tomadas, próximos pasos
   - Sé específico: menciona productos, servicios, fechas, compromisos
2. Detectar el SENTIMIENTO del contacto ("positive", "neutral", "negative")
3. Extraer información clave del contacto para el CRM
4. Proporcionar RECOMENDACIONES de acciones a seguir

CAMPOS A EXTRAER:

## Información Básica del Contacto:
- email: Email del contacto
- firstname: Nombre
- lastname: Apellido
- title: Título (Sr., Sra., Dr., etc)
- company: Empresa donde trabaja
- position: Cargo en la empresa
- mobile_phone: Celular
- phone: Teléfono fijo
- website: Página web

## Ubicación:
- address: Dirección completa
- city: Ciudad
- state: Departamento/Estado
- country: País (código: "UY", "AR", "BR", etc)
- zip: Código postal

## Redes Sociales:
- facebook: Usuario de Facebook
- twitter: Usuario de Twitter
- linkedin: Usuario de LinkedIn
- instagram: Usuario de Instagram
- skype: Usuario de Skype

## Información de iChef:
- tiene_ichef: ¿Tiene/usa un equipo iChef? ("Sí" / "No" / null)
  IMPORTANTE: "Sí" si menciona tener, usar o tener acceso a un iChef (propio o de otra persona)
  Ejemplo: "uso el iChef de mi mamá" → tiene_ichef = Sí
  
- es_cliente: ¿ESTA PERSONA específicamente COMPRÓ un iChef? ("Sí" / "No" / null)
  CRÍTICO: "Sí" SOLO si esta persona fue quien compró/pagó
  NO asumir que tiene_ichef = es_cliente
  Ejemplos:
    - "Compré un iChef hace 2 meses" → es_cliente = Sí, tiene_ichef = Sí
    - "Mi hermana me regaló un iChef" → es_cliente = No, tiene_ichef = Sí
    - "Uso el equipo de mi esposo" → es_cliente = No, tiene_ichef = Sí
    - "Recibió el equipo de garantía" → es_cliente = No, tiene_ichef = Sí
    - "Me lo enviaron por garantía" → es_cliente = No, tiene_ichef = Sí
    - "Tengo un iChef en casa" (sin aclarar quién compró) → es_cliente = null, tiene_ichef = Sí
    
- id_equipo: Número de serie del equipo (si lo menciona)
- stage: Etapa del contacto ("lead" / "marketingQualifiedLead" / "salesQualifiedLead" / "opportunity" / "customer")
  REGLAS ESTRICTAS DE STAGE:
  • "customer": OBLIGATORIO si es_cliente = Sí (compró o contexto POST-COMPRA)
  • "opportunity": Si menciona interés activo en comprar, cotización, demo agendada
  • "lead": SOLO si es primera interacción de consulta sin contexto de compra
  • null: En cualquier otro caso (el sistema preservará el stage actual)
  IMPORTANTE: Si detectaste contexto POST-COMPRA → es_cliente = Sí → stage = customer (OBLIGATORIO)
- status_contacto: ("prospect" / "Lead" / "demo_realizada" / "comprador" / "onboarding" / "referente")

## Información Adicional:
- language: Idioma ("es", "pt", etc)
- comments: Notas internas relevantes sobre el cliente o conversación
- client_comments: Comentarios del cliente
- cedula: Cédula de identidad (si la menciona)
- rut: RUT (si lo menciona)

## Encuesta/Preferencias (solo si se menciona):
- enc_experiencia: Experiencia en cocina ("Principiante" / "Intermedio" / "Avanzado")
- enc_gusta_cocinar: ¿Le gusta cocinar? ("si" / "no")
- enc_frecuencia_cocina: Con qué frecuencia cocina
- enc_cantidad_personas_cocina: Para cuántas personas cocina
- enc_condicion_alimenticia: Condiciones alimenticias especiales
- enc_quien_cocina_casa: Quién cocina en casa
- enc_via_se_entero_ichef: Cómo se enteró de iChef

## Análisis:
- sentiment: Sentimiento general ("positive" / "neutral" / "negative")
- sentiment_reason: Explicación breve del sentimiento
- summary: Resumen OBLIGATORIO de la conversación (3-5 líneas, enfocado en: qué pidió, qué se resolvió, próximos pasos)
- customer_intent: Intención principal ("consulta" / "compra" / "soporte" / "reclamo" / "demo" / "referido" / "otro")
- extracted_topics: Array de temas mencionados
- requires_followup: ¿Requiere seguimiento? (true / false)
- confidence: Confianza en la extracción ("low" / "medium" / "high")
- recommendations: Array de 1-3 recomendaciones de acciones a seguir
- previous_conversations_context: Si se proporcionaron conversaciones anteriores, indica:
  • "related": Si la conversación actual está relacionada con alguna anterior (incluye breve explicación)
  • null: Si NO hay relación o NO se proporcionaron conversaciones previas
  • Ejemplo: "related: El cliente continúa con el tema de garantía iniciado hace 2 semanas"

REGLAS IMPORTANTES:
- NO INVENTES DATOS. Si no está explícito o claramente inferido, devuelve null
- No asumas información no mencionada
- Sé preciso y conciso
- Prioriza información útil para ventas y marketing
- Si hay mensajes contradictorios, prioriza los últimos

REGLAS ESPECÍFICAS PARA ICHEF:

🔴 CONTEXTO POST-COMPRA (INDICA QUE YA COMPRÓ):
Si la conversación menciona CUALQUIERA de estos temas → es_cliente = Sí, tiene_ichef = Sí, stage = customer:
  ✓ Factura, facturación, razón social, RUT, dirección de factura
  ✓ Encomienda, envío, entrega, recogida, correo, dirección de entrega
  ✓ Transferencia, comprobante de pago, pago realizado/pendiente
  ✓ Instalación, onboarding, configuración inicial
  ✓ Serial, número de serie, manual del equipo
  ✓ Garantía de su equipo, soporte de su producto
  ✓ Accesorios, piezas del equipo comprado
  ✓ "Mi iChef", "mi equipo", "el que compré"

REGLAS DETALLADAS:
- "tiene_ichef" = Sí: Si EN ESTA CONVERSACIÓN menciona usar/tener/poseer un iChef
- "tiene_ichef" = null: Si EN ESTA CONVERSACIÓN NO menciona nada sobre tener iChef
- "tiene_ichef" = No: SOLO si EN ESTA CONVERSACIÓN dice EXPLÍCITAMENTE que NO tiene iChef

- "es_cliente" = Sí: Si EN ESTA CONVERSACIÓN indica que compró:
  • Dice explícitamente: "compré", "me lo compré", "lo adquirí", "hice la compra", "pagué"
  • O tiene CONTEXTO POST-COMPRA (ver lista arriba) ← CRÍTICO
- "es_cliente" = No: Si dice que NO compró (regalo, garantía de otro, lo compró un familiar)
- "es_cliente" = null: Si NO hay indicios de compra ni contexto post-compra

IMPORTANTE:
- Si detectas CONTEXTO POST-COMPRA → SIEMPRE: es_cliente=Sí, tiene_ichef=Sí, stage=customer
- Si la conversación NO menciona iChef → tiene_ichef=null (NO "No")
- Si NO hay contexto de compra → es_cliente=null (NO "No")
- IGNORAR datos de custom_attributes del sender

REGLAS PARA STAGE (ETAPA COMERCIAL):
🔴 CRÍTICO - LEER ANTES DE ASIGNAR STAGE:
1. Si detectaste CONTEXTO POST-COMPRA → stage = "customer" (OBLIGATORIO)
2. Si es_cliente = Sí → stage = "customer" (OBLIGATORIO)
3. Si menciona interés activo en comprar → stage = "opportunity"
4. Si es primera consulta general → stage = "lead"
5. En cualquier otro caso → stage = null (preserva el actual)

❌ NUNCA asignar "lead" si hay contexto POST-COMPRA
❌ NUNCA asignar null si es_cliente = Sí (debe ser "customer")

FORMATO DE RESPUESTA:
Tu respuesta DEBE ser un objeto JSON válido con TODOS los campos mencionados (usa null si no detectaste el valor).`;
    }

    /**
     * Construye el prompt del usuario
     * @private
     */
    _buildUserPrompt(conversationText, currentContact, consolidatedInfo = null, multiChannelContext = null) {
        let prompt = `Analiza la siguiente conversación y extrae la información solicitada.\n\n`;
        
        if (currentContact.email || currentContact.phone) {
            prompt += `DATOS ACTUALES DEL CONTACTO:\n`;
            if (currentContact.name) prompt += `- Nombre: ${currentContact.name}\n`;
            if (currentContact.email) prompt += `- Email: ${currentContact.email}\n`;
            if (currentContact.phone) prompt += `- Teléfono: ${currentContact.phone}\n`;
            prompt += `\n`;
        }

        // Agregar información consolidada de conversaciones previas
        if (consolidatedInfo && consolidatedInfo.extractedFields) {
            const fields = consolidatedInfo.extractedFields;
            const fieldsWithValue = Object.entries(fields)
                .filter(([key, value]) => !key.endsWith('_priority') && value !== null && value !== undefined && value !== '')
                .map(([key, value]) => `- ${key}: ${value}`)
                .join('\n');
            
            if (fieldsWithValue) {
                prompt += `═══════════════════════════════════════════════════════════════\n`;
                prompt += `📋 INFORMACIÓN CONSOLIDADA DE CONVERSACIONES PREVIAS\n`;
                prompt += `═══════════════════════════════════════════════════════════════\n`;
                prompt += `Este contacto tiene información extraída de ${multiChannelContext?.totalConversations || 'varias'} conversaciones previas en canales: ${multiChannelContext?.channels?.join(', ') || 'múltiples'}.\n\n`;
                prompt += `CAMPOS YA IDENTIFICADOS:\n${fieldsWithValue}\n\n`;
                prompt += `🛡️  IMPORTANTE - REGLAS COMERCIALES:\n`;
                prompt += `- Si "tiene_ichef" = Sí en conversaciones previas → NUNCA cambiar a "No" (una vez que tiene, siempre tiene)\n`;
                prompt += `- Si "es_cliente" = Sí en conversaciones previas → NUNCA cambiar a "No" (una vez cliente, siempre cliente)\n`;
                prompt += `- MANTÉN estos campos críticos si ya están poblados, SALVO que en la conversación actual haya evidencia EXPLÍCITA de cambio\n`;
                prompt += `═══════════════════════════════════════════════════════════════\n\n`;
            }
        }

        // Agregar resumen multi-canal si existe
        if (multiChannelContext && multiChannelContext.summary) {
            prompt += `═══════════════════════════════════════════════════════════════\n`;
            prompt += `📚 HISTORIAL DE CONVERSACIONES (${multiChannelContext.totalConversations} conversaciones)\n`;
            prompt += `═══════════════════════════════════════════════════════════════\n`;
            prompt += multiChannelContext.summary;
            prompt += `\n\n═══════════════════════════════════════════════════════════════\n`;
            prompt += `CONTEXTO:\n`;
            prompt += `- Usa este historial para entender el journey completo del contacto\n`;
            prompt += `- Determina si la CONVERSACIÓN ACTUAL está relacionada con alguna previa\n`;
            prompt += `- Incluye en "previous_conversations_context" si hay relación relevante\n`;
            prompt += `═══════════════════════════════════════════════════════════════\n\n`;
        }

        prompt += `CONVERSACIÓN ACTUAL A ANALIZAR:\n${conversationText}\n\n`;
        prompt += `Responde ÚNICAMENTE con un objeto JSON con los campos especificados.`;

        return prompt;
    }

    /**
     * Normaliza la respuesta de la IA al formato esperado
     * @private
     */
    _normalizeAIResponse(aiResult) {
        return {
            // Información básica
            email: aiResult.email || null,
            firstname: aiResult.firstname || null,
            lastname: aiResult.lastname || null,
            title: aiResult.title || null,
            company: aiResult.company || null,
            position: aiResult.position || null,
            mobile_phone: aiResult.mobile_phone || null,
            phone: aiResult.phone || null,
            website: aiResult.website || null,
            
            // Ubicación
            address: aiResult.address || null,
            city: aiResult.city || null,
            state: aiResult.state || null,
            country: aiResult.country || null,
            zip: aiResult.zip || null,
            
            // Redes sociales
            facebook: aiResult.facebook || null,
            twitter: aiResult.twitter || null,
            linkedin: aiResult.linkedin || null,
            instagram: aiResult.instagram || null,
            skype: aiResult.skype || null,
            
            // Información iChef
            tiene_ichef: aiResult.tiene_ichef || null,
            es_cliente: aiResult.es_cliente || null,
            id_equipo: aiResult.id_equipo || aiResult.serial_number || null,
            stage: aiResult.stage || null,
            status_contacto: aiResult.status_contacto || null,
            
            // Información adicional
            language: aiResult.language || null,
            comments: aiResult.comments || null,
            client_comments: aiResult.client_comments || null,
            cedula: aiResult.cedula || null,
            rut: aiResult.rut || null,
            
            // Encuesta/Preferencias
            enc_experiencia: aiResult.enc_experiencia || null,
            enc_gusta_cocinar: aiResult.enc_gusta_cocinar || null,
            enc_frecuencia_cocina: aiResult.enc_frecuencia_cocina || null,
            enc_cantidad_personas_cocina: aiResult.enc_cantidad_personas_cocina || null,
            enc_condicion_alimenticia: aiResult.enc_condicion_alimenticia || null,
            enc_quien_cocina_casa: aiResult.enc_quien_cocina_casa || null,
            enc_via_se_entero_ichef: aiResult.enc_via_se_entero_ichef || null,
            
            // Metadata
            metadata: {
                confidence: aiResult.confidence || 'medium',
                sources: ['ai_analysis'],
                ai_topics: aiResult.extracted_topics || [],
                customer_intent: aiResult.customer_intent || 'consulta',
                requires_followup: aiResult.requires_followup || false,
                previous_conversations_context: aiResult.previous_conversations_context || null,
                multi_channel_analysis: aiResult.multi_channel_context || null
            },

            // Sentimiento
            sentiment: {
                sentiment: aiResult.sentiment || 'neutral',
                reason: aiResult.sentiment_reason || 'Análisis por IA'
            },

            // Resumen y recomendaciones
            summary: aiResult.summary || 'Conversación analizada con IA',
            recommendations: aiResult.recommendations || []
        };
    }

    /**
     * Verifica si el servicio está habilitado
     */
    isEnabled() {
        return this.enabled;
    }
}

// Exportar instancia singleton
export default new AIAnalysisService();

# Sistema de Agentes IA — Documentación Técnica Unificada

**Versión:** 2.1  
**Última actualización:** Junio 2026

---

## 1. Visión General

El sistema de agentes IA analiza e interviene en conversaciones de Chatwoot en tiempo real y al cierre, utilizando OpenAI (GPT-4o-mini) como motor de razonamiento. Está compuesto por **4 agentes especializados** que cubren el ciclo completo del cliente: captación (nutridor), venta (pre-venta), soporte (post-venta) y resumen post-cierre.

| Agente | Tipo de Intervención | Activación | Canales |
|--------|---------------------|------------|---------|
| **Nutridor** | Mensajes públicos al cliente | Trigger: mensaje del bot pre-atendedor | 23 (con prioridad exclusiva) |
| **Pre-Venta** | Notas internas con sugerencias | Mensaje #1 del cliente, luego cada 3 | 23, 33, 1, 20, 34, 46, 12, 45 |
| **Post-Venta** | Notas internas con diagnóstico | Mensaje #1 del cliente, luego cada 3 | 41, 38 |
| **Resumen** | Análisis completo post-cierre + CRM sync | Conversación pasa a `resolved` | Todos (según contexto) |

---

## 2. Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                    Chatwoot Webhooks                         │
│   ┌───────────────────┐    ┌──────────────────────────┐    │
│   │ message_created   │    │ conversation_status_     │    │
│   │                   │    │ changed                  │    │
│   └─────────┬─────────┘    └────────────┬─────────────┘    │
└─────────────┼──────────────────────────┼──────────────────┘
              │                          │
              ▼                          ▼
   ┌──────────────────────┐   ┌──────────────────────┐
   │ Message Controller   │   │ Webhook Controller   │
   │ message.controller   │   │ webhook.controller   │
   └──────────┬───────────┘   └──────────┬───────────┘
              │                          │
              └──────────┬───────────────┘
                         │
                         ▼
              ┌─────────────────────────┐
              │  Agent Orchestrator     │
              │  processWebhookEvent()  │
              │                         │
              │ 1. Determina inbox_id   │
              │ 2. Mapea canal→agente   │
              │ 3. Verifica exclusión   │
              │ 4. Evalúa triggers      │
              │ 5. Anti-duplicados      │
              │ 6. Ejecuta agente       │
              └─────────────┬───────────┘
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
         ▼                  ▼                  ▼
┌─────────────────┐ ┌─────────────────┐ ┌──────────────────┐
│ NutridorAgent   │ │ PreVentaAgent   │ │ PostVentaAgent   │
│ (público)       │ │ (nota interna)  │ │ (nota interna)   │
│ Chat + Captura  │ │ Sugerencias     │ │ Diagnóstico      │
│ + Consultoría   │ │ comerciales     │ │ soporte          │
└────────┬────────┘ └────────┬────────┘ └────────┬─────────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             │
         ┌───────────────────┴───────────────────┐
         │                                       │
         ▼                                       ▼
┌─────────────────┐                     ┌──────────────────┐
│ BaseAgent       │                     │ Resumen Agent    │
│ (extienden los  │                     │ (conversation-   │
│  3 agentes)     │                     │  analysis.svc)   │
│                 │                     │ Solo al cerrar   │
│ • analyzeWithAI │                     │ Análisis multi-  │
│ • syncBothCRMs  │                     │ conversación     │
│ • buildContext  │                     │ + historial      │
└────────┬────────┘                     └────────┬─────────┘
         │                                       │
         └───────────────┬───────────────────────┘
                         │
            ┌────────────┴─────────────┐
            │                          │
            ▼                          ▼
    ┌───────────────┐          ┌──────────────┐
    │   Chatwoot    │          │  RD Station  │
    │     CRM       │          │     CRM      │
    └───────────────┘          └──────────────┘
```

---

## 3. Estructura de Archivos

```
backend/src/
├── agents/
│   ├── AgentFactory.js                   # Singleton factory de agentes
│   ├── base/
│   │   └── BaseAgent.js                  # Clase base abstracta (OpenAI + CRMs)
│   ├── nutridor/
│   │   ├── NutridorAgent.js              # Bot conversacional (mensajes públicos)
│   │   ├── nutridor.prompts.js           # Prompt de doble rol (captura + consultoría)
│   │   └── product-info.js               # Info de producto iChef para prompt
│   ├── pre-venta/
│   │   ├── PreVentaAgent.js              # Agente comercial (notas internas)
│   │   └── pre-venta.prompts.js          # Prompt de análisis de ventas
│   └── post-venta/
│       ├── PostVentaAgent.js             # Agente de soporte (notas internas)
│       └── post-venta.prompts.js         # Prompt de diagnóstico técnico
│
├── services/
│   ├── agent-orchestrator.service.js     # Orquestador central
│   ├── ai-analysis.service.js            # Cliente OpenAI para análisis
│   ├── conversation-analysis.service.js  # Agente Resumen (post-cierre)
│   ├── shared/
│   │   ├── context-builder.service.js    # Construcción de contexto + multimedia
│   │   ├── crm-sync.service.js           # Sincronización Chatwoot + RD Station
│   │   └── field-protection.service.js   # Reglas de negocio (never-downgrade)
│   └── multimedia/
│       ├── multimedia-processor.service.js  # Coordinador de multimedia
│       ├── audio-transcription.service.js   # Whisper-1 (transcripción)
│       └── image-analysis.service.js        # GPT-4o Vision (análisis)
│
├── controllers/
│   ├── webhook.controller.js             # conversation_status_changed
│   └── message.controller.js             # message_created
│
├── constants/
│   ├── agent.constants.js                # Canales, triggers, rate limits
│   └── multimedia.constants.js           # Límites de multimedia
│
├── clients/
│   ├── chatwoot.client.js                # API Chatwoot
│   └── rdstation.client.js               # API RD Station
│
├── mappers/
│   ├── contact.mapper.js                 # Chatwoot ↔ RD Station
│   └── attachment.mapper.js              # Clasificación de attachments
│
└── utils/
    ├── message-parser.utils.js           # Extracción por regex (fallback)
    ├── email.utils.js                    # Validación/generación de emails
    ├── phone.utils.js                    # Normalización de teléfonos
    └── attachment-downloader.utils.js    # Descarga de multimedia
```

---

## 4. Flujo de Eventos

### 4.1 Mensaje creado (`message_created`)

```
Chatwoot envía webhook → message.controller.js
  │
  ├── Filtra solo mensajes entrantes (message_type === 0) y mensajes trigger en canal 23
  │
  └── AgentOrchestratorService.processWebhookEvent('message_created', payload)
       │
       ├── 1. Determina inbox_id del payload
       ├── 2. CHANNEL_TO_AGENT[inboxId] → agentType
       ├── 3. **Canal 23 (especial):** Verifica prioridad de Nutridor
       │      ├── Si Nutridor está activo o debe activarse → ejecuta Nutridor, bloquea PreVenta
       │      └── Si no → deja pasar a PreVenta
       ├── 4. Verifica EXCLUDED_CONTACT_IDS (conversaciones internas)
       ├── 5. Evalúa triggers:
       │      ├── PreVenta/PostVenta: mensaje #1 + cada 3 del cliente
       │      └── Nutridor: mensaje trigger del bot ("Como no ingresaste ninguna opción...")
       ├── 6. Cache anti-duplicados (60s)
       └── 7. AgentFactory.getAgent(agentType).execute(conversationId)
```

### 4.2 Conversación cerrada (`conversation_status_changed`)

```
Chatwoot envía webhook → webhook.controller.js
  │
  ├── Valida: event === 'conversation_status_changed' && status === 'resolved'
  ├── Responde 202 Accepted inmediatamente
  │
  └── setImmediate → AgentOrchestratorService.executeResumenAgent(conversationId)
       │
       └── ConversationAnalysisService.processClosedConversation()
            │
            ├── 1. Obtiene conversación + mensajes
            ├── 2. Procesa multimedia (audio + imágenes)
            ├── 3. Obtiene contacto + historial previo (hasta 10 conversaciones)
            ├── 4. Analiza con IA (OpenAI) o fallback regex
            ├── 5. Valida calidad de extracción
            ├── 6. Actualiza Chatwoot (custom_attributes + labels)
            ├── 7. Sincroniza RD Station (upsert + evento de conversión)
            └── 8. Crea nota interna con 7 secciones
```

---

## 5. Agentes en Detalle

### 5.1 Nutridor Agent

**Propósito:** Conversar directamente con el cliente para capturar información mientras espera a un agente humano. También actúa como consultor comercial respondiendo preguntas sobre iChef.

**Canal:** 23 (iChef Marty Wpp)

**Mecanismo de activación:**
- El bot pre-atendedor de Chatwoot envía el mensaje trigger: *"Como no ingresaste ninguna opción te derivamos con un asesor humano para una mejor atención."*
- El webhook `message_created` detecta este mensaje en el canal 23 y el orquestador activa al Nutridor.
- **Prioridad:** El canal 23 tiene lógica especial: si el Nutridor debe activarse o ya está activo, **bloquea** al agente de PreVenta.

**Comportamiento:**
- **Doble rol balanceado:** captura de información + consultoría comercial.
- Envía mensajes **públicos** al cliente (no notas internas).
- Hace UNA pregunta conversacional a la vez, nunca como formulario.
- Extrae información del contexto antes de preguntar.
- Se desconecta cuando:
  - Capturó información crítica (nombre, email, ciudad, tiene_ichef).
  - Hizo 5-7 preguntas.
  - El cliente pide explícitamente un humano.
  - Un agente humano responde (detectado por `hasHumanResponded()`).
- Al desconectarse, envía mensaje de despedida cálido y crea nota interna con resumen de lo capturado.

**Rate limit:** Máximo 15 interacciones por conversación, cooldown 30s.

### 5.2 Pre-Venta Agent

**Propósito:** Actuar como copiloto del agente humano de ventas, proporcionando sugerencias de respuestas, detección de señales de compra y extracción de datos del prospecto.

**Canales (8):** 23, 33, 1, 20, 34, 46, 12, 45

**Triggers:** Mensaje inicial del cliente (#1) y luego cada 3 mensajes del cliente.

**Output:** Nota interna privada con:
- Nivel de interés (alto/medio/bajo) con emoji.
- Intención del cliente (consulta/demo/compra/comparación/recetas).
- Señales de compra detectadas.
- Objeciones identificadas.
- Respuesta sugerida (1-2 líneas).
- Preguntas estratégicas recomendadas.
- Acción comercial concreta (agendar_demo, enviar_catalogo, hacer_oferta, dar_seguimiento, capturar_contacto).
- Información extraída de multimedia (transcripciones, imágenes).
- Razón de las sugerencias.

**Rate limit:** Máximo 20 análisis por conversación, cooldown 60s.

### 5.3 Post-Venta Agent

**Propósito:** Ayudar al agente de soporte diagnosticando problemas técnicos, guiando onboarding y capturando información del equipo (serial).

**Canales (2):** 41 (Actualizaciones Firmware), 38 (Experiencias iChef Wpp)

**Triggers:** Mensaje inicial del cliente (#1) y luego cada 3 mensajes del cliente.

**Regla forzada:** En post-venta, `tiene_ichef = "Sí"`, `es_cliente = "Sí"`, `stage = "customer"` siempre.

**Output:** Nota interna privada con:
- Tipo de conversación (onboarding/recetas/problema/garantía).
- Nivel de urgencia (alta/media/baja).
- Satisfacción estimada del cliente.
- Descripción del problema detectado.
- Lo que el cliente ya intentó.
- Temas a abordar.
- Acción recomendada (escalar_tecnico, enviar_tutorial, agendar_llamada, enviar_garantía, guiar_onboarding).
- Serial capturado de multimedia (imágenes de pantalla).

**Rate limit:** Máximo 20 análisis por conversación, cooldown 60s.

### 5.4 Resumen Agent

**Propósito:** Análisis completo al cierre de conversación. Consolida información de la conversación actual + historial previo multi-canal.

**Trigger:** `conversation_status_changed` con `status === "resolved"`.

**Procesamiento:**
1. Obtiene conversación completa + mensajes.
2. Procesa toda la multimedia de mensajes del cliente.
3. Obtiene contacto + conversaciones previas (últimas 10 resueltas).
4. Analiza con IA (incluye contexto multi-canal de conversaciones anteriores).
5. Extrae 50+ campos estructurados.
6. Si la IA falla o no está configurada, usa extracción por regex como fallback.
7. Valida calidad (score mínimo 30/100 para proceder).
8. Actualiza Chatwoot: custom_attributes, labels, nota interna.
9. Sincroniza RD Station: upsert de contacto + evento de conversión.
10. Genera nota interna con 7 secciones (ver abajo).

**Rate limit:** Máximo 1 vez por conversación (solo al cerrar).

---

## 6. Servicios Compartidos

### 6.1 Context Builder (`context-builder.service.js`)

Construye el contexto completo para los agentes:

- Obtiene conversación, mensajes, contacto e historial previo.
- Procesa multimedia (transcripción de audio con Whisper-1, análisis de imágenes con GPT-4o Vision).
- Filtra mensajes: excluye notas automáticas del sistema, incluye attachments.
- Formatea mensajes para IA incluyendo transcripciones e imágenes.
- Cuenta mensajes del cliente (`countIncomingMessages`).
- Solo procesa attachments de mensajes **incoming** (del cliente), nunca del agente.

### 6.2 CRM Sync (`crm-sync.service.js`)

Sincronización coordinada de ambos CRMs:

- `updateChatwoot(contactId, currentContact, extractedInfo)` — Actualiza custom_attributes.
- `syncRDStation(chatwootContact, extractedInfo, originalEmail)` — Upsert + evento de conversión.
- `syncBoth(...)` — Coordina ambas actualizaciones en secuencia.

Maneja cambio de email ficticio → real, generación de email desde teléfono, y protecciones de campos.

### 6.3 Field Protection (`field-protection.service.js`)

Reglas de negocio invariantes aplicadas en 3 capas (prompts IA → validación → sync):

| Regla | Descripción |
|-------|-------------|
| **Never Downgrade** | `tiene_ichef` y `es_cliente` nunca retroceden de "Sí" |
| **Forward Only** | `stage` solo avanza: lead(0) → mql(1) → sql(2) → opportunity(3) → customer(4) |
| **Email Priority** | Email real > email ficticio (@email.com) |
| **Auto-Customer** | Si `es_cliente = "Sí"` → fuerza `stage = "customer"` y `tiene_ichef = "Sí"` |

### 6.4 Multimedia Processor

- **Audio:** OpenAI Whisper-1. Formatos: MP3, M4A, WAV, WebM, OGG. Máx 25MB, 10 audios/conversación.
- **Imágenes:** GPT-4o Vision. Formatos: JPEG, PNG, GIF, WebP, PDF. Máx 20MB, 15 imágenes/conversación.
- Caché de 7 días (MD5 hash de URL) para evitar reprocesamiento.
- Solo procesa contenido enviado por clientes, nunca por agentes.

---

## 7. Configuración

### Variables de Entorno

```env
# OpenAI (obligatorio para agentes IA)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# Chatwoot
CHATWOOT_URL=https://app.chatwoot.com
CHATWOOT_ACCOUNT_ID=2
API_ACCESS_TOKEN=xxx

# RD Station
RD_STATION_CLIENT_ID=xxx
RD_STATION_CLIENT_SECRET=xxx
RD_STATION_REFRESH_TOKEN=xxx

# Rate limiting (desarrollo)
SKIP_RATE_LIMIT=true
```

### Webhooks en Chatwoot

1. **message_created:**
   - URL: `https://{host}/api/v2/webhooks/chatwoot/message-created`
   - Evento: `message_created`

2. **conversation_status_changed:**
   - URL: `https://{host}/api/v2/webhooks/chatwoot/conversation-status-changed`
   - Evento: `conversation_status_changed`

---

## 8. Canales y Mapeo

### Pre-Venta (8 canales)

| ID | Nombre |
|----|--------|
| 23 | iChef Marty Wpp (Nutridor tiene prioridad) |
| 33 | Correo Marty MKT-RD |
| 1 | Correo Marty |
| 20 | Pre-Venta SDR |
| 34 | iChef Center Wpp |
| 46 | iChef MKT Wpp |
| 12 | Correo Comercial |
| 45 | iChef Comercial Wpp |

### Post-Venta (2 canales)

| ID | Nombre |
|----|--------|
| 41 | Actualizaciones Firmware |
| 38 | Experiencias iChef Wpp |

### Nutridor (1 canal, con prioridad)

| ID | Nombre |
|----|--------|
| 23 | iChef Marty Wpp |

---

## 9. Nota Interna Post-Cierre (7 secciones)

Al cerrar una conversación, el Resumen Agent genera una nota con:

1. **Resumen:** 3-5 líneas generadas por IA.
2. **Sentimiento:** Emoji + explicación contextual.
3. **Información detectada:** Solo campos con valor nuevo.
4. **Cambios en Chatwoot:** Formato `valor_anterior → valor_nuevo`.
5. **Multimedia procesada:** Audios transcritos, imágenes analizadas, campos extraídos.
6. **RD Station:** Creado/actualizado, campos enviados, evento de conversión. Si falla: valores pendientes.
7. **Recomendaciones:** Acciones sugeridas por IA o reglas automáticas.
8. **Footer:** Método de análisis (IA/Regex), confianza, score.

---

## 10. Endpoints de la API

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/v2/health` | Health check |
| `POST` | `/api/v2/webhooks/chatwoot/message-created` | Webhook de mensaje nuevo |
| `POST` | `/api/v2/webhooks/chatwoot/conversation-status-changed` | Webhook de cambio de estado |
| `POST` | `/api/v2/webhooks/chatwoot/analyze-conversation` | Análisis manual (testing) |
| `POST` | `/api/v2/webhooks/chatwoot/bulk-analyze` | Análisis en lote |
| `POST` | `/api/v2/webhooks/rdstation/conversion` | Webhook de RD Station |

---

## 11. Logs y Debugging

El sistema produce logs detallados con emojis para trazabilidad:

```
🎯 Orquestador - Procesando evento: message_created
🤖 Agente determinado: pre-venta para inbox 23
📦 Construyendo contexto para conversación 12345...
🖼️  Procesando multimedia en mensajes...
🤖 Ejecutando agente pre-venta en conversación 12345
🤖 Analizando con IA (modelo: gpt-4o-mini)...
✅ Análisis de IA completado
🔍 Pre-Venta - Info extraída: { email: "...", tiene_ichef: "Sí" }
✅ CRMs actualizados con nueva información
📝 Nota interna creada en conversación 12345
✅ Agente pre-venta completado exitosamente
```

### Errores comunes

| Error | Causa | Solución |
|-------|-------|----------|
| `Agente tipo "X" no encontrado` | Agente no registrado en AgentFactory | Verificar `_initializeAgents()` |
| `Trigger conditions not met` | Condiciones de trigger no cumplidas | Ver `AGENT_TRIGGERS` en `agent.constants.js` |
| `OPENAI_API_KEY no configurada` | Falta API key | Configurar en `.env` — agentes no funcionarán sin ella |
| `Rate limit exceeded` | Demasiadas requests | Ajustar `SKIP_RATE_LIMIT=true` en desarrollo |

---

## 12. Comparativa con Documentación Anterior

La documentación `MULTI_AGENT_ARCHITECTURE.md` (raíz del proyecto) describe 3 agentes (PreVenta, PostVenta, Resumen). Este documento unificado refleja el estado actual del código con **4 agentes**, incluyendo el **Nutridor Agent**, que es el único que envía mensajes públicos al cliente y tiene lógica de prioridad sobre el canal 23.

---

## 13. Dependencias

```json
{
  "openai": "^4.x",
  "express": "^4.x",
  "axios": "^1.x",
  "dotenv": "^16.x",
  "express-rate-limit": "^7.x"
}
```

**Modelo IA:** `gpt-4o-mini` (configurable vía `OPENAI_MODEL`).  
**Transcripción:** `whisper-1`.  
**Visión:** `gpt-4o` (Vision).

---

*Documentación generada desde el análisis del código fuente — Junio 2026*

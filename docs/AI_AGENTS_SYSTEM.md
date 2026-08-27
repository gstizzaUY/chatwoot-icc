# Sistema de Agentes IA — Documentación Técnica Unificada

**Versión:** 2.2
**Última actualización:** Agosto 2026
**Estado:** Documento canónico del sistema de agentes IA (coherente con el código fuente)

---

## 1. Visión General

El sistema de agentes IA analiza e interviene en conversaciones de Chatwoot en tiempo real y al cierre, utilizando OpenAI (GPT-4o-mini) como motor de razonamiento. Está compuesto por **4 agentes especializados** que cubren el ciclo completo del cliente: captación (nutridor), venta (pre-venta), soporte (post-venta) y resumen post-cierre.

| Agente | Tipo de Intervención | Activación | Canales |
|--------|---------------------|------------|---------|
| **Nutridor** | Mensajes públicos al cliente | Trigger: mensaje del bot pre-atendedor | 23 (con prioridad exclusiva) |
| **Pre-Venta** | Notas internas (labels) con datos capturados | Mensaje #1 del cliente, luego cada 5 | 23, 33, 1, 20, 34, 46, 12, 45, 54 |
| **Post-Venta** | Notas internas (labels) con diagnóstico | Mensaje #1 del cliente, luego cada 5 | 41, 38 |
| **Resumen** | Análisis completo post-cierre + CRM sync | Conversación pasa a `resolved` | Todos (según contexto) |

> **Nota sobre "notas internas":** La salida de los 4 agentes se materializa como **etiquetas** (`labels`) en la conversación con prefijo `[Agente IA]` (máx 500 caracteres), NO como mensajes privados. Al resolver la conversación, `cleanupAiLabels()` elimina esas etiquetas; la evidencia del análisis queda en el timeline de Chatwoot y en `custom_attributes` del contacto (`last_conversation_summary`).

---

## 2. Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                    Chatwoot Webhooks                         │
│   ┌───────────────────┐    ┌──────────────────────────┐    │
│   │ message_created   │    │ conversation_status_     │    │
│   │                   │    │ changed / conversation_  │    │
│   │                   │    │ updated (status resolved)│    │
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
│ Chat + Captura  │ │ Datos capturados│ │ Diagnóstico      │
│ + Consultoría   │ │ + cambios CRM   │ │ soporte          │
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
│   ├── webhook.controller.js             # conversation_status_changed / conversation_updated
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
       │      ├── PreVenta/PostVenta: mensaje #1 + cada 5 del cliente
       │      └── Nutridor: mensaje trigger del bot ("Como no ingresaste ninguna opción...")
       ├── 6. Cache anti-duplicados (60s)
       └── 7. AgentFactory.getAgent(agentType).execute(conversationId)
```

> **Importante:** En el código los triggers de Pre/Post-Venta están configurados con `everyNMessages: 5` (`agent.constants.js`). La documentación anterior indicaba "cada 3"; el valor actual del código es 5.

### 4.2 Conversación cerrada (`conversation_status_changed` / `conversation_updated`)

```
Chatwoot envía webhook → webhook.controller.js
  │
  ├── Valida: event ∈ {conversation_status_changed, conversation_updated} && status === 'resolved'
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
            └── 8. Crea etiqueta [Agente IA] con resumen (7 secciones)
                 y luego cleanupAiLabels() elimina las etiquetas [Agente IA]
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
- Al desconectarse, envía mensaje de despedida cálido y crea etiqueta [Agente IA] con resumen de lo capturado.

**Control:** La variable `NUTRIDOR_ENABLED` (default `true`) habilita/deshabilita el agente en su totalidad.

### 5.2 Pre-Venta Agent

**Propósito:** Actuar como copiloto del agente humano de ventas. **Estado actual:** las sugerencias de respuesta (respuesta sugerida, interés, señales de compra, acción comercial) están **deshabilitadas** (`SUGGESTIONS_ENABLED = false`). La nota se limita a los **datos capturados** y los **cambios en CRM**, y es **silenciosa** si no hay datos nuevos ni cambios.

**Canales (9):** 23, 33, 1, 20, 34, 46, 12, 45, 54 (54 = ichefuy Instagram)

**Triggers:** Mensaje inicial del cliente (#1) y luego cada 5 mensajes del cliente.

**Output:** Etiqueta `[Agente IA]` con:
- Datos capturados (campos nuevos, sin repetir los ya reportados).
- Ya registrado (campos previamente reportados).
- Cambios en Chatwoot (`valor_anterior → valor_nuevo`).

**Rate limit:** La configuración `AGENT_RATE_LIMITS` (máx 20 análisis/conversación, cooldown 60s) está **declarada pero no aplicada** en el código (ver §6.5).

### 5.3 Post-Venta Agent

**Propósito:** Ayudar al agente de soporte diagnosticando problemas técnicos, guiando onboarding y capturando información del equipo (serial).

**Canales (2):** 41 (Actualizaciones Firmware), 38 (Experiencias iChef Wpp)

**Triggers:** Mensaje inicial del cliente (#1) y luego cada 5 mensajes del cliente.

**Regla forzada:** En post-venta, `tiene_ichef = "Sí"`, `es_cliente = "Sí"`, `stage = "customer"` siempre.

**Output:** Etiqueta `[Agente IA]` con:
- Tipo de conversación (onboarding/recetas/problema/garantía).
- Nivel de urgencia (alta/media/baja).
- Satisfacción estimada del cliente.
- Descripción del problema detectado.
- Lo que el cliente ya intentó.
- Temas a abordar y respuesta/acción sugeridas.
- Serial capturado de multimedia (imágenes de pantalla).
- Cambios en Chatwoot.

**Rate limit:** Configuración declarada pero no aplicada (máx 20, cooldown 60s).

### 5.4 Resumen Agent

**Propósito:** Análisis completo al cierre de conversación. Consolida información de la conversación actual + historial previo multi-canal.

**Trigger:** `conversation_status_changed` o `conversation_updated` con `status === "resolved"`.

**Procesamiento:**
1. Obtiene conversación completa + mensajes.
2. Procesa toda la multimedia de mensajes del cliente.
3. Obtiene contacto + conversaciones previas (últimas 10 resueltas).
4. Analiza con IA (incluye contexto multi-canal de conversaciones anteriores).
5. Extrae 50+ campos estructurados.
6. Si la IA falla o no está configurada, usa extracción por regex como fallback.
7. Valida calidad (score mínimo 30/100 para proceder).
8. Actualiza Chatwoot: custom_attributes, labels, etiqueta resumen.
9. Sincroniza RD Station: upsert de contacto + evento de conversión.
10. Genera etiqueta `[Agente IA]` con 7 secciones (ver §9).

**Costo:** El análisis multi-conversación realiza hasta **10 llamadas OpenAI adicionales** (una por conversación previa, `_analyzeAllPreviousConversations`) con delay de 200ms, además del análisis principal.

**Rate limit:** Máximo 1 vez por conversación (cache de 60s contra duplicados).

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
- Los **videos no se procesan** (decisión de negocio).

### 6.5 Rate Limiting (estado real)

- **`AGENT_RATE_LIMITS`** (`agent.constants.js`) define límites por agente (PreVenta/PostVenta: 20 análisis, cooldown 60s; Nutridor: 15 interacciones, cooldown 30s; Resumen: 1), pero **actualmente NO se aplica** en ningún servicio.
- El único límite activo es el **HTTP rate limiter** de webhooks: **100 requests/minuto por IP** (`ratelimit.middleware.js`), configurable con `SKIP_RATE_LIMIT=true` en desarrollo.

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
RDSTATION_CLIENT_ID=xxx
RDSTATION_CLIENT_SECRET=xxx
RDSTATION_REFRESH_TOKEN=xxx

# Rate limiting (desarrollo)
SKIP_RATE_LIMIT=true

# Nutridor (default: true)
NUTRIDOR_ENABLED=true
```

**Roadmap (sin código aún):** `.env` ya incluye `NOTEBOOKLM_MCP_URL`, `NOTEBOOKLM_URL_COMERCIAL/PREVENTA/POSTVENTA/PORTAL`, `OPENAI_REASONING_EFFORT` y `OPENAI_DASHBOARD_MODEL` como preparación para integración futura con Google NotebookLM (RAG sobre notebooks de iChef) y refinamiento de modelos.

### Webhooks en Chatwoot

1. **message_created:**
   - URL: `https://{host}/api/v2/webhooks/chatwoot/message-created`
   - Evento: `message_created`

2. **conversation_status_changed:**
   - URL: `https://{host}/api/v2/webhooks/chatwoot/conversation-status-changed`
   - Eventos: `conversation_status_changed` (y `conversation_updated` si status es `resolved`)

> La autenticación por tokens de webhook está **deprecada**. La protección actual es rate limiting + validación de payload; se recomienda IP whitelist a nivel de infraestructura.

---

## 8. Canales y Mapeo

### Pre-Venta (9 canales)

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
| 54 | ichefuy (Instagram) |

### Post-Venta (2 canales)

| ID | Nombre |
|----|--------|
| 41 | Actualizaciones Firmware |
| 38 | Experiencias iChef Wpp |

### Nutridor (1 canal, con prioridad)

| ID | Nombre |
|----|--------|
| 23 | iChef Marty Wpp |

### Contactos excluidos

`EXCLUDED_CONTACT_IDS` (`agent.constants.js`) lista contactos internos (conversaciones internas) que los agentes **no** deben procesar.

---

## 9. Etiqueta de Resumen Post-Cierre (7 secciones)

Al cerrar una conversación, el Resumen Agent genera una etiqueta `[Agente IA]` con:

1. **Resumen:** 3-5 líneas generadas por IA.
2. **Sentimiento:** Emoji + explicación contextual.
3. **Información detectada:** Solo campos con valor nuevo.
4. **Cambios en Chatwoot:** Formato `valor_anterior → valor_nuevo`.
5. **Multimedia procesada:** Audios transcritos, imágenes analizadas, campos extraídos.
6. **RD Station:** Creado/actualizado, campos enviados, evento de conversión. Si falla: valores pendientes.
7. **Recomendaciones:** Acciones sugeridas por IA o reglas automáticas.
8. **Footer:** Método de análisis (IA/Regex), confianza, score.

> **Comportamiento intencional:** estas etiquetas `[Agente IA]` son eliminadas por `cleanupAiLabels()` al resolver la conversación. El dato persiste en `custom_attributes.last_conversation_summary` (usado como contexto por agentes futuros) y la evidencia queda en el timeline de Chatwoot.

---

## 10. Endpoints de la API

| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/v2/health` | Health check | No |
| `POST` | `/api/v2/webhooks/chatwoot/message-created` | Webhook de mensaje nuevo (Nutridor/PreVenta/PostVenta) | Rate limit |
| `POST` | `/api/v2/webhooks/chatwoot/conversation-status-changed` | Webhook de cambio de estado (Resumen) | Rate limit |
| `POST` | `/api/v2/webhooks/chatwoot/analyze-conversation` | Análisis manual (testing) | API Key* |
| `POST` | `/api/v2/webhooks/chatwoot/bulk-analyze` | Análisis en lote | API Key* |
| `POST` | `/api/v2/webhooks/rdstation/conversion` | Webhook de RD Station | Rate limit |

\* Actualmente no requiere token (temporal); la ruta está mapeada sin middleware de auth.

**Procesamiento asíncrono:** los webhooks responden `202 Accepted` inmediatamente y procesan en background con `setImmediate()`.

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
| `INVALID_FIELDS` (RD Station) | Campo `cf_*`/`enc_*` no creado en RD | Crear el campo en RD o quitarlo de `RDSTATION_CUSTOM_FIELDS` |

---

## 12. Testing

### Iniciar el servidor

```bash
cd backend
npm run dev     # nodemon, puerto 4001 (o PORT del .env)
npm start       # producción
```

### Health check

```powershell
Invoke-RestMethod -Uri "http://localhost:4001/api/v2/health" -Method Get | ConvertTo-Json -Depth 10
```

### Simular webhook de conversación cerrada (Resumen)

```powershell
$body = @{ event = "conversation_status_changed"; id = 12345; status = "resolved" } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:4001/api/v2/webhooks/chatwoot/conversation-status-changed" -Method Post -Body $body -ContentType "application/json"
```

### Simular webhook de mensaje (PreVenta/PostVenta/Nutridor)

```powershell
$body = @{
    event = "message_created"
    message_type = 0
    content = "Hola, quiero info"
    conversation = @{ id = 12345; inbox_id = 23 }
} | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:4001/api/v2/webhooks/chatwoot/message-created" -Method Post -Body $body -ContentType "application/json"
```

### Análisis manual / en lote

```powershell
$body = @{ conversationId = 12345 } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:4001/api/v2/webhooks/chatwoot/analyze-conversation" -Method Post -Body $body -ContentType "application/json"

$body = @{ conversationIds = @(12345, 12346) } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:4001/api/v2/webhooks/chatwoot/bulk-analyze" -Method Post -Body $body -ContentType "application/json"
```

### Verificación posterior

1. En Chatwoot: custom_attributes del contacto actualizados, labels aplicadas, etiqueta `[Agente IA]`.
2. En RD Station: contacto con campos personalizados y evento de conversión registrado.

---

## 13. Multimedia (resumen)

- **Audio → Whisper-1** (`audio-transcription.service.js`): MP3, M4A, WAV, WebM, OGG; máx 25MB; 10 por conversación; ~$0.006/min.
- **Imágenes/Documentos → GPT-4o Vision** (`image-analysis.service.js`): JPEG, PNG, GIF, WebP, PDF; máx 20MB; 15 por conversación.
- **Caché:** 7 días, clave MD5 de la URL (hasta 1000 entradas).
- **Filtrado:** solo attachments de mensajes **incoming** (del cliente).
- **Integración:** el contexto de los agentes incluye transcripciones e imágenes; la información extraída consolida y actualiza CRMs; la etiqueta de cierre muestra estadísticas multimedia.
- **Errores:** si OpenAI falla, continúa sin multimedia (no bloquea el flujo).

---

## 14. RD Station (resumen)

- **Dos APIs:** Marketing Platform (OAuth2, contactos + eventos de conversión) y CRM API (User Token, deals).
- **Auto-refresh de token:** interceptor de Axios en `rdstation.client.js` (401 → refresh + retry).
- **Campos personalizados:** controlados por `RDSTATION_CUSTOM_FIELDS` en `.env` (por defecto solo `cf_tiene_ichef`). Habilitados y verificados en la cuenta: `cf_address1`, `cf_zip`, `cf_cedula`, `cf_stage`. Los campos `cf_*`/`enc_*` deben existir en RD Station antes de usarse.
- **Eventos de conversación:** se envían a RD Station con el **canal en el identificador** (`conversation-opened-<canal>` y `conversation-closed-<canal>`, ej. `conversation-closed-ichef-center-wpp`):
  - **`conversation-opened`**: se envía cuando la conversación pasa a status `open` (apertura inicial o reapertura), vía webhook `conversation_status_changed`/`conversation_updated`. Deduplicado en memoria (`conversationLastStatus`) para no repetirse con cada `conversation_updated` mientras está abierta.
  - **`conversation-closed`**: lo envía **únicamente el agente Resumen** al cierre (`status: resolved`). Los agentes en tiempo real (PreVenta/PostVenta/Nutridor) **no** envían el evento de cierre (solo sincronizan el contacto).
  - Metadata del evento: `conversation_id`, `inbox_id`, `inbox` (slug), `channel`, `agent`, `sentiment` (+ `tiene_ichef`/`es_cliente` en el cierre).
  - Mapa de canales: `src/constants/inbox.constants.js` (`INBOX_TO_CHANNEL`, helper `getInboxSlug`).
- **Stage → `cf_stage`:** el campo de etapa de RD Station es `cf_stage` (custom field) y se llena con el **valor interno** (ej. `customer`, `lead`, `opportunity`), igual que en los controladores V1. Un cliente se guarda como `customer`.
- **`es_cliente` es solo de Chatwoot:** el atributo `es_cliente` (Sí/No) vive en Chatwoot. **No existe `cf_es_cliente` en RD Station** (nunca existió); el estado "es cliente" se representa en RD con `cf_stage = "customer"`.
- **Reglas de negocio:** `tiene_ichef` (Chatwoot y RD) y `es_cliente` (solo Chatwoot) nunca retroceden; `es_cliente=Sí` fuerza `stage=customer`; generación de email ficticio desde teléfono o Instagram si no hay email válido; **`stage` nunca retrocede en el funnel** (ni en Chatwoot ni en RD): si un contacto ya es `customer`, una conversación posterior sin mención de compra no lo baja a `lead` (validación por `getStageLevel` en `field-protection.service.js` y guards en `crm-sync` y `conversation-analysis`).
- **Resiliencia V2:** rate limit middleware; el fallo de RD no bloquea la actualización en Chatwoot.

> Detalle completo de campos y mapeos en `RDSTATION_CUSTOM_FIELDS.md` y `docs/RD_STATION_API.md`.

---

## 15. Dependencias

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

## 16. Próximas Mejoras (pendientes)

- [ ] Rehabilitar sugerencias del agente PreVenta (`SUGGESTIONS_ENABLED`) cuando se requiera.
- [ ] Aplicar o eliminar `AGENT_RATE_LIMITS` (actualmente sin efecto).
- [ ] Corregir cache anti-duplicados del orquestador (la clave incluye `Date.now()` y nunca detecta duplicados).
- [ ] Refactor del Resumen para reutilizar `crm-sync.service.js` (hoy duplica lógica).
- [ ] Optimizar costo IA del Resumen (hasta 10 llamadas OpenAI por historial).
- [ ] Integración NotebookLM (RAG) — vars de entorno ya preparadas.
- [ ] Caching de resultados, métricas/monitoring, dashboard de performance.
- [ ] Tests unitarios e integración; A/B testing de prompts.

---

*Documentación canónica unificada del sistema de agentes IA — actualizada desde el análisis del código fuente, Agosto 2026.*

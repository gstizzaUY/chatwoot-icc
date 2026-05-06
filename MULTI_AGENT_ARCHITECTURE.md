# Arquitectura Multi-Agente IA - Chatwoot ICC App

## 📋 Descripción General

Sistema de análisis inteligente de conversaciones con 3 agentes especializados que actúan en diferentes etapas del ciclo de vida del cliente:

1. **Pre-Venta Agent**: Asiste en ventas comerciales en tiempo real
2. **Post-Venta Agent**: Ayuda en soporte técnico y onboarding
3. **Resumen Agent**: Consolida información al cerrar conversaciones

## 🏗️ Arquitectura

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
   └──────────┬───────────┘   └──────────┬───────────┘
              │                          │
              └──────────┬───────────────┘
                         │
                         ▼
              ┌─────────────────────────┐
              │  Agent Orchestrator     │
              │                         │
              │ • Determina canal       │
              │ • Valida triggers       │
              │ • Instancia agente      │
              └─────────────┬───────────┘
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
         ▼                  ▼                  ▼
┌─────────────────┐ ┌─────────────────┐ ┌──────────────────┐
│ PreVentaAgent   │ │ PostVentaAgent  │ │ ResumenAgent     │
│                 │ │                 │ │                  │
│ Canales: 8      │ │ Canales: 2      │ │ Trigger: Cierre  │
│ Trigger: Cada   │ │ Trigger: Cada   │ │ Action: Resumen  │
│ 3 mensajes      │ │ 3 mensajes      │ │ completo         │
└────────┬────────┘ └────────┬────────┘ └────────┬─────────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             │
                ┌────────────┴─────────────┐
                │                          │
                ▼                          ▼
        ┌───────────────┐          ┌──────────────┐
        │   Chatwoot    │          │  RD Station  │
        │     CRM       │          │     CRM      │
        └───────────────┘          └──────────────┘
```

## 📁 Estructura de Archivos

```
backend/src/
├── agents/
│   ├── base/
│   │   └── BaseAgent.js                 # Clase abstracta base
│   ├── pre-venta/
│   │   ├── PreVentaAgent.js             # Agente comercial
│   │   └── pre-venta.prompts.js         # Prompts especializados
│   ├── post-venta/
│   │   ├── PostVentaAgent.js            # Agente soporte
│   │   └── post-venta.prompts.js        # Prompts especializados
│   └── AgentFactory.js                   # Factory pattern
│
├── services/
│   ├── shared/
│   │   ├── field-protection.service.js   # Reglas de negocio
│   │   ├── crm-sync.service.js           # Sincronización CRMs
│   │   └── context-builder.service.js    # Constructor de contexto
│   ├── agent-orchestrator.service.js     # Coordinador de agentes
│   └── conversation-analysis.service.js   # Legacy (ResumenAgent)
│
├── constants/
│   └── agent.constants.js                # Configuración de agentes
│
├── controllers/
│   ├── webhook.controller.js             # Webhook conversaciones
│   └── message.controller.js             # Webhook mensajes
│
└── routes/
    └── v2/
        └── webhook.routes.js              # Rutas de webhooks
```

## 🤖 Agentes

### 1. Pre-Venta Agent

**Propósito**: Asistir a agentes humanos en ventas comerciales

**Canales** (8):
- 23, 33, 1, 20, 34, 46, 12, 45

**Triggers**:
- ✅ Mensaje inicial del cliente
- ✅ Cada 3 mensajes del cliente

**Acciones**:
- Extrae información de contacto y comercial
- Detecta nivel de interés (alto/medio/bajo)
- Identifica señales de compra
- Sugiere respuestas comerciales
- Recomienda preguntas estratégicas
- Propone acciones (agendar demo, enviar catálogo, etc.)

**Output**: Nota interna con sugerencias para el agente humano

### 2. Post-Venta Agent

**Propósito**: Ayudar en soporte técnico y onboarding de clientes

**Canales** (2):
- 41, 38

**Triggers**:
- ✅ Mensaje inicial del cliente
- ✅ Cada 3 mensajes del cliente

**Acciones**:
- Identifica tipo de consulta (onboarding/recetas/problema/garantía)
- Evalúa urgencia y satisfacción
- Captura información técnica (serial del equipo)
- Sugiere soluciones o próximos pasos
- Recomienda escalamiento si es necesario

**Output**: Nota interna con análisis y sugerencias

### 3. Resumen Agent (Legacy)

**Propósito**: Consolidar información completa al cerrar conversación

**Trigger**: Conversación cambia a estado "resolved"

**Acciones**:
- Analiza conversación completa + historial
- Extrae 70+ campos de información
- Actualiza ambos CRMs (Chatwoot + RD Station)
- Crea nota interna comprensiva de 7 secciones
- Aplica reglas de negocio estrictas

**Output**: Resumen completo + actualización CRMs

## 🔐 Reglas de Negocio Protegidas

### Campos Never-Downgrade
- `tiene_ichef`: "Sí" → nunca vuelve a "No"
- `es_cliente`: "Sí" → nunca vuelve a "No"

### Campos Forward-Only
- `stage`: Solo puede avanzar en jerarquía:
  - `lead` (0)
  - `opportunity` (1)
  - `customer` (2)

### Reglas Automáticas
1. **Si `es_cliente = "Sí"` → automáticamente**:
   - `stage = "customer"`
   - `tiene_ichef = "Sí"`

2. **Email Priority**:
   - Email real > Email ficticio
   - Busca duplicados en RD Station antes de crear

3. **Stage Protection**:
   - Cliente nunca retrocede a lead/opportunity

## 🎯 Servicios Compartidos

### field-protection.service.js
- `validateUpdate()`: Valida si un campo puede actualizarse
- `applyBusinessRules()`: Aplica reglas de negocio
- `consolidateInformation()`: Merge con protecciones

### crm-sync.service.js
- `updateChatwoot()`: Actualiza contacto en Chatwoot
- `syncRDStation()`: Sincroniza con RD Station
- `syncBoth()`: Coordina ambas actualizaciones

### context-builder.service.js
- `buildContext()`: Construye contexto completo
- `filterMessagesForAnalysis()`: Filtra multimedia y auto-notas
- `formatMessagesForAI()`: Formatea mensajes para IA
- `countIncomingMessages()`: Cuenta mensajes del cliente

## 🔧 Configuración

### Variables de Entorno

```env
# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# Chatwoot
CHATWOOT_API_URL=https://app.chatwoot.com
CHATWOOT_ACCOUNT_ID=123
CHATWOOT_ACCESS_TOKEN=xxx

# RD Station
RD_STATION_CLIENT_ID=xxx
RD_STATION_CLIENT_SECRET=xxx
RD_STATION_REFRESH_TOKEN=xxx
```

### Webhooks en Chatwoot

Configurar 2 webhooks:

1. **message_created**:
   - URL: `https://tu-dominio.com/api/v2/webhooks/chatwoot/message-created`
   - Event: `message_created`

2. **conversation_status_changed**:
   - URL: `https://tu-dominio.com/api/v2/webhooks/chatwoot/conversation-status-changed`
   - Event: `conversation_status_changed`

## 📊 Flujo de Datos

### Mensaje Nuevo (Pre/Post-Venta)

```
1. Cliente envía mensaje
2. Chatwoot → webhook message_created
3. Agent Orchestrator:
   - Identifica canal → agente
   - Cuenta mensajes del cliente
   - Valida trigger (inicial o cada 3)
4. Si trigger cumplido:
   - Instancia agente (Pre/Post-Venta)
   - Construye contexto (conversación + historial)
   - Analiza con IA (GPT-4o-mini)
   - Extrae información
   - Actualiza CRMs si hay info nueva
   - Crea nota interna con sugerencias
5. Agente humano ve sugerencias y actúa
```

### Conversación Cerrada (Resumen)

```
1. Agente cierra conversación
2. Chatwoot → webhook conversation_status_changed
3. Agent Orchestrator:
   - Ejecuta ResumenAgent (legacy)
4. ResumenAgent:
   - Analiza conversación completa
   - Analiza hasta 10 conversaciones previas
   - Consolida información con protecciones
   - Actualiza Chatwoot
   - Sincroniza RD Station (maneja cambios de email)
   - Crea nota comprensiva de 7 secciones
```

## 🚀 Testing

### Endpoint Manual de Análisis

```bash
# Analizar conversación específica
curl -X POST http://localhost:3000/api/v2/webhooks/chatwoot/analyze-conversation \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": 12345
  }'
```

### Simular Webhook

```bash
# Pre-Venta (message_created)
curl -X POST http://localhost:3000/api/v2/webhooks/chatwoot/message-created \
  -H "Content-Type: application/json" \
  -d '{
    "event": "message_created",
    "message_type": 0,
    "conversation": {
      "id": 12345,
      "inbox_id": 23
    }
  }'

# Resumen (conversation closed)
curl -X POST http://localhost:3000/api/v2/webhooks/chatwoot/conversation-status-changed \
  -H "Content-Type: application/json" \
  -d '{
    "event": "conversation_status_changed",
    "id": 12345,
    "status": "resolved"
  }'
```

## 🐛 Debugging

### Logs

Los agentes generan logs detallados:

```
🎯 Orquestador - Procesando evento: message_created
📦 Construyendo contexto para conversación 12345...
🤖 Ejecutando agente pre-venta en conversación 12345
🤖 Analizando con IA (modelo: gpt-4o-mini)...
✅ Análisis de IA completado
🔍 Pre-Venta - Info extraída: {...}
✅ CRMs actualizados con nueva información
📝 Nota interna creada en conversación 12345
✅ Agente pre-venta completado exitosamente
```

### Errores Comunes

1. **"Agente tipo X no encontrado"**:
   - Verifica que el agente esté registrado en `AgentFactory`

2. **"Trigger conditions not met"**:
   - Revisa `AGENT_TRIGGERS` en `agent.constants.js`
   - Verifica conteo de mensajes del cliente

3. **"OPENAI_API_KEY no configurada"**:
   - Configura variable de entorno

## 📈 Próximas Mejoras (Fase 5)

- [ ] Caching de resultados de análisis
- [ ] Rate limiting por agente
- [ ] Métricas y monitoring (Prometheus)
- [ ] Dashboard de performance
- [ ] Tests unitarios e integración
- [ ] Validación de prompts A/B testing

## 📝 Notas Importantes

1. **Triple Protección**: Las reglas de negocio se validan en 3 capas:
   - Prompts de IA
   - field-protection.service.js
   - Validación en sync con RD Station

2. **Prevención de Duplicados**:
   - 60 segundos de debouncing
   - Búsqueda por email anterior antes de crear contacto

3. **Contexto Histórico**:
   - Todos los agentes tienen acceso a conversaciones previas
   - ResumenAgent analiza hasta 10 conversaciones anteriores

4. **Notas Internas**:
   - Pre/Post-Venta: Sugerencias para agente humano
   - Resumen: Análisis comprensivo de 7 secciones

---

**Versión**: 2.0  
**Última actualización**: 2025  
**Desarrollado para**: iChef Uruguay

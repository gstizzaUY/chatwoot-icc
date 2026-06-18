# API v2 - Documentación de Webhooks

## 🎯 Descripción

Sistema de webhooks para automatizar el procesamiento de conversaciones cerradas en Chatwoot. Cuando una conversación se cierra, el sistema:

1. ✅ **Analiza con IA** (opcional): Usa OpenAI GPT para extracción inteligente de información
2. ✅ Extrae información de los mensajes (email, serial, tiene_ichef, es_cliente, ciudad)
3. ✅ Actualiza el contacto en Chatwoot con los datos extraídos
4. ✅ Aplica etiquetas apropiadas (cliente, tiene_ichef, lead, etc.)
5. ✅ Sincroniza el contacto con RD Station
6. ✅ Registra un evento de conversión en RD Station
7. ✅ Agrega una nota interna con el resumen del análisis

### 🤖 Análisis con IA (Nuevo)

El sistema puede analizar conversaciones usando **OpenAI GPT** para comprensión contextual avanzada:

- **Ventaja**: Entiende lenguaje natural, sinónimos, contexto e información implícita
- **Fallback**: Si no está configurado o falla, usa análisis básico por regex
- **Costo**: ~$0.005-0.01 por conversación con `gpt-4o-mini`

**Ver guía completa**: [AI_ANALYSIS_GUIDE.md](./AI_ANALYSIS_GUIDE.md)

---

## ⚙️ Configuración Inicial

### Campos Personalizados de RD Station

**IMPORTANTE**: RD Station requiere que todos los campos personalizados (`cf_*`) estén **creados previamente** en la plataforma antes de poder usarlos en la API.

Por defecto, la aplicación solo envía el campo `cf_tiene_ichef` a RD Station:

```env
# .env
RDSTATION_CUSTOM_FIELDS=cf_tiene_ichef
```

**Para habilitar más campos:**

1. Crea los campos en RD Station (Configurações → Campos personalizados)
2. Agrégalos a tu `.env`:
   ```env
   # Ejemplo con múltiples campos (sin espacios entre comas)
   RDSTATION_CUSTOM_FIELDS=cf_tiene_ichef,cf_es_cliente,cf_chatwoot_id,cf_last_sync_from_chatwoot
   ```
3. Reinicia el servidor

**Ver guía completa**: [RDSTATION_CUSTOM_FIELDS.md](./RDSTATION_CUSTOM_FIELDS.md)

---

## 📋 Endpoints Disponibles

### 1. Webhook de conversación cerrada (PRINCIPAL)

**Endpoint:** `POST /api/v2/webhooks/chatwoot/conversation-status-changed`

**Descripción:** Webhook que recibe eventos de Chatwoot cuando una conversación cambia de estado. Procesa solo conversaciones con status "resolved" (cerradas).

**Autenticación:** ❌ Ninguna (protegido por rate limiting)

**Seguridad:** 
- Rate limiting: 100 requests/minuto
- Recomendado: IP whitelist a nivel de firewall/proxy
- Express configurado con `trust proxy` para identificar IPs correctamente

**Payload esperado:**
```json
{
  "event": "conversation_status_changed",
  "id": 12345,
  "status": "resolved",
  "meta": {
    "sender": {
      "id": 1,
      "name": "Agent Name"
    }
  }
}
```

**Respuesta:**
- `202 Accepted` - La solicitud fue aceptada y se procesará en background
- `400 Bad Request` - Evento no válido o status no es "resolved"
- `429 Too Many Requests` - Rate limit excedido

**Configuración en Chatwoot:**
1. Ir a Settings → Integrations → Webhooks
2. Crear nuevo webhook
3. URL: `https://tu-servidor.com/api/v2/webhooks/chatwoot/conversation-status-changed`
4. Seleccionar evento: "Conversation Status Changed"
5. ~~Agregar header~~ (Ya no se requiere autenticación por token)

---

### 2. Webhook de mensaje creado

**Endpoint:** `POST /api/v2/webhooks/chatwoot/message-created`

**Descripción:** Webhook que recibe eventos cuando se crea un mensaje en Chatwoot. Activa el sistema de agentes IA en tiempo real (Nutridor, Pre-Venta, Post-Venta) según el canal y las condiciones de trigger. Solo procesa mensajes entrantes de clientes (y mensajes trigger del bot en canal 23).

**Autenticación:** ❌ Ninguna (protegido por rate limiting)

**Estado:** ✅ Implementado — activa agentes Nutridor, Pre-Venta y Post-Venta

**Payload esperado:**
```json
{
  "event": "message_created",
  "message_type": 0,
  "content": "Hola, quiero info",
  "conversation": {
    "id": 12345,
    "inbox_id": 23
  }
}
```

**Flujo:** El controlador (`message.controller.js`) filtra mensajes salientes (excepto triggers en canal 23), determina si es incoming, y delega al `AgentOrchestratorService` que evalúa qué agente ejecutar según el canal y los triggers configurados en `agent.constants.js`.

---

### 3. Análisis manual de conversación

**Endpoint:** `POST /api/v2/webhooks/chatwoot/analyze-conversation`

**Descripción:** Endpoint manual para analizar una conversación específica. Útil para testing o re-procesar conversaciones.

**Autenticación:** No requiere (temporal)

**Body:**
```json
{
  "conversationId": 12345
}
```

**Respuesta:**
```json
{
  "success": true,
  "message": "Análisis iniciado",
  "conversationId": 12345
}
```

**Ejemplo con curl:**
```bash
curl -X POST https://tu-servidor.com/api/v2/webhooks/chatwoot/analyze-conversation \
  -H "Content-Type: application/json" \
  -d '{"conversationId": 12345}'
```

---

### 4. Análisis en lote

**Endpoint:** `POST /api/v2/webhooks/chatwoot/bulk-analyze`

**Descripción:** Procesa múltiples conversaciones en lote con delay de 2 segundos entre cada una.

**Autenticación:** No requiere (temporal)

**Body:**
```json
{
  "conversationIds": [12345, 12346, 12347]
}
```

**Respuesta:**
```json
{
  "success": true,
  "message": "Análisis en lote iniciado",
  "count": 3,
  "conversationIds": [12345, 12346, 12347]
}
```

---

### 5. Health Check

**Endpoint:** `GET /api/v2/health`

**Descripción:** Verifica el estado de la API v2.

**Respuesta:**
```json
{
  "success": true,
  "version": "v2",
  "status": "healthy",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "features": {
    "webhooks": true,
    "conversationAnalysis": true,
    "contacts": false,
    "conversations": false,
    "deals": false,
    "campaigns": false,
    "export": false
  }
}
```

---

## 🔧 Configuración

### Variables de entorno requeridas

```bash
# Chatwoot
CHATWOOT_URL=https://contact-center.5vsa59.easypanel.host
CHATWOOT_ACCOUNT_ID=2
API_ACCESS_TOKEN=your_chatwoot_token

# Tokens de webhook (YA NO SE USAN - deprecados)
# Los webhooks están protegidos por rate limiting
# Para mayor seguridad, usar IP whitelist a nivel de infraestructura
# CHATWOOT_WEBHOOK_TOKEN=secret_token_123
# CHATWOOT_MESSAGE_WEBHOOK_TOKEN=secret_token_456

# RD Station
RDSTATION_CLIENT_ID=your_client_id
RDSTATION_CLIENT_SECRET=your_client_secret
RDSTATION_REFRESH_TOKEN=your_refresh_token
RDSTATION_USER_TOKEN=your_user_token
```

Ver [.env.example](../.env.example) para la configuración completa.

---

## 📊 Información extraída de las conversaciones

El sistema busca y extrae automáticamente:

| Campo | Fuente | Método de extracción |
|-------|--------|---------------------|
| **Email** | Mensajes del cliente | Regex: `[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}` |
| **Tiene iChef** | Mensajes del cliente | Keywords: "tengo ichef", "uso ichef", "tenemos iChef" |
| **Es Cliente** | Mensajes del cliente | Keywords: "soy cliente", "somos clientes" |
| **Serial** | Mensajes del cliente | Pattern: números de 9-11 dígitos |
| **Ciudad** | Mensajes del cliente | Lista de ciudades uruguayas |

### Etiquetas aplicadas

- `cliente` - Si es_cliente = "Sí"
- `tiene_ichef` - Si tiene_ichef = "Sí"
- `lead` - Si es_cliente = "No"
- `email_extraido` - Si se extrajo un email
- `info_incompleta` - Si falta información relevante

---

## 🧪 Testing

### 1. Test con curl

```bash
# Simular webhook de conversación cerrada
curl -X POST http://localhost:4000/api/v2/webhooks/chatwoot/conversation-status-changed \
  -H "Content-Type: application/json" \
  -d '{
    "event": "conversation_status_changed",
    "id": 12345,
    "status": "resolved"
  }'
```

### 2. Test con Postman

1. Crear request POST a `/api/v2/webhooks/chatwoot/conversation-status-changed`
2. Body (JSON):
   ```json
   {
     "event": "conversation_status_changed",
     "id": 12345,
     "status": "resolved"
   }
   ```
3. ~~Agregar header~~ (Ya no se requiere autenticación)

### 3. Test manual de conversación

```bash
curl -X POST http://localhost:4000/api/v2/webhooks/chatwoot/analyze-conversation \
  -H "Content-Type: application/json" \
  -d '{"conversationId": 12345}'
```

---

## 🏗️ Arquitectura

```
src/
├── clients/              # Clientes HTTP para APIs externas
│   ├── chatwoot.client.js    # Cliente de Chatwoot
│   └── rdstation.client.js   # Cliente de RD Station
│
├── controllers/          # Controladores de endpoints
│   └── webhook.controller.js # Handlers de webhooks
│
├── services/             # Lógica de negocio
│   └── conversation-analysis.service.js # Análisis de conversaciones
│
├── middleware/           # Middlewares
│   ├── auth.middleware.js        # Autenticación
│   └── ratelimit.middleware.js   # Rate limiting
│
├── mappers/              # Transformación de datos
│   └── contact.mapper.js         # Mapeo Chatwoot ↔ RD Station
│
├── utils/                # Utilidades
│   ├── message-parser.utils.js   # Extracción de info
│   ├── phone.utils.js            # Normalización de teléfonos
│   └── email.utils.js            # Generación/validación de emails
│
└── routes/v2/            # Rutas
    ├── index.js              # Router principal v2
    └── webhook.routes.js     # Rutas de webhooks
```

---

## 📝 Notas técnicas

### Procesamiento asíncrono

Los webhooks responden inmediatamente con `202 Accepted` y procesan en background usando `setImmediate()`. Esto previene timeouts y mejora la experiencia.

### Rate Limiting

- **Webhooks:** 100 requests/minuto
- **Endpoints API:** 100 requests/15 minutos
- Configurable en `src/middleware/ratelimit.middleware.js`

### Retry de tokens

El cliente de RD Station implementa auto-refresh de tokens OAuth2 con retry automático en errores 401.

### Circuit Breaker

RD Station tiene circuit breaker implícito: si falla, el error no bloquea la actualización en Chatwoot.

---

## 🔜 Próximas funcionalidades

- [ ] Endpoints de contactos CRUD
- [ ] Endpoints de conversaciones CRUD
- [ ] Endpoints de deals/oportunidades
- [ ] Sistema de campañas y onboarding
- [ ] Exportación mejorada

---

## 📚 Documentación Relacionada

- [AI_AGENTS_SYSTEM.md](../docs/AI_AGENTS_SYSTEM.md) — Documentación técnica unificada del sistema multi-agente IA
- [AI_ANALYSIS_GUIDE.md](./AI_ANALYSIS_GUIDE.md) — Guía de análisis con IA (OpenAI)
- [MULTI_AGENT_ARCHITECTURE.md](../MULTI_AGENT_ARCHITECTURE.md) — Arquitectura multi-agente (versión anterior, 3 agentes)
- [MULTIMEDIA_IMPLEMENTATION.md](../MULTIMEDIA_IMPLEMENTATION.md) — Soporte multimedia (audio + imágenes)

---

## 🐛 Troubleshooting

### Error: "ValidationError: The 'X-Forwarded-For' header is set..."
✅ **RESUELTO** - Express ahora está configurado con `trust proxy: true` en [app.js](app.js)
- Este error ocurre cuando se usa un reverse proxy (Nginx, Cloudflare, etc.)
- La configuración `trust proxy` permite que Express identifique correctamente la IP del cliente

### Error: "Conversation not found"
- Verificar que el ID de conversación existe en Chatwoot
- Verificar que el `CHATWOOT_ACCOUNT_ID` es correcto

### Error: "RD Station sync failed"
- Verificar credenciales de RD Station en `.env`
- Ejecutar refresh manual de token si es necesario
- Este error no bloquea la actualización en Chatwoot

### Rate limit exceeded (429 Too Many Requests)
- Reducir frecuencia de requests
- Ajustar límites en [ratelimit.middleware.js](middleware/ratelimit.middleware.js)
- En desarrollo: `SKIP_RATE_LIMIT=true` en `.env`
- El límite actual es de 100 requests por minuto por IP

### Seguridad sin tokens
**Pregunta:** ¿Cómo protejo los webhooks sin autenticación por token?

**Respuesta:** Implementa una o más de estas estrategias:
1. **IP Whitelist** - Configura tu firewall/proxy para permitir solo IPs conocidas (Chatwoot, RD Station)
2. **VPN/VPC** - Coloca tu API en una red privada
3. **Rate Limiting** - Ya implementado (100 req/min)
4. **Validación de Payload** - Verifica que los datos tengan el formato correcto
5. **Monitoreo** - Alerta sobre patrones de uso anormales

---

## 📧 Contacto

Para soporte, contactar al equipo de desarrollo.

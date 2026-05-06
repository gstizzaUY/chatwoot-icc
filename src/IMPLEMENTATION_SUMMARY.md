# Sistema de Webhooks v2 - Resumen de Implementación

## ✅ Estado del Proyecto

**Versión:** 2.0  
**Estado:** Implementado (listo para testing)  
**Fecha:** 2024

---

## 📁 Estructura de Archivos Creados

### Rutas
```
backend/src/routes/v2/
├── index.js                    ✅ Router principal v2
└── webhook.routes.js           ✅ Rutas de webhooks
```

### Controladores
```
backend/src/controllers/
└── webhook.controller.js       ✅ Handlers de endpoints de webhooks
```

### Servicios
```
backend/src/services/
└── conversation-analysis.service.js  ✅ Lógica de análisis de conversaciones
```

### Clientes HTTP
```
backend/src/clients/
├── chatwoot.client.js          ✅ Cliente de Chatwoot API
└── rdstation.client.js         ✅ Cliente de RD Station API
```

### Middleware
```
backend/src/middleware/
├── auth.middleware.js          ✅ Autenticación de webhooks y API
└── ratelimit.middleware.js     ✅ Rate limiting
```

### Mappers
```
backend/src/mappers/
└── contact.mapper.js           ✅ Mapeo Chatwoot ↔ RD Station
```

### Utilidades
```
backend/src/utils/
├── message-parser.utils.js     ✅ Extracción de información de mensajes
├── phone.utils.js              ✅ Normalización de teléfonos
└── email.utils.js              ✅ Generación/validación de emails
```

### Constantes
```
backend/src/constants/
└── rdstation.constants.js      ✅ Identificadores de conversión RD Station
```

### Configuración
```
backend/
├── .env.example                ✅ Variables de entorno de ejemplo
└── app.js                      ✅ Integración de rutas v2
```

### Documentación
```
backend/src/
└── README_WEBHOOKS.md          ✅ Documentación completa del sistema
```

---

## 🚀 Endpoints Disponibles

| Método | Endpoint | Descripción | Autenticación |
|--------|----------|-------------|---------------|
| `GET` | `/api/v2/health` | Health check | No |
| `POST` | `/api/v2/webhooks/chatwoot/conversation-status-changed` | Webhook principal (conversación cerrada) | Token |
| `POST` | `/api/v2/webhooks/chatwoot/message-created` | Webhook de mensaje creado | Token |
| `POST` | `/api/v2/webhooks/chatwoot/analyze-conversation` | Análisis manual | No |
| `POST` | `/api/v2/webhooks/chatwoot/bulk-analyze` | Análisis en lote | No |
| `POST` | `/api/v2/webhooks/rdstation/conversion` | Webhook RD Station | Token |

---

## 🔧 Funcionalidades Implementadas

### 1. Análisis Automático de Conversaciones Cerradas
- ✅ Detección automática cuando se cierra una conversación
- ✅ Extracción de información de mensajes:
  - Email del cliente
  - ¿Tiene iChef? (Sí/No)
  - ¿Es cliente? (Sí/No)
  - Serial del equipo
  - Ciudad
- ✅ Validación de calidad de información extraída
- ✅ Análisis de sentimiento

### 2. Actualización en Chatwoot
- ✅ Actualización de custom_attributes del contacto
- ✅ Actualización de email si se detectó uno válido
- ✅ Asignación automática de etiquetas:
  - `cliente` - Si es cliente
  - `tiene_ichef` - Si tiene iChef
  - `lead` - Si no es cliente
  - `email_extraido` - Si se extrajo email
  - `info_incompleta` - Si falta información
- ✅ Nota interna con resumen del análisis

### 3. Sincronización con RD Station
- ✅ Mapeo automático de datos Chatwoot → RD Station
- ✅ Upsert de contacto (crear o actualizar)
- ✅ Generación de email ficticio si no existe
- ✅ Envío de evento de conversión
- ✅ Actualización de lifecycle stage
- ✅ Auto-refresh de tokens OAuth2

### 4. Arquitectura y Calidad de Código
- ✅ Separación de responsabilidades (Controllers, Services, Clients)
- ✅ Reutilización de código (Utils, Mappers)
- ✅ Manejo de errores centralizado
- ✅ Circuit breaker para RD Station
- ✅ Procesamiento asíncrono (setImmediate)
- ✅ Rate limiting
- ✅ Autenticación por tokens
- ✅ Logging estructurado

---

## 📦 Dependencias Instaladas

```json
{
  "express-rate-limit": "^7.x.x"
}
```

**Dependencias existentes utilizadas:**
- `express` - Framework web
- `axios` - Cliente HTTP
- `dotenv` - Variables de entorno
- `cors` - CORS
- `morgan` - Logging HTTP

---

## ⚙️ Configuración Requerida

### Variables de Entorno (.env)

```bash
# Chatwoot
CHATWOOT_URL=https://contact-center.5vsa59.easypanel.host
CHATWOOT_ACCOUNT_ID=2
API_ACCESS_TOKEN=your_chatwoot_token

# Tokens de webhook
CHATWOOT_WEBHOOK_TOKEN=secret_webhook_token
CHATWOOT_MESSAGE_WEBHOOK_TOKEN=secret_message_token

# RD Station
RDSTATION_CLIENT_ID=your_client_id
RDSTATION_CLIENT_SECRET=your_client_secret
RDSTATION_REFRESH_TOKEN=your_refresh_token
RDSTATION_USER_TOKEN=your_user_token
```

### Configuración de Webhooks en Chatwoot

1. Ir a **Settings → Integrations → Webhooks**
2. Crear webhook:
   - **URL:** `https://tu-servidor.com/api/v2/webhooks/chatwoot/conversation-status-changed`
   - **Eventos:** `Conversation Status Changed`
   - **Headers:** `Authorization: Bearer YOUR_CHATWOOT_WEBHOOK_TOKEN`

---

## 🧪 Cómo Probar

### 1. Iniciar el servidor
```bash
cd backend
npm run dev
```

### 2. Verificar health check
```bash
curl http://localhost:4000/api/v2/health
```

### 3. Simular webhook de conversación cerrada
```bash
curl -X POST http://localhost:4000/api/v2/webhooks/chatwoot/conversation-status-changed \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "event": "conversation_status_changed",
    "id": 12345,
    "status": "resolved"
  }'
```

### 4. Analizar conversación manualmente
```bash
curl -X POST http://localhost:4000/api/v2/webhooks/chatwoot/analyze-conversation \
  -H "Content-Type: application/json" \
  -d '{"conversationId": 12345}'
```

---

## 📊 Flujo de Procesamiento

```
┌─────────────────────┐
│   Conversación      │
│    se cierra        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Chatwoot envía      │
│  webhook            │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  webhook.controller │
│  - Valida evento    │
│  - Responde 202     │
│  - Procesa async    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────────┐
│ conversation-analysis.service   │
│ 1. Obtener conversación         │
│ 2. Obtener mensajes             │
│ 3. Obtener contacto             │
│ 4. Extraer información          │
│ 5. Validar calidad              │
│ 6. Determinar etiquetas         │
│ 7. Analizar sentimiento         │
│ 8. Generar resumen              │
└──────────┬──────────────────────┘
           │
           ├──────────────────────┐
           │                      │
           ▼                      ▼
┌────────────────────┐  ┌─────────────────┐
│ Chatwoot           │  │ RD Station      │
│ - Actualizar       │  │ - Mapear datos  │
│   contacto         │  │ - Upsert        │
│ - Aplicar labels   │  │ - Enviar evento │
│ - Agregar nota     │  │                 │
└────────────────────┘  └─────────────────┘
```

---

## 🔜 Próximos Pasos

### Testing
1. ⏳ Probar endpoint de health
2. ⏳ Probar análisis manual de conversación
3. ⏳ Configurar webhook en Chatwoot staging
4. ⏳ Cerrar conversación de prueba y verificar:
   - Actualización en Chatwoot
   - Sincronización con RD Station
   - Nota interna generada
5. ⏳ Verificar logs en consola
6. ⏳ Probar casos edge:
   - Conversación sin mensajes
   - Contacto sin email ni teléfono
   - RD Station caído

### Mejoras Futuras
- [ ] Webhook de mensaje creado (desactivar bot)
- [ ] Dashboard de métricas
- [ ] Retry automático con cola
- [ ] Persistencia de logs en base de datos
- [ ] Notificaciones en caso de error
- [ ] Análisis con IA (GPT/Claude)

---

## 📖 Documentación Adicional

- [API_V2_SPECIFICATION.md](../API_V2_SPECIFICATION.md) - Especificación completa v2
- [README_WEBHOOKS.md](./README_WEBHOOKS.md) - Documentación de webhooks

---

## 🎯 Beneficios de la v2

| Aspecto | v1 (Legacy) | v2 (Nueva) |
|---------|------------|------------|
| **Código duplicado** | 300+ líneas | 0 líneas (reutilización) |
| **Normalización de teléfonos** | 4+ formas diferentes | 1 utilidad centralizada |
| **Manejo de errores** | Inconsistente | Centralizado y estructurado |
| **Autenticación** | Ninguna o básica | Tokens específicos por webhook |
| **Rate limiting** | No | Sí (configurable) |
| **Documentación** | Comentarios dispersos | Completa y centralizada |
| **Testing** | Difícil | Fácil (modular) |
| **Mantenimiento** | Complejo | Simplificado |

---

**Desarrollado por:** gstizza  
**Arquitectura:** Clean Architecture + Service Layer Pattern

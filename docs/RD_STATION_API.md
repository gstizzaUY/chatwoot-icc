# RD Station API — Documentacion de Integracion

## Indice

1. [Arquitectura General](#arquitectura-general)
2. [Autenticacion](#autenticacion)
3. [Endpoints de RD Station que consumimos](#endpoints-de-rd-station-que-consumimos)
4. [Capas de Integracion](#capas-de-integracion)
5. [Flujos de Datos entre Sistemas](#flujos-de-datos-entre-sistemas)
6. [Catálogo Completo de Rutas](#catalogo-completo-de-rutas)

---

## Arquitectura General

El **chatwoot-icc-app** actua como un hub central de integracion que conecta los siguientes sistemas:

| Sistema | Rol | Direccion de datos |
|---------|-----|---------------------|
| **RD Station** | CRM + CDP (Marketing Automation) | Bidireccional |
| **Chatwoot** | Customer Service / Conversaciones | Bidireccional |
| **InConcert** | Contact Center / CRM legacy | Entrada (origen de datos) |
| **Evolution API / Sailbot** | WhatsApp (mensajeria HSM) | Salida (campanas) |
| **OpenAI (GPT-4o-mini)** | AI Agents (analisis de conversaciones) | Interno |
| **WooCommerce** | E-commerce (notificaciones de pedidos) | Entrada |

```
┌──────────────┐     ┌─────────────────────┐     ┌──────────────┐
│  InConcert   │────▶│  chatwoot-icc-app   │◀───▶│  RD Station  │
│  (CRM leg.)  │     │  (Integration Hub)  │     │  (CRM + CDP) │
└──────────────┘     └──────┬──────┬───────┘     └──────────────┘
                            │      │
                   ┌────────┘      └────────┐
                   ▼                        ▼
            ┌──────────┐            ┌──────────────┐
            │ Chatwoot │            │ Evolution API│
            │  (CS)    │            │  (WhatsApp)  │
            └──────────┘            └──────────────┘
```

### Versionado

El proyecto tiene **dos generaciones de codigo** que coexisten:

- **V1 (legacy)**: `routes/` + `controllers/` — Codigo original con manejo manual de tokens, circuit breaker propio, y funciones helper inline.
- **V2 (actual)**: `src/` — Arquitectura modular con clientes singleton, servicios compartidos, y sistema multi-agente de IA.

Ambas capas se comunican con RD Station. La V2 tiende a reemplazar progresivamente la V1.

---

## Autenticacion

RD Station expone **dos APIs diferentes** con metodos de autenticacion distintos:

### A. OAuth2 — Marketing Platform API

Usada para **contactos** y **eventos de conversion** (CDP).

| Variable de entorno | Proposito |
|---------------------|-----------|
| `RDSTATION_URL` | URL base de la API (`https://api.rd.services`) |
| `RDSTATION_CLIENT_ID` | Client ID de la aplicacion OAuth2 |
| `RDSTATION_CLIENT_SECRET` | Client Secret de la aplicacion OAuth2 |
| `RDSTATION_REFRESH_TOKEN` | Refresh token de larga duracion |

**Flujo**:

1. El servidor se autentica con `POST https://api.rd.services/auth/token` usando `grant_type: refresh_token`.
2. RD Station devuelve `{ access_token, refresh_token, expires_in }`.
3. El `access_token` se usa en todas las llamadas subsiguientes via header `Authorization: Bearer <token>`.
4. Cuando el token expira (HTTP 401), se refresca automaticamente.

**Implementaciones**:

| Capa | Archivo | Mecanismo |
|------|---------|-----------|
| V2 | `src/clients/rdstation.client.js` | Axios interceptor: auto-refresh en error 401 |
| V1 | `controllers/rdStationControllers.js` | `executeWithAutoRefresh()`: wrapper con control de concurrencia |

**Concurrencia (V1)**:
- Si multiples requests detectan token expirado al mismo tiempo, solo una hace el refresh.
- Las demas esperan la promesa compartida `refreshTokenPromise`.

### B. User Token — CRM API (Deals/Oportunidades)

Usada para **crear y actualizar oportunidades** en el CRM de RD Station.

| Variable de entorno | Proposito |
|---------------------|-----------|
| `RDSTATION_CRM_URL` | URL base del CRM (`https://crm.rdstation.com`) |
| `RDSTATION_USER_TOKEN` | Token de usuario para la API de Deals |

Se pasa como header `Authorization: Bearer <token>` en cada request al CRM.

---

## Endpoints de RD Station que consumimos

### Marketing Platform API (OAuth2)

Base URL: `https://api.rd.services`

| Metodo | Endpoint | Uso en el proyecto |
|--------|----------|-------------------|
| `POST` | `/auth/token` | Refrescar access token |
| `GET` | `/platform/contacts/email:{email}` | Buscar contacto por email |
| `POST` | `/platform/contacts` | Crear un nuevo contacto |
| `PATCH` | `/platform/contacts/email:{email}` | Actualizar contacto por email (V2) |
| `PATCH` | `/platform/contacts/uuid:{uuid}` | Actualizar contacto por UUID (V1) |
| `POST` | `/platform/events` | Enviar evento de conversion (CDP) |
| `POST` | `/platform/events?event_type=conversion` | Enviar evento de conversion (V2, variante) |

### CRM API (User Token)

Base URL: `https://crm.rdstation.com`

| Metodo | Endpoint | Uso en el proyecto |
|--------|----------|-------------------|
| `POST` | `/deals` | Crear una oportunidad (deal) |
| `PUT` | `/deals/{deal_id}` | Actualizar una oportunidad |
| `GET` | `/api/v1/deals?token=...` | Obtener oportunidades (V1) |

### Payloads de ejemplo

#### Crear/Actualizar contacto

```json
{
  "name": "Juan Perez",
  "email": "juan@email.com",
  "personal_phone": "+59899123456",
  "mobile_phone": "+59899123456",
  "city": "Montevideo",
  "state": "Montevideo",
  "country": "Uruguay",
  "cf_tiene_ichef": "Si",
  "cf_id_equipo": "ABC123",
  "cf_stage": "lead",
  "cf_categoria_contacto": "prospecto",
  "cf_fuente_contacto": "inconcert"
}
```

#### Evento de Conversion (V1)

```json
{
  "event_type": "CONVERSION",
  "event_family": "CDP",
  "payload": {
    "conversion_identifier": "demo",
    "email": "juan@email.com",
    "name": "Juan Perez",
    "personal_phone": "+59899123456",
    "cf_fecha_demo": "2025-12-01",
    "cf_horario_demo": "14:00",
    "cf_local_demo": "Montevideo Centro",
    "cf_source_url": "https://ichef.com.uy/demo",
    "legal_bases": [
      {
        "category": "communications",
        "type": "consent",
        "status": "granted"
      }
    ]
  }
}
```

#### Evento de Conversion (V2)

```json
{
  "event_type": "CONVERSION",
  "event_family": "CDP",
  "payload": {
    "conversion_identifier": "conversation-closed",
    "email": "juan@email.com",
    "tiene_ichef": "Si",
    "es_cliente": "No",
    "conversation_id": 12345
  }
}
```

### Identificadores de conversion definidos

Archivo: `src/constants/rdstation.constants.js`

| Identificador | Proposito |
|---------------|-----------|
| `conversation-closed` | Conversacion cerrada en Chatwoot |
| `conversation-analyzed` | Conversacion analizada por agente IA |
| `lead-qualification` | Lead calificado |
| `lead-contact` | Contacto iniciado |
| `demo-requested` | Demo solicitada |
| `demo-completed` | Demo completada |
| `trial-started` | Prueba iniciada |
| `onboarding-started` | Onboarding iniciado |
| `onboarding-completed` | Onboarding completado |
| `purchase-completed` | Compra completada |
| `contract-signed` | Contrato firmado |
| `webinar-registered` | Registro a webinar |
| `webinar-attended` | Asistencia a webinar |
| `content-downloaded` | Contenido descargado |
| `instagram-message-received` | Mensaje recibido por Instagram |
| `support-ticket-created` | Ticket de soporte creado |
| `support-ticket-resolved` | Ticket de soporte resuelto |

**Mapeo automatico desde etiquetas de Chatwoot**:

| Etiqueta Chatwoot | Conversion RD Station |
|-------------------|----------------------|
| `demo` | `demo-requested` |
| `cliente` | `purchase-completed` |
| `trial` | `trial-started` |
| `webinar` | `webinar-registered` |

---

## Capas de Integracion

### V2 — Arquitectura actual (`src/`)

#### Cliente HTTP: `src/clients/rdstation.client.js`

Cliente singleton con Axios que maneja:

- **Auto-refresh de token**: Interceptor de request agrega `Authorization: Bearer`. Interceptor de response detecta 401 y refresca automaticamente.
- **Operaciones de contacto**: `getContact()`, `createContact()`, `updateContact()`, `upsertContact()`.
- **Eventos de conversion**: `sendConversionEvent(email, identifier, fields)`.
- **CRM Deals**: `createDeal()`, `updateDeal()` (usando autenticacion por User Token separada).

#### Servicio de sincronizacion: `src/services/shared/crm-sync.service.js`

Orquesta la sincronizacion bidireccional Chatwoot ↔ RD Station:

1. **`updateChatwoot(contactId, current, extracted, options)`**: Actualiza campos en Chatwoot aplicando reglas de negocio (`field-protection.service.js`).
2. **`syncRDStation(chatwootContact, extractedInfo, originalEmail)`**: Mapea y sincroniza a RD Station via `upsertContact()`, luego registra evento de conversion.
3. **`syncBoth(contactId, current, extracted, options)`**: Ejecuta ambos pasos secuencialmente (Chatwoot primero, luego RD Station).

**Reglas de negocio aplicadas**:

- `tiene_ichef` y `es_cliente` **nunca pueden retroceder** (si ya son "Si" en RD Station, no se sobreescriben con otro valor).
- Si `es_cliente === 'Si'`, se fuerza `stage = 'customer'`.
- Si no hay email valido, se genera uno falso desde telefono (`<numero>@email.com`) o Instagram (`<source_id>@email.com`).

**Kickoff del Agente Resumen**: El `agent-orchestrator.service.js` llama a `crm-sync.service.js` para actualizar ambos CRMs con los datos extraidos por los agentes de IA.

#### Constantes: `src/constants/rdstation.constants.js`

Define los identificadores de conversion y la funcion `getConversionFromLabels()` que mapea etiquetas de Chatwoot a eventos de RD Station.

#### Webhooks entrantes: `src/routes/v2/webhook.routes.js`

| Ruta | Proposito |
|------|-----------|
| `POST /api/v2/webhooks/rdstation/conversion` | Recibe eventos de conversion desde automatizaciones de RD Station |

### V1 — Codigo legacy (`controllers/rdStationControllers.js`)

Controlador monolitico (~2400 lineas) que contiene:

- **`findContactByEmail()`**: Busca contacto en RD Station por email (con retry).
- **`createContact()`**: Crea contacto con +50 campos personalizados y validacion de opciones predefinidas. Luego sincroniza con Chatwoot.
- **`updateContact()`**: Actualiza contacto por UUID con validacion de campos. Luego sincroniza con Chatwoot.
- **`createConversionEvent()`**: Envia evento de conversion con datos de demo.
- **`importarContactos()`**: Handler de ruta que busca o crea contacto, y condicionalmente registra evento de demo.
- **`actualizarContacto()`**: Handler de ruta que actualiza contacto desde webhook de InConcert.
- **`registrarDemo()`**: Handler que procesa registros de demo (crea/actualiza contacto + evento).
- **Circuit breaker**: 5 fallos consecutivos de servidor → bloquea requests por 5 minutos.
- **Retry con backoff**: Maximo 5 reintentos con delay exponencial (1s → 2s → 4s → 8s → 16s, max 30s).
- **`executeWithAutoRefresh()`**: Wrapper que detecta 401, refresca token, y reintenta.

#### Otros controladores V1 relacionados

| Controlador | Proposito |
|-------------|-----------|
| `controllers/rdStationToInconcertControllers.js` | Recibe leads de RD Station y los reenvia a InConcert |
| `controllers/rdOpportunityController.js` | CRUD de oportunidades en el CRM de RD Station |
| `controllers/registerContactController.js` | Registra contactos en RD Station desde eventos de Chatwoot |
| `controllers/referidosController.js` | Logica de referidos (lee/escribe `cf_referidos` en RD Station) |

### Mecanismos de resiliencia

| Mecanismo | Capa | Descripcion |
|-----------|------|-------------|
| Circuit Breaker | V1 | 5 fallos → abierto 5 min. Previene hammering. |
| Retry con backoff | V1 | Hasta 5 reintentos. Delay: 1s→2s→4s→8s→16s. +5s si es rate limit. |
| Rate limit middleware | V2 | `webhookLimiter` aplicado a todos los webhooks. |
| Auto-refresh token | V1 + V2 | Interceptor (V2) o wrapper (V1) que refresca en 401. |
| Concurrencia de refresh | V1 | `refreshTokenPromise` compartida evita race conditions. |

---

## Flujos de Datos entre Sistemas

### Flujo 1: InConcert → RD Station (Importacion de contactos)

```
InConcert (CRM legacy)
    │ webhook: contact_created / contact_updated
    ▼
POST /api/rd-station/importar-contactos
POST /api/rd-station/actualizar-contacto
    │
    │ 1. Buscar contacto en RD Station por email
    │ 2. Si existe → PATCH /platform/contacts/uuid:{uuid}
    │ 3. Si no existe → POST /platform/contacts
    │ 4. Si tiene Demo_Fecha_Hora futura → POST /platform/events (conversion)
    │
    ▼
RD Station (CRM + CDP)
    │
    │ (syncContactToChatwoot: crear/actualizar en Chatwoot tambien)
    ▼
Chatwoot
```

### Flujo 2: Chatwoot → RD Station (Cierre de conversacion)

```
Chatwoot
    │ webhook: conversation_status_changed (status=resolved)
    ▼
POST /api/v2/webhooks/chatwoot/conversation-status-changed
    │
    │ 1. Responde 202 Accepted inmediatamente
    │ 2. Background: agentOrchestratorService.executeResumenAgent()
    │    a. AI analiza la conversacion (GPT-4o-mini)
    │    b. Extrae: tiene_ichef, es_cliente, id_equipo, stage, datos de contacto
    │    c. crm-sync.service.js → syncBoth()
    │       - updateChatwoot(): Actualiza campos en Chatwoot con protecciones
    │       - syncRDStation(): Upsert en RD Station + evento conversion-closed
    ▼
RD Station (contacto actualizado + evento de conversion)
```

### Flujo 3: RD Station → InConcert (Leads inbound)

```
RD Station (automatizacion)
    │ webhook saliente configurado en RD
    ▼
POST /api/rd-to-inconcert/masterclass-sushi
POST /api/rd-to-inconcert/demo-online
    │
    │ Transforma datos de RD Station a formato InConcert
    │ POST a INCONCERT_URL con serviceToken y contactData
    ▼
InConcert (crea/actualiza contacto para gestion SDR)
```

### Flujo 4: RD Station → Chatwoot (Conversion entrante)

```
RD Station (automatizacion)
    │ webhook: evento de conversion
    ▼
POST /api/v2/webhooks/rdstation/conversion
    │ Body: { leads: [{ email, name, ... }] }
    │ Responde 202, procesa en background
    │ (Actualmente en desarrollo — TODO implementar sync a Chatwoot)
    ▼
[Procesamiento de lead]
```

### Flujo 5: Instagram → RD Station (Sync periodico)

```
Script: backend/scripts/sync-instagram-to-rdstation.js
    │ 1. Obtiene contactos de Instagram desde Chatwoot
    │ 2. Filtra los que no tienen email
    │ 3. Genera email falso desde source_id
    │ 4. Upsert en RD Station via rdstation.client.js
    ▼
RD Station
```

### Flujo 6: WhatsApp HSM Campaigns (RD Station → WhatsApp)

```
[Disparador externo o manual]
    │
    ▼
POST /api/v2/hsm/referidos-dia-madre
POST /api/v2/hsm/promo-expo-bebe-2026
POST /api/v2/hsm/ciber-lunes-2026
    │ ... (7+ campanas HSM)
    │
    │ 1. Recibe lista de leads (desde RD Station u otra fuente)
    │ 2. Envia mensajes WhatsApp via Evolution API / Sailbot
    ▼
Evolution API → WhatsApp del cliente
```

### Flujo 7: Oportunidades CRM

```
[InConcert o manual]
    │
    ▼
POST /api/conversations/create-opportunity
    │
    │ POST https://crm.rdstation.com/deals
    ▼
RD Station CRM (oportunidad creada)

POST /api/conversations/update-opportunity-stage
    │
    │ PUT https://crm.rdstation.com/deals/{id}
    ▼
RD Station CRM (etapa actualizada)
```

---

## Catalogo Completo de Rutas

Todas las rutas relacionadas con RD Station y sus integraciones.

### V1 — `/api/rd-station/*`

Base: `POST /api/rd-station`

| Metodo | Ruta | Controlador | Proposito |
|--------|------|-------------|-----------|
| `POST` | `/api/rd-station/` | - | Echo — devuelve los datos recibidos |
| `POST` | `/api/rd-station/importar-contactos` | `importarContactos` | Importa/actualiza contacto en RD Station desde InConcert. Si tiene demo futura, registra evento de conversion. Sincroniza con Chatwoot. |
| `POST` | `/api/rd-station/actualizar-contacto` | `actualizarContacto` | Actualiza contacto en RD Station desde webhook de InConcert. Si no existe, lo crea. Registra evento de demo si aplica. |
| `POST` | `/api/rd-station/registro-demo` | `registrarDemo` | Registra una demo: busca/crea contacto + envia evento de conversion (`demo` o `demo-antel`). |
| `POST` | `/api/rd-station/expo-dgusto` | `expoDgusto` | Procesa leads del evento Expo D'Gusto. |
| `POST` | `/api/rd-station/lead-popup-tonga` | `leadPopupTonga` | Procesa leads del popup landing iChef x Tonga. |
| `POST` | `/api/rd-station/test-conversion-event` | `testConversionEvent` | Endpoint de testing para eventos de conversion. |
| `GET` | `/api/rd-station/status` | - | Estado del sistema: credenciales, circuit breaker, health. Responde 200 si healthy, 503 si unhealthy. |
| `POST` | `/api/rd-station/reload-credentials` | - | Recarga credenciales desde variables de entorno. |
| `POST` | `/api/rd-station/onboarding/hsm/starter-pack` | `onboardingHsmStarterPack` | Envia WhatsApp HSM para onboarding starter pack. |
| `POST` | `/api/rd-station/onboarding/:etapa` | `onboarding` | Maneja etapas del onboarding (V1). |
| `POST` | `/api/rd-station/onboarding-provisorio/:etapa` | `onboarding` | Version provisoria del onboarding. |
| `POST` | `/api/rd-station/hsm/webinar-vitel-tone` | `hsmWebinar` | Envia WhatsApp HSM para webinar Vitel Tone. |
| `POST` | `/api/rd-station/hsm/evolution/saludo-fin-ano-2025` | `saludoFinAno2025` | Envia WhatsApp HSM para saludo fin de ano 2025. |
| `POST` | `/api/rd-station/nh2025101735` | `actualizacionFirmwareNh2025101735` | Notifica actualizacion de firmware via Chatwoot/WhatsApp. |

### V1 — `/api/rd-to-inconcert/*`

| Metodo | Ruta | Controlador | Proposito |
|--------|------|-------------|-----------|
| `POST` | `/api/rd-to-inconcert/masterclass-sushi` | `masterSushi` | Recibe leads de RD Station y los reenvia a InConcert para la campana Masterclass Sushi. |
| `POST` | `/api/rd-to-inconcert/demo-online` | `demoOnline` | Recibe leads de RD Station y los reenvia a InConcert para Demo Online. |

### V1 — `/api/conversations/*` (rutas relacionadas con RD Station)

| Metodo | Ruta | Controlador | Proposito |
|--------|------|-------------|-----------|
| `POST` | `/api/conversations/new-contact` | `registerContactController` | Registra un nuevo contacto en RD Station desde una conversacion de Chatwoot. |
| `GET` | `/api/conversations/get-contact` | - | Proxy: obtiene un contacto de RD Station por email. |
| `GET` | `/api/conversations/get-opportunity` | `rdOpportunityController` | Obtiene una oportunidad del CRM de RD Station. |
| `POST` | `/api/conversations/update-contact` | - | Actualiza un contacto en RD Station desde Chatwoot. |
| `POST` | `/api/conversations/register-contact` | - | Registra un usuario de iChef en RD Station. |
| `POST` | `/api/conversations/update-opportunity-stage` | `rdOpportunityController` | Actualiza la etapa de una oportunidad en RD Station CRM. |
| `POST` | `/api/conversations/create-opportunity` | `rdOpportunityController` | Crea una nueva oportunidad en RD Station CRM. |
| `POST` | `/api/conversations/migrate/:stage` | `migrateOpportunityController` | Migra una oportunidad de etapa en RD Station CRM. |
| `PUT` | `/api/conversations/register-event` | - | Registra un evento de conversion en RD Station. |

### V2 — Webhooks (`/api/v2/webhooks/*`)

| Metodo | Ruta | Controlador | Auth | Proposito |
|--------|------|-------------|------|-----------|
| `POST` | `/api/v2/webhooks/chatwoot/conversation-status-changed` | `conversationStatusChanged` | Rate limit | Chatwoot notifica cambio de estado. Si status=resolved, dispara agente Resumen → extrae datos → sincroniza Chatwoot + RD Station. |
| `POST` | `/api/v2/webhooks/chatwoot/message-created` | `messageCreated` | Rate limit | Chatwoot notifica nuevo mensaje. Dispara agentes Nutridor/PreVenta/PostVenta. |
| `POST` | `/api/v2/webhooks/chatwoot/analyze-conversation` | `analyzeConversation` | API Key | Analisis manual de una conversacion (testing). |
| `POST` | `/api/v2/webhooks/chatwoot/bulk-analyze` | `bulkAnalyzeConversations` | API Key | Analisis en lote de multiples conversaciones. |
| `POST` | `/api/v2/webhooks/rdstation/conversion` | `rdStationConversion` | Rate limit | Recibe eventos de conversion desde RD Station. Procesa leads en background. |

### V2 — Otras rutas relevantes

| Metodo | Ruta | Proposito |
|--------|------|-----------|
| `GET` | `/api/v2/health` | Health check con feature flags. |
| `POST` | `/api/v2/oportunidad/abierta` | Abre una conversacion en Chatwoot desde oportunidad de RD Station. |
| `POST` | `/api/v2/export/contacts` | Exporta contactos. |
| `GET` | `/api/v2/export/contacts/status/:jobId` | Estado de exportacion de contactos. |
| `GET` | `/api/v2/export/contacts/download/:jobId` | Descarga exportacion de contactos. |
| `POST` | `/api/v2/hsm/*` | 7 endpoints de campanas HSM (WhatsApp). |

### Campos personalizados de RD Station (`cf_*`)

Lista completa de campos personalizados mapeados en el proyecto:

| Campo RD Station | Origen | Descripcion |
|------------------|--------|-------------|
| `cf_id_inconcert` | InConcert | ID del contacto en InConcert |
| `cf_tiene_ichef` | Chatwoot / InConcert | Indica si el contacto tiene el producto iChef (Si/No). Protegido: nunca retrocede. |
| `cf_id_equipo` | Chatwoot / InConcert | ID del equipo iChef |
| `cf_stage` | InConcert / Chatwoot | Etapa del lead en el funnel (lead / mql / sql / opportunity / customer). Cliente = `customer`. Nunca retrocede. |
| `cf_categoria_contacto` | InConcert | Categoria: lead, cliente, prospecto, otro |
| `cf_fuente_contacto` | InConcert | Fuente de origen del contacto |
| `cf_cedula` | InConcert | Documento de identidad |
| `cf_rut` | InConcert | RUT (Uruguay) |
| `cf_local_demo` | Demo | Local donde se realiza la demo |
| `cf_demo_fecha_hora` | Demo | Fecha y hora de la demo |
| `cf_demo_fecha_hora_utc` | Demo | Fecha y hora UTC de la demo |
| `cf_direccion_demo` | Demo | Direccion de la demo |
| `cf_owner` | InConcert | ID del owner/SDR asignado |
| `cf_owner_name` | InConcert | Nombre del owner/SDR |
| `cf_referente` | Referidos | Indica si es referente |
| `cf_token_invitado` | Referidos | Token de invitacion |
| `cf_cupon_url` | InConcert | URL del cupon |
| `cf_importado_px` | InConcert | Indica si fue importado desde otro sistema |
| `cf_participo_sdr` | InConcert | Participacion en flujo SDR |
| `cf_estado_sdr` | InConcert | Estado en el flujo SDR |
| `cf_enc_*` | Encuestas | Campos de encuestas (gustos, experiencia, etc.) |
| `cf_fecha_demo` | Eventos | Fecha del evento de conversion |
| `cf_horario_demo` | Eventos | Horario del evento de conversion |
| `cf_source_url` | Eventos | URL de origen del evento |
| `cf_calendar_id` | Eventos | ID del calendario de la demo |

### Variables de entorno requeridas

```env
# RD Station — Marketing Platform (OAuth2)
RDSTATION_URL=https://api.rd.services
RDSTATION_CLIENT_ID=<client_id>
RDSTATION_CLIENT_SECRET=<client_secret>
RDSTATION_REFRESH_TOKEN=<refresh_token>

# RD Station — CRM (User Token)
RDSTATION_CRM_URL=https://crm.rdstation.com
RDSTATION_USER_TOKEN=<user_token>

# Chatwoot
CHATWOOT_URL=https://contact-center.5vsa59.easypanel.host
CHATWOOT_ACCOUNT_ID=2
API_ACCESS_TOKEN=<chatwoot_token>

# InConcert
INCONCERT_URL=https://mas-ichef.inconcertcc.com/public/integration/process
INCONCERT_CREATE_CONTACT_TOKEN=<token>

# Evolution API (WhatsApp)
EVOLUTION_APIKEY=<api_key>

# OpenAI (AI Agents)
OPENAI_API_KEY=<openai_key>
```

---

## Scripts y herramientas auxiliares

| Script | Proposito |
|--------|-----------|
| `scripts/sync-instagram-to-rdstation.js` | Sincroniza contactos de Instagram desde Chatwoot a RD Station |
| `scripts/woocommerce-whatsapp-events/woocommerce-whatsapp-events.php` | PHP que envia notificaciones de pedidos WooCommerce via WhatsApp |
| `scripts/register-all.mjs` | Registro masivo de contactos |
| `scripts/reauth.mjs` | Re-autenticacion OAuth2 con RD Station |

---

*Documento generado el 30 de julio de 2026. Basado en el codigo del backend chatwoot-icc-app.*

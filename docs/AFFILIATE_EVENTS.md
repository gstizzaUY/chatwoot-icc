# Eventos de Afiliados — Hub

**Fase:** 1 — base de ingesta, autenticación, persistencia e idempotencia.  
**Estado:** endpoint y store implementados; los handlers de negocio se incorporan en fases posteriores.

## Endpoint

```http
POST /api/v2/affiliates/events
```

Headers:

```http
Content-Type: application/json
x-webhook-secret: <AFFILIATE_EVENTS_SECRET>
```

La autenticación usa `authenticateSharedSecret` con la variable
`AFFILIATE_EVENTS_SECRET`.

## Feature flag

```env
AFFILIATE_EVENTS_ENABLED=false
```

- `false`: responde `202` con `disabled: true` y no persiste ni procesa.
- `true`: registra el evento y lo procesa en background.

## Eventos internos aceptados

```text
seller.created
seller.updated
seller.lover_linked
lead.created
lead.seller_assigned
lead.seller_confirmed
lead.seller_reassigned
```

El evento debe incluir como mínimo:

```json
{
  "event_id": "lead:123:assigned:1800:2026-11-02T12:00:00Z",
  "event_name": "lead.seller_assigned",
  "source": "wordpress_admin",
  "occurred_at": "2026-11-02T12:00:00Z",
  "lead": {},
  "lover": {},
  "seller": {},
  "assignment": {}
}
```

`event_id` es obligatorio y es la clave de idempotencia.

## Respuestas

| Caso | HTTP | Resultado |
|---|---:|---|
| Evento aceptado | `202` | `accepted: true` |
| Evento duplicado en proceso/procesado | `202` | `duplicate: true` |
| Flag desactivado | `202` | `disabled: true` |
| Falta `event_id`, `event_name` o nombre inválido | `400` | Error de contrato |
| Secreto inválido | `401` | Error de autenticación |
| Error persistente | `500` | WordPress debe reintentar |

## Estado

```http
GET /api/v2/affiliates/events/:eventId
```

Mismo secreto. Devuelve el registro persistido para soporte e idempotencia.

## Persistencia

Por defecto:

```text
backend/data/affiliate-events.json
```

Configurable:

```env
AFFILIATE_EVENT_STORE_PATH=./data/affiliate-events.json
```

Estados:

```text
received
processing
pending_handler
processed
failed
```

En Fase 1 los handlers de negocio todavía no están implementados. Los eventos
quedan en `pending_handler` para poder reintentarlos en las fases siguientes.

## Archivos

```text
src/routes/v2/affiliate.routes.js
src/controllers/affiliateEvents.controller.js
src/services/affiliate-events.service.js
src/services/affiliate-event-store.service.js
src/constants/affiliate.constants.js
src/services/rd-affiliate.service.js
```

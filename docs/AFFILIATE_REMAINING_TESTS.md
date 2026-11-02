# Afiliados — pruebas restantes antes de cerrar

**Fecha:** 2026-11-02  
**Alcance:** Fases 1 a 5 del programa de afiliados.  
**Estado:** implementación local terminada; pruebas de integración finales pendientes.  
**Datos de prueba:** no borrar hasta terminar esta matriz.

## Pruebas automáticas locales

Ejecutar desde el backend:

```bash
node scripts/test-affiliate-phase3.mjs
node scripts/test-stage-labels-opportunity.mjs
node scripts/test-seller-chatwoot-config.mjs
```

Esperado:

```text
Phase 3 pure tests: OK
Stage labels opportunity tests: OK
Seller Chatwoot config tests: OK
```

## Variables necesarias

### Hub

```env
AFFILIATE_EVENTS_ENABLED=true
AFFILIATE_EVENTS_SECRET=<secreto>
AFFILIATE_EVENT_STORE_PATH=./data/affiliate-events.json
```

### WordPress

```php
define( 'ICHEF_HUB_URL', 'https://URL-DEL-HUB' );
define( 'ICHEF_HUB_SECRET', '<mismo secreto>' );
```

### Chatwoot

```env
CHATWOOT_SELLER_OPPORTUNITIES_INBOX_ID=68
RD_CRM_NOTE_USER_ID=6931d6bd67977600185d6382
```

### Instancia de un Seller externo

Para probar la Fase 5, configurar el Seller de prueba:

```env
CHATWOOT_SELLER_<AFFILIATE_ID>_URL=https://seller.example.com
CHATWOOT_SELLER_<AFFILIATE_ID>_ACCOUNT_ID=<account_id>
CHATWOOT_SELLER_<AFFILIATE_ID>_TOKEN=<token>
CHATWOOT_SELLER_<AFFILIATE_ID>_INBOX_ID=<inbox_id>
CHATWOOT_SELLER_<AFFILIATE_ID>_TEAM_ID=<team_id opcional>
CHATWOOT_SELLER_<AFFILIATE_ID>_ASSIGNEE_ID=<assignee_id opcional>
```

Si faltan `URL`, `ACCOUNT_ID`, `TOKEN` o `INBOX_ID`, la instancia se omite sin bloquear el flujo.

---

# Matriz de pruebas

## A. Smoke test de despliegue

- [ ] Hub responde `/api/v2/health`.
- [ ] WordPress muestra `ichef-lovers-leads` 1.13.0.
- [ ] Existe `wpic_ichef_hub_events`.
- [ ] `wp_options.ichef_ll_version = 1.13.0`.
- [ ] El hub responde `202` con `AFFILIATE_EVENTS_ENABLED=true`.

## B. Seller

- [ ] Crear/editar un Seller de prueba con email.
- [ ] WordPress genera `seller.created` o `seller.lover_linked`.
- [ ] Outbox WordPress queda `sent`.
- [ ] Hub queda `processed`.
- [ ] RD Marketing tiene el contacto Seller con:
  - `cf_tipo_afiliado = Seller`
  - `cf_seller_affiliate_id`
  - `cf_seller_username`
  - `cf_seller_status`
  - `cf_seller_referral_url`
  - datos del Lover si corresponde.
- [ ] No se crea deal por este evento.

## C. Lead

- [ ] Crear un lead de prueba desde el portal.
- [ ] WordPress genera `lead.created`.
- [ ] Outbox WordPress queda `sent`.
- [ ] Hub queda `processed`.
- [ ] RD Marketing tiene C con `cf_referido_por`.
- [ ] El Lover tiene `cf_referidos` actualizado.
- [ ] Chatwoot cuenta 2 tiene el contacto C.
- [ ] Chatwoot no crea conversación por `lead.created`.
- [ ] Se envía `referido-portal`.
- [ ] No se crea deal por el handler de Fase 3.

## D. Confirmación con deal existente (Opción B)

Precondición: la automatización de RD ya creó el deal para C.

- [ ] Confirmar/asignar Seller desde el admin de WordPress.
- [ ] WordPress genera `lead.seller_confirmed` o `lead.seller_assigned`.
- [ ] Hub queda `processed`.
- [ ] El deal existente se reutiliza.
- [ ] No aparece un segundo deal para el mismo contacto.
- [ ] Se actualizan todos los custom fields del deal.
- [ ] Se envía `seller-asignado` a C.
- [ ] Se envía `referido-asignado` al Seller.
- [ ] Se crea nota en RD CRM.
- [ ] Se crea/reutiliza conversación de supervisión en cuenta 2, inbox 68.
- [ ] La conversación de supervisión tiene solo `oportunidad`.

## E. Seller externo con Chatwoot configurado

- [ ] Configurar `CHATWOOT_SELLER_<ID>_*`.
- [ ] Confirmar/assignar el lead al Seller externo.
- [ ] Se crea/actualiza C en la instancia del Seller.
- [ ] Se crea/reutiliza conversación en el inbox configurado.
- [ ] Se agrega nota privada con lead, Lover y Seller.
- [ ] Se agrega etiqueta `oportunidad`.
- [ ] La supervisión en cuenta 2, inbox 68 sigue existiendo.
- [ ] No hay conversación duplicada en la instancia del Seller.

## F. Seller sin Chatwoot configurado

- [ ] Usar un Seller sin variables `CHATWOOT_SELLER_<ID>_*`.
- [ ] Asignar el lead.
- [ ] El flujo no falla.
- [ ] Se crea solo la supervisión en cuenta 2, inbox 68.
- [ ] La conversación de supervisión tiene una nota aclaratoria de que el Seller no tiene Chatwoot configurado.

## G. Reasignación

- [ ] Asignar un lead al Seller A con deal existente.
- [ ] Reasignar al Seller B desde el admin.
- [ ] WordPress genera `lead.seller_reassigned`.
- [ ] Hub queda `processed`.
- [ ] Se actualiza el mismo deal; no se crea otro.
- [ ] Los campos del deal muestran Seller B.
- [ ] Se envía `seller-asignado` a C y `referido-asignado` a Seller B.
- [ ] Se crea nota en RD con Seller A → Seller B.
- [ ] En la instancia de Seller A: se reabre la conversación si estaba cerrada y se agrega nota.
- [ ] En la instancia de Seller B: se crea/reutiliza conversación y se agrega nota.
- [ ] En supervisión cuenta 2: se agrega nota, sin duplicar conversación.
- [ ] No hay deals ni conversaciones duplicadas.

## H. Etiquetas

- [ ] Conversación de oportunidad con deal: solo `oportunidad`.
- [ ] No aparece `lead_calificado` junto a `oportunidad`.
- [ ] Un lead calificado sin oportunidad puede mostrar `lead_calificado`.
- [ ] Conversación de supervisión: solo `oportunidad`.
- [ ] Conversación del Seller externo: solo `oportunidad`.

## I. Idempotencia y reintentos

- [ ] Reenviar el mismo `event_id` no duplica deal, nota ni conversación.
- [ ] Un evento sin deal queda en `pending_handler` con `existing_deal_not_found`.
- [ ] Reprocesar después de creado el deal actualiza el mismo deal.
- [ ] Un error de Chatwoot no crea un segundo deal.

## J. No regresión

- [ ] Los flujos actuales de Chatwoot siguen funcionando.
- [ ] Agentes, triggers, HSM y campaña vieja no se modifican.
- [ ] Checkout y atribución del producto 20513 siguen funcionando.
- [ ] Las tareas de afiliados existentes siguen funcionando.

---

# Consultas útiles

## WordPress

```sql
SELECT option_value
FROM wpic_options
WHERE option_name = 'ichef_ll_version';

SELECT id, event_id, event_name, status, attempts, last_error
FROM wpic_ichef_hub_events
ORDER BY id DESC
LIMIT 20;
```

## Hub

```http
GET /api/v2/affiliates/events/<event_id>
x-webhook-secret: <secreto>
```

Esperado en asignación exitosa:

```json
{
  "status": "processed",
  "rd_deal_id": "<deal existente>",
  "chatwoot_center_conversation_id": "<conversación inbox 68>",
  "seller_affiliate_id": "<seller>"
}
```

## RD CRM

Verificar que el contacto tenga un solo deal abierto:

```text
GET /api/v1/contacts?email=<email>
GET /api/v1/deals/<deal_id>
```

## Chatwoot

```text
GET /api/v1/accounts/2/contacts/<contact_id>/conversations
```

Verificar:

- inbox 68 para supervisión;
- inbox del Seller para la instancia externa;
- una sola conversación por inbox;
- etiqueta `oportunidad`.

---

# Datos de prueba actuales

No borrar hasta terminar las pruebas.

## RD Marketing

```text
test.seller.phase3.20261102170143243@example.com
test.lover.phase3.20261102170143243@example.com
test.lead.phase3.20261102170143243@example.com
```

## RD CRM

```text
Contacto: 6ae8c2378f220e000196acf5
Deal: 6ae8c2378f220e000196acf6
```

## Chatwoot cuenta 2

```text
Contacto: 29208
Conversación supervisión: 19086 (inbox 68)
Conversación flujo previo: 19082 (inbox 34)
```

## Eventos

```text
referido-portal
seller-asignado
referido-asignado
conversation-opened-inbox-68
```

---

# Limpieza final

Cuando las pruebas terminen:

1. Borrar contactos de RD Marketing de prueba.
2. Borrar el deal y el contacto de RD CRM de prueba.
3. Borrar contacto y conversaciones de Chatwoot de prueba.
4. Revocar credenciales temporales de WordPress.
5. Rotar secretos si fueron compartidos.
6. No borrar campos, campañas ni automatizaciones productivas.

## Pendientes conocidos

- El evento sin deal queda en `pending_handler`; todavía no hay reintento automático.
- La instancia Chatwoot del Seller externo requiere configuración manual por Seller.
- La automatización de RD que crea el deal debe quedar documentada y no desactivarse sin decisión.

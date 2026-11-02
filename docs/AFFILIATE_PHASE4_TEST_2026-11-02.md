# Fase 4 — Oportunidad con estrategia B

**Fecha:** 2026-11-02  
**Estrategia:** reutilizar y actualizar el deal creado por la automatización existente de RD.  
**Estado:** implementada y probada en local contra las APIs reales, con datos de prueba. **Desplegada en el hub el 2026-11-02; pendiente la validación final con una asignación real.**

## Regla

La automatización de RD crea el deal:

```text
Campaña: Crea oportunidad lead scoring y conversación en chatwoot
Campaign ID: 6a5f6ca22d31e700014fe833
Pipeline: Agendamiento demo
Etapa: Iniciar Agendamiento
```

El handler de asignación:

1. busca el contacto C en RD CRM;
2. busca el deal abierto existente;
3. actualiza el mismo deal;
4. no crea un segundo deal;
5. envía `seller-asignado` a C;
6. envía `referido-asignado` al Seller;
7. crea nota en RD CRM;
8. asegura la conversación de supervisión en Chatwoot cuenta 2, inbox 68;
9. deja la conversación con la etiqueta `oportunidad`.

Si no existe deal, el evento queda en `pending_handler` con
`existing_deal_not_found`; no se crea nada automáticamente.

## Archivos

Nuevo:

```text
src/services/affiliate-opportunity.service.js
```

Modificados:

```text
src/services/affiliate-events.service.js
src/services/affiliate-program.service.js
src/services/rd-affiliate.service.js
.env.example
```

## Prueba real

Se usó el deal de prueba:

```text
Deal ID: 6ae8c2378f220e000196acf6
CRM contact ID: 6ae8c2378f220e000196acf5
```

Resultado:

```text
Deal reutilizado: OK
Deal duplicado: NO
Custom fields del deal: OK
seller-asignado: enviado
referido-asignado: enviado
Conversación de supervisión: 19086
Inbox: 68
Etiqueta: oportunidad
Nota RD: se verificó el endpoint con una nota de prueba
```

### Custom fields actualizados

```text
Seller Affiliate ID
Seller Username
Seller Name
Seller Email
Seller Status
Seller Referral URL
Lover Affiliate ID
Lover Username
Lover Email
Lover Name
Lead ID
Referral Status
```

### Conversación de supervisión

```text
Chatwoot conversation ID: 19086
Account: 2
Inbox: 68
Labels: ["oportunidad"]
```

Se mantiene también la conversación previa del flujo existente:

```text
Chatwoot conversation ID: 19082
Inbox: 34
```

Esa conversación volvió a mostrar `lead_calificado` porque el fix de etiquetas
todavía no está desplegado en producción. Después de desplegar
`src/utils/stage-labels.utils.js` y `src/controllers/oportunidad.controller.js`
debe quedar solo con `oportunidad`.

### Nota RD

El endpoint de notas se probó directamente y respondió correctamente:

```text
POST /api/v1/activities
Tipo: note
Deal: 6ae8c2378f220e000196acf6
Usuario: 6931d6bd67977600185d6382 (Branca Ghelfgot)
```

El servicio usa `RD_CRM_NOTE_USER_ID` si está configurado; si no, usa el
usuario responsable del deal como fallback.

## Configuración

```env
CHATWOOT_SELLER_OPPORTUNITIES_INBOX_ID=68
```

Opcional, pero recomendado:

```env
RD_CRM_NOTE_USER_ID=6931d6bd67977600185d6382
```

## Prueba manual

```text
node scripts/test-affiliate-phase4-live.mjs
```

El script no debe usarse en producción; es solo para pruebas controladas.

## Despliegue

Archivos desplegados:

- `src/services/affiliate-opportunity.service.js`
- `src/services/affiliate-events.service.js`
- `src/services/affiliate-program.service.js`
- `src/services/rd-affiliate.service.js`
- `src/utils/stage-labels.utils.js`
- `src/controllers/oportunidad.controller.js`
- `.env.example` (referencia)

Configuración recomendada:

```env
CHATWOOT_SELLER_OPPORTUNITIES_INBOX_ID=68
RD_CRM_NOTE_USER_ID=6931d6bd67977600185d6382
```

Pendiente:

- Verificar una asignación real con un deal existente.
- Confirmar que la conversación `19082` se mantiene solo con `oportunidad`.
- Limpiar los datos de prueba cuando se indique.

## Límites de esta implementación

- No crea deals: reutiliza el existente.
- Si no encuentra deal, deja el evento en `pending_handler`.
- La instancia Chatwoot separada del Seller externo ya está implementada en
  local como Fase 5; falta configurarla y probarla contra una instancia real.
- Las conversaciones de supervisión en inbox 68 se crean/reutilizan.

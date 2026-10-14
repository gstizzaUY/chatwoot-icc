# Unificación de Campos de Contacto — Chatwoot ↔ RD Station

**Estado:** Borrador / planificación (no implementado)
**Última actualización:** Septiembre 2026
**Objetivo de este documento:** dejar constancia del estado actual, los desajustes
detectados entre Chatwoot y RD Station, y el plan para unificarlos. Sirve para
continuar el trabajo en otra sesión.

---

## 1. Contexto

El sistema (agentes IA + sincronización CRM) escribe datos de contacto en dos
plataformas:

- **Chatwoot** → `custom_attributes` del contacto (+ campos raíz `name`, `email`, `phone_number`).
- **RD Station** → contacto de Marketing (`/platform/contacts`), estándar + `cf_*`.

Hoy **no existe una fuente de verdad única** de campos. Los campos se definen en
varios lugares que pueden divergir:

- Prompts de IA: `src/agents/pre-venta/pre-venta.prompts.js`,
  `src/agents/nutridor/nutridor.prompts.js`, `src/services/ai-analysis.service.js`.
- Escritura en Chatwoot: `src/services/shared/crm-sync.service.js`,
  `src/services/conversation-analysis.service.js`.
- Mapeo a RD: `src/mappers/contact.mapper.js`.
- Allowlist manual: `RDSTATION_CUSTOM_FIELDS` en `.env` (gate `isCustomFieldEnabled`).
- Definiciones reales: Chatwoot `custom_attribute_definitions` y RD `GET /platform/contacts/fields`.

### Requisitos definidos por negocio

1. Los campos de **Chatwoot y RD Station deben ser los mismos** (mismo set lógico).
2. Los campos personalizados **se gestionan a mano** y se crean en **ambas** plataformas.
3. **No se crean campos arbitrariamente** desde el sistema (ni en Chatwoot ni en RD).
4. Si un campo **no existe**, **no debe capturarse**.
5. El sistema debe **conocer** los campos y estar preparado para capturarlos.
6. Los datos capturados pertenecen siempre **a la persona que chatea / titular de la
   conversación**; datos de terceros (ej. titular de factura distinto) **no se guardan**.
7. Regla fill-only: solo rellenar campos vacíos (no sobreescribir); excepción: email
   ficticio `@email.com` → email real.

---

## 2. Estado actual detectado (datos en vivo)

- **Chatwoot:** 132 `contact_attribute` definidos (`GET /api/v1/accounts/2/custom_attribute_definitions`).
- **RD Station:** 89 campos personalizados (`cf_*`) + 15 nativos
  (`GET /platform/contacts/fields`).
- **`RDSTATION_CUSTOM_FIELDS`** (`.env`) hoy: `cf_tiene_ichef,cf_address1,cf_zip,cf_cedula,cf_stage`.
  Funciona como allowlist para evitar el error `INVALID_FIELDS` (RD rechaza el payload
  entero si se envía un `cf_*` inexistente). Es un parche, no debe ser la solución final.

### Hallazgo: whitelist dinámica ya existe (reutilizable)

`controllers/registerContactController.js`:
- `getRdEditableFields()` (línea ~61): `GET /platform/contacts/fields` con caché.
- `sanitizeContactPayload()` (línea ~100): filtra el payload contra los campos reales.

Ese mecanismo no necesita `.env`, pero hoy solo lo usa el controlador V1.

---

## 3. Desajustes encontrados

### 3.1 El código escribe en Chatwoot claves que NO están definidas

| Código escribe | ¿Existe en Chatwoot? | Equivalente |
|---|---|---|
| `mobile_phone` | ❌ | `mobile` / `phone` / root `phone_number` |
| `address` | ❌ | `address1` / `address2` |
| `cedula` | ❌ | — |
| `rut` | ❌ | — |
| `es_cliente` | ❌ | — (decisión: solo Chatwoot) |
| `id_equipo` | ❌ | `id_robot` |
| `client_comments` | ❌ | `clientComments` |
| `status_contacto` | ❌ | — |
| `local_demo`, `demo_fecha_hora` | ❌ | — |
| `enc_*` (todos) | ❌ | — |

> Chatwoot persiste claves arbitrarias, por eso "funcionan" aunque no se vean en la UI
> ni sean filtrables.

### 3.2 El mapper manda a RD con nombre incorrecto (darían `INVALID_FIELDS`)

| Código envía | Identificador real en RD |
|---|---|
| `company` | no existe |
| `language` | `cf_language` |
| `instagram` | `cf_instagram` |
| `status_contacto` | `cf_status_contacto` |
| `referido_por` | `cf_referido_por` |
| `referente` | `cf_referente` |
| `referidos` | `cf_referidos` |
| `fuente_contacto` | `cf_fuente_contacto` |
| `envia_cupon_despues` | `cf_envia_cupon_despues` |
| `forma_pago` | `cf_enc_forma_pago` |
| `uso` | `cf_uso` |
| `version_firmware` | `cf_version_firmware` |
| `estado_sdr` | `cf_estado_sdr` |
| `enc_experiencia`, `enc_gusta_cocinar`, … | `cf_enc_experiencia`, `cf_enc_gusta_cocinar`, … |
| `enc_cantidad_personas_Cocina` | `cf_enc_cantidad_personas_cocina` (case) |

### 3.3 Campos que existen en RD y faltan en Chatwoot

`cedula`, `rut`, `numero_puerta`, `categoria_contacto`, `status_contacto`,
`demo_fecha_hora`, `demo_fecha_hora_utc`, `direccion_demo`, `local_demo`, `cupon_url`,
`envia_cupon_despues`, `fuente_contacto`, `forma_pago`, `uso`, `nickname`,
`owner_name`, `referente`, `referido_por`, `referido_por_0`, `referidos`,
`token_invitado`, `validador`, `id_inconcert`, `foreign_document`, `importado_px`,
`enc_acesso_ichef`, todos los `enc_*` y `ls_*`.

### 3.4 Campos que existen en Chatwoot y faltan en RD

`company` (RD no tiene nativo), `title`, `fax`, `googlePlus`, `skype`, `score`,
`deals`, `blacklist`, `blocked`, `hadDuplicateDetected`, y los ~60 campos de tracking
InConcert (`createdBy*`, `first*/last*Event*`, `lastTrackingId`, `lastFingerprint`,
`createdOutOfHour`, `createdByCampaign*`, `createdByClick*`, etc.).

### 3.5 Mismo dato, distinto nombre (a unificar)

| Chatwoot | RD Station |
|---|---|
| `id_robot` | `cf_id_equipo` |
| `version_del_firmware` | `cf_version_firmware` |
| `clientComments` | `cf_client_comments` |
| `customData` | `cf_custom_data` |
| `participo_SDR` | `cf_participo_sdr` |
| `position` | `cf_position` (RD nativo: `job_title`) |
| `phone` | `personal_phone` (nativo) |
| root `phone_number` | `mobile_phone` (nativo) |
| `firstname` + `lastname` | `name` (nativo) + `cf_lastname` |
| `instagram` | `cf_instagram` |
| `language` | `cf_language` |
| `referido_por` | `cf_referido_por` |

### 3.6 Notas técnicas

- Los IDs reales de RD tienen inconsistencias de mayúsculas
  (`cf_referredatcampaignid`, `cf_enc_cantidad_personas_cocina`, etc.). Confirmar el
  `api_identifier` exacto con `GET /platform/contacts/fields`.
- `es_cliente` es **Chatwoot-only** por diseño (RD lo representa con `cf_stage = customer`;
  no existe `cf_es_cliente`).
- Datos sucios observados: `state = "null"` (string) en Chatwoot y RD.

### 3.7 Ejemplos analizados (referencia)

- **Conversación 16877** (contacto Carolina Veirano #27384, canal 34): la IA capturó
  `email, firstname, lastname, mobile_phone, city, country, tiene_ichef, stage`; escribió
  `mobile_phone` (clave inexistente en Chatwoot) y el mapper no lo envía a RD por la
  allowlist.
- **Conversación 16624** (contacto Ana #27432): la IA capturó el nombre del **titular de
  factura** (Gonzalo) en lugar de la persona que chatea (Ana) → dato incorrecto. Los
  datos de facturación de un tercero no deben capturarse. `rut`/`cedula`/`address`/`zip`
  no se guardaron (y `crm-sync` ni siquiera escribe `rut`).
- **Conversación 16554** (Instagram): teléfono `098339161` no se guardó porque el Resumen
  lo escribía sin normalizar (422) y porque ya existía en otro contacto (duplicado).

---

## 4. Lo que se quiere hacer

### 4.1 Catálogo canónico de campos (fuente de verdad única)

Crear `src/constants/contact-fields.constants.js` con un array de objetos, uno por
campo lógico:

```js
{
  key: 'mobile_phone',        // clave interna
  chatwoot: 'mobile',         // attribute_key real en Chatwoot (o null si root)
  root: false,                // true = columna raíz (name/email/phone_number)
  rd: 'mobile_phone',         // api_identifier real en RD (o null si solo Chatwoot)
  type: 'text',               // text | combo | number | bool
  aiField: 'mobile_phone',    // nombre en el JSON del prompt
  writable: true,             // el sistema puede escribirlo
  chatwootOnly: false         // ej. es_cliente
}
```

Reglas:
- Solo los campos del catálogo **se capturan y se escriben**.
- Un campo fuera del catálogo no existe para el sistema.
- El catálogo contiene únicamente campos que existen (creados a mano) en ambas
  plataformas (salvo `chatwootOnly` explícitos).

### 4.2 Derivar todo del catálogo

- Prompts: la lista de campos a extraer sale del catálogo (`aiField`).
- `crm-sync` y `conversation-analysis`: escriben solo claves del catálogo, usando el
  `chatwoot` exacto.
- `contact.mapper.js`: mapea usando el `rd` del catálogo.

### 4.3 Eliminar `RDSTATION_CUSTOM_FIELDS`

- El catálogo reemplaza la allowlist. Sin gating por `.env`.

### 4.4 Validación al arranque (solo log)

- Comparar el catálogo contra Chatwoot y RD al iniciar y loguear
  `⚠️ Campo X del catálogo no existe en Chatwoot/RD`. No crea nada.

### 4.5 Reglas de negocio asociadas

- Datos de terceros (no del titular de la conversación) → `null`, no se guardan.
- Fill-only (no sobreescribir; excepción email ficticio → real).
- Teléfonos siempre normalizados a E164.
- Duplicados (teléfono/email) → nota privada, no escribir, fusión manual.

---

## 5. Decisiones pendientes (bloqueantes)

1. **Alcance del catálogo:** ¿todos los campos (incl. `enc_*`, `ls_*`, tracking, plugins
   CRM) o solo el subconjunto operativo (identidad, iChef, ubicación/facturación,
   comercial)?
2. **Nombres canónicos** para los pares divergentes (`id_robot`↔`cf_id_equipo`,
   `version_del_firmware`↔`cf_version_firmware`, `position`↔`job_title`,
   `phone`↔`personal_phone`, `mobile_phone`↔`phone_number`, etc.): ¿cuál se adopta?
3. **Campos que faltan en Chatwoot:** crearlos a mano con el nombre acordado, y
   confirmar que se crean también en RD.
4. **Campos que faltan en RD:** ¿se crean o se excluyen? (ej. `company`, `title`).
5. **`es_cliente`:** confirmar excepción Chatwoot-only.
6. **Campos InConcert/tracking** (`createdBy*`, `first*/last*Event*`): excluir del
   catálogo (no se capturan por IA).
7. **¿Se unifica `registerContactController.js`** al helper compartido?

---

## 6. Plan de implementación (post-decisión)

1. Crear `src/constants/contact-fields.constants.js` con el catálogo acordado.
2. Refactor de prompts para listar campos desde el catálogo.
3. Refactor de `crm-sync.service.js` y `conversation-analysis.service.js` para usar el
   catálogo (claves exactas de Chatwoot).
4. Refactor de `contact.mapper.js` (usar `rd` del catálogo; eliminar
   `isCustomFieldEnabled`/`RDSTATION_CUSTOM_FIELDS`).
5. Agregar `updateField('custom','rut', ...)` en `crm-sync` (hoy no escribe RUT).
6. Alinear `address` → `address1`.
7. Agregar validación al arranque (solo log).
8. Reutilizar `getRdEditableFields()`/`sanitizeContactPayload()` como red de seguridad
   opcional (o aplicarlos dentro del cliente RD).
9. Actualizar `docs/AI_AGENTS_SYSTEM.md` y `.env.example` (quitar la allowlist).
10. Crear manualmente los campos faltantes acordados en Chatwoot (y verificar en RD).

**Verificación:**
- Reproducir conversaciones 16877 / 16624 / 16554 con los prompts y validar campos.
- Confirmar que no se escribe ninguna clave fuera del catálogo.
- Confirmar que no hay `INVALID_FIELDS` en RD.

---

## 7. Archivos de referencia

- `src/constants/agent.constants.js`
- `src/constants/contact-fields.constants.js` *(a crear)*
- `src/agents/pre-venta/pre-venta.prompts.js`
- `src/agents/nutridor/nutridor.prompts.js`
- `src/services/ai-analysis.service.js`
- `src/services/shared/crm-sync.service.js`
- `src/services/shared/contact-write-guard.service.js`
- `src/services/shared/field-protection.service.js`
- `src/services/conversation-analysis.service.js`
- `src/mappers/contact.mapper.js`
- `controllers/registerContactController.js` (whitelist dinámica RD)
- `src/RDSTATION_CUSTOM_FIELDS.md` (doc previa de la allowlist)
- `docs/RD_STATION_API.md`, `docs/AI_AGENTS_SYSTEM.md`

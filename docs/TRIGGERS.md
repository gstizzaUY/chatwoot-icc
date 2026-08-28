# Manual del Motor de Triggers (eventos del Portal de Recetas)

El motor de triggers recibe eventos del Portal de Recetas a través de **un
solo endpoint**, acumula estado por email y dispara la creación de
conversaciones en Chatwoot (con nota privada) según **reglas configurables**.

## Índice
0. [Guía rápida (para no técnicos)](#0-guía-rápida-para-no-técnicos)
1. [Interruptor ON/OFF general](#1-interruptor-onoff-general)
2. [Endpoint y body](#2-endpoint-y-body)
3. [Dónde se configura todo](#3-dónde-se-configura-todo)
4. [Estructura de una regla](#4-estructura-de-una-regla)
5. [Nota privada: plantillas y funciones](#5-nota-privada-plantillas-y-funciones)
6. [Cómo agregar un evento o campaña nuevo](#6-cómo-agregar-un-evento-o-campaña-nuevo)
7. [Cómo probar](#7-cómo-probar)
8. [Estado y almacenamiento](#8-estado-y-almacenamiento)
9. [Comportamiento y consideraciones](#9-comportamiento-y-consideraciones)
10. [Contrato para el desarrollador del Portal de Recetas](#10-contrato-para-el-desarrollador-del-portal-de-recetas)

---

## 0. Guía rápida (para no técnicos)

### ¿Qué es esto?
El sistema recibe **señales (eventos)** del Portal de Recetas — por ejemplo
"el usuario entró al portal" o "el usuario encendió su robot iChef". Cuando
llegan esas señales, el sistema puede **crear o reutilizar una conversación**
en el canal de Chatwoot (Centro de Experiencias) y escribir una **nota
interna** con los datos del cliente.

### ¿Cómo funciona?
1. El portal envía el evento a **una sola dirección** (`/api/v2/triggers/events`),
   indicando el nombre del evento en el campo `eventName`.
2. El sistema **recuerda qué eventos le llegaron a cada cliente** (por email).
3. Según unas **reglas**, decide **cuándo** abrir una conversación y **qué
   nota** escribir.
4. Todo se configura en **un único archivo**:
   `src/services/triggers/trigger-rules.config.js`

> Mientras la variable de entorno `TRIGGERS_ENABLED` esté en `false`, el
> sistema recibe los eventos pero **no hace nada** (no crea conversaciones).

---

### Quiero agregar una regla o un evento nuevo (sin programar)

1. Abrir el archivo `src/services/triggers/trigger-rules.config.js`.
2. Si el evento no está declarado, agregarlo en **`triggerEvents`**:
   ```js
   'nueva-receta': { label: 'El usuario descargó una receta' },
   ```
3. Agregar su **regla** en **`triggerRules`** (copiar una existente y
   cambiarle `id`, `requiredEvents` y `note`):
   ```js
   {
       id: 'nueva-receta',
       enabled: true,
       requiredEvents: ['nueva-receta'],
       repeatWindowMs: 0,
       action: { type: 'createConversation', inboxId: 38, assigneeId: 19, teamId: 4, reuseMode: 'reopen', createContactIfMissing: true, syncRD: true },
       note: '{{label}}: {{clientName}} ({{email}})',
   }
   ```
4. **Guardar, reiniciar el servidor** y verificar que `TRIGGERS_ENABLED=true`
   en `.env`.

> No hace falta tocar rutas ni controladores: todo es configuración.

---

### Cómo configurar las reglas (combinaciones)

- Una regla con **un solo evento** (ej. `['login-portal']`) → se activa cuando
  llega ese evento.
- Una regla con **varios eventos** (ej. `['login-portal','robot-encendido']`)
  → se activa cuando **llegaron todos**, sin importar el orden.
- `repeatWindowMs: 0` → la regla se activa en cada nueva señal. Si se pone un
  número (milisegundos), **no se vuelve a activar** dentro de esa ventana.
- El texto de la nota interna se edita en **`note`** de cada regla (plantilla
  o función, ver sección 5).

---

## 1. Interruptor ON/OFF general

El ON/OFF se gestiona por **variable de entorno** (no en el código):

```
TRIGGERS_ENABLED=true|false
```

- En **`.env`** (y documentado en `.env.example`).
- `false` (por defecto): los endpoints responden `202` pero **no registran
  eventos ni crean conversaciones**. Modo seguro.
- `true`: se activa toda la lógica de eventos y conversaciones.

> ⚠️ Al cambiar el valor hay que **reiniciar el servidor**.

---

## 2. Endpoint y body

```
POST /api/v2/triggers/events
```

Headers:
```
Content-Type: application/json
x-webhook-secret: <secreto>
```

Body:
```json
{
    "eventName": "login-portal",
    "clientId": "15",
    "clientName": "Juan Pérez",
    "robotId": "ABC123XYZ789",
    "email": "juan.perez@example.com",
    "cellphone": null,
    "user": "usuario1",
    "lastDate": "Thu Dec 26 11:59:56 2024",
    "firmwareVersion": "no reporta version",
    "status": "readyToGo"
}
```

- `eventName` es **obligatorio** (si falta → `400`). El resto del body son
  datos libres que se usan en el contacto y en la nota.
- `email` es **obligatorio** y debe ser válido (si no → `400`).
- Un `eventName` desconocido (sin regla) responde `202`, se registra y se
  ignora hasta que se configure una regla.

Respuestas:
| Caso | Código | Body |
|------|--------|------|
| Recibido (procesa en background) | `202` | `{"success":true,"message":"Procesando en background","event":"<eventName>"}` |
| `eventName` faltante o email inválido | `400` | `{"success":false,"error":"..."}` |
| `x-webhook-secret` ausente o inválido | `401` | `{"success":false,"error":"..."}` |
| Demasiadas peticiones (100/min por IP) | `429` | `{"success":false,"error":"Too many..."}` |

---

## 3. Dónde se configura todo

Todo se configura en **un solo archivo**:
`src/services/triggers/trigger-rules.config.js`

- `triggerConfig` → interruptor general (lee `TRIGGERS_ENABLED`).
- `triggerEvents` → catálogo de eventos conocidos (eventName → label).
- `triggerRules` → las reglas (combinaciones de eventos → conversación + nota).

El resto de los módulos del motor (`trigger-engine.js`, `trigger-store.js`,
`trigger-actions.js`) **no se tocan** para configurar reglas.

---

## 4. Estructura de una regla

```js
{
    id: 'login',                 // identificador único (para lastFired)
    enabled: true,               // false = esta regla no dispara
    requiredEvents: ['login-portal'],  // combinación de eventos requeridos
    repeatWindowMs: 0,           // ventana anti-repetición en ms
    action: {
        type: 'createConversation',
        inboxId: 38,             // canal (inbox de Chatwoot)
        assigneeId: 19,          // agente asignado (opcional)
        teamId: 4,               // equipo asignado (opcional)
        reuseMode: 'reopen',     // 'reopen' | 'open' | 'new'
        createContactIfMissing: true,  // crea contacto en Chatwoot si no existe
        syncRD: true,            // sincroniza/crea contacto en RD Station
    },
    note: '{{label}}: {{clientName}} ({{email}})',  // o función (ver sección 5)
}
```

### Campos clave

| Campo | Qué hace |
|-------|----------|
| `id` | Identificador único. Se usa para guardar `lastFired` por email y regla. |
| `enabled` | `false` desactiva la regla sin borrarla. |
| `requiredEvents` | Lista de eventNames que **deben haber llegado todos** (sin importar el orden). Con 1 solo evento = regla individual. Con 2+ = regla combinada. |
| `repeatWindowMs` | `0` = repite siempre (cada nueva ocurrencia dispara). `>0` = no vuelve a disparar para el mismo email hasta que pase esa ventana (ms). Ej: `300000` = 5 min. |
| `action.reuseMode` | `'reopen'`: reutiliza la conversación abierta del canal; si hay una cerrada, la reabre; crea solo si nunca existió una en ese canal. `'open'`: reutiliza solo la abierta, crea si no hay. `'new'`: siempre crea conversación nueva. |
| `action.inboxId` | El canal de Chatwoot donde se crea/reutiliza la conversación. "Centro de Experiencias" = `38`. |
| `note` | Plantilla de texto o función (ver sección 5). |

---

## 5. Nota privada: plantillas y funciones

Cada regla define `note` de dos formas:

### a) Plantilla de texto (fácil, sin programar)

```js
note: '{{label}}: {{clientName}} ({{email}}) — estado {{status}}',
```

Placeholders disponibles:
- `{{eventName}}` → nombre del evento.
- `{{label}}` → título del evento (de `triggerEvents`).
- `{{campo}}` → cualquier campo del body del evento (ej. `{{clientName}}`,
  `{{robotId}}`, `{{firmwareVersion}}`). Si el campo no viene, se omite.

### b) Función (avanzado)

Recibe los datos de **todos** los eventos acumulados para el email:

```js
note: (events) => {
    const login = events['login-portal'] || {};
    const robot = events['robot-encendido'] || {};
    return `Login: ${login.clientName} | Robot: ${robot.robotId}`;
},
```

Sirve para notas complejas o que combinan varios eventos.

> La nota se crea como `private: true` (nota interna, no se envía al
> contacto) y la conversación se marca como no leída.

---

## 6. Cómo agregar un evento o campaña nuevo

Un evento/campaña nuevo **no requiere tocar rutas ni controladores**. Solo
editar la configuración:

### Paso 1 — Declarar el evento en `triggerEvents`

```js
export const triggerEvents = {
    'login-portal':    { label: 'El usuario se logueó al portal de recetas' },
    'robot-encendido': { label: 'El usuario encendió el robot iChef' },
    'nueva-receta':    { label: 'El usuario descargó una receta' },   // ← NUEVO
};
```

### Paso 2 — Definir la regla en `triggerRules`

```js
{
    id: 'nueva-receta',
    enabled: true,
    requiredEvents: ['nueva-receta'],      // o combinarlo con otros eventos
    repeatWindowMs: 0,
    action: { type: 'createConversation', inboxId: 38, assigneeId: 19, teamId: 4, reuseMode: 'reopen', createContactIfMissing: true, syncRD: true },
    note: '{{label}}: {{clientName}} ({{email}})',
},
```

### Paso 3 — Reiniciar y activar

- Guardar el archivo, reiniciar el servidor.
- Verificar `TRIGGERS_ENABLED=true` en `.env`.
- Informar al equipo del portal que puede enviar `eventName: "nueva-receta"`
  al endpoint único `/api/v2/triggers/events`.

> Antes de configurar la regla, el evento llega y se ignora (responde 202).
> Se puede configurar antes o después de que el portal empiece a enviar.

---

## 7. Cómo probar

Servidor corriendo (`npm run dev`, puerto según `.env`, ej. 4002):

```bash
curl -X POST http://localhost:4002/api/v2/triggers/events \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: <VALIDATOR_WEBHOOK_SECRET>" \
  -d '{"eventName":"login-portal","clientName":"Juan Pérez","robotId":"ABC123","email":"juan@example.com","cellphone":null,"user":"juan","lastDate":null,"firmwareVersion":"V1","status":"free"}'
```

Respuestas esperadas: `202` (procesa en background), `400` (eventName/email
inválido), `401` (secret inválido), `429` (rate limit).

Para ver la actividad del motor en consola, buscar los logs
`[triggers-engine]` y `[triggers-actions]`.

---

## 8. Estado y almacenamiento

El estado (qué eventos llegaron por email y cuándo disparó cada regla) se
persiste en:

```
backend/data/triggers_state.json
```

- Se carga al iniciar el servidor y se guarda al cambiar (con debounce).
- Si se quiere **reiniciar el estado** (empezar de cero), borrar ese archivo
  y reiniciar.
- Sin limpieza automática por ahora.

---

## 9. Comportamiento y consideraciones

- **Agrupación**: los eventos se agrupan por **email** del contacto.
- **Serialización**: los eventos del mismo email se procesan en orden (cola
  en memoria) para evitar carreras y notas duplicadas.
- **Evento sin regla**: se acepta (202), se registra y se ignora; se
  configura la regla después.
- **Contacto**: si no existe en Chatwoot, se crea (con `tiene_ichef`,
  `id_robot`, `version_del_firmware`) y también en RD Station
  (`cf_tiene_ichef`, `cf_id_equipo`, `cf_version_firmware`). Si existe, se
  completan los campos faltantes.
- **Conversación**: con `reuseMode: 'reopen'` se reutiliza la abierta del
  canal, o se reabre la cerrada más reciente; solo se crea si nunca hubo una
  en ese canal.
- **Varias reglas**: todas se evalúan en cada evento; pueden dispararse
  varias en el mismo evento (diseñar las combinaciones para evitar pisadas).
- **Múltiples instancias**: la cola y el estado son en memoria/archivo local;
  con varias instancias del backend habría que revisar el guardado.

---

## 10. Contrato para el desarrollador del Portal de Recetas

Texto listo para copiar y entregar al equipo del portal.

### Integración de eventos — iChef ICC

Se envía **un solo tipo de request** para todos los eventos; la distinción
del evento va en el campo `eventName` del body.

**Base URL:** `https://contact-center.5vsa59.easypanel.host`

```
POST /api/v2/triggers/events
```

**Headers:**
```
Content-Type: application/json
x-webhook-secret: <VALIDATOR_WEBHOOK_SECRET>
```

**Body (ejemplo):**
```json
{
    "eventName": "login-portal",
    "clientId": "15",
    "clientName": "Juan Pérez",
    "robotId": "ABC123XYZ789",
    "email": "juan.perez@example.com",
    "cellphone": null,
    "registered": true,
    "enabled": false,
    "activated": true,
    "inactive": false,
    "blocked": false,
    "free": false,
    "unlockable": false,
    "pendingSetup": false,
    "connected": false,
    "user": "usuario1",
    "lastDate": "Thu Dec 26 11:59:56 2024",
    "firmwareVersion": "no reporta version",
    "status": "readyToGo",
    "contractType": null,
    "betatester": true
}
```

- `eventName` es **obligatorio**. Valores activos hoy: `login-portal`
  (usuario logueado al portal) y `robot-encendido` (robot encendido). Se irán
  agregando más.
- `email` es **obligatorio**. El resto de los campos se usan para completar el
  contacto y aparecer en la nota interna.

**Respuestas:**
| Caso | Código | Body |
|------|--------|------|
| Recibido — procesa en background | `202` | `{"success":true,"message":"Procesando en background","event":"<eventName>"}` |
| `eventName` o `email` faltante/inválido | `400` | `{"success":false,"error":"..."}` |
| `x-webhook-secret` ausente o inválido | `401` | `{"success":false,"error":"..."}` |
| Demasiadas peticiones (100/min por IP) | `429` | `{"success":false,"error":"Too many webhook requests..."}` |

**Notas:**
- El `202` se devuelve al instante; el procesamiento es asíncrono. **No
  reintentar** ni esperar trabajo terminado.
- Un `eventName` nuevo puede enviarse antes de estar configurado: se acepta
  (202) y se ignora hasta que se defina su regla.
- Ante `429`, esperar al menos 1 minuto antes de reintentar.
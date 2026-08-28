# Manual del Motor de Triggers (eventos del Portal de Recetas)

El motor de triggers recibe eventos del Portal de Recetas, acumula estado por
email y dispara la creación de conversaciones en Chatwoot (con nota privada)
según **reglas configurables**.

## Índice
0. [Guía rápida (para no técnicos)](#0-guía-rápida-para-no-técnicos)
1. [Interruptor ON/OFF general](#1-interruptor-onoff-general)
2. [Dónde se configura todo](#2-dónde-se-configura-todo)
3. [Estructura de una regla](#3-estructura-de-una-regla)
4. [Cómo configurar una o varias reglas](#4-cómo-configurar-una-o-varias-reglas)
5. [Mensaje privado (nota)](#5-mensaje-privado-nota)
6. [Cómo agregar un nuevo disparador](#6-cómo-agregar-un-nuevo-disparador)
7. [Cómo probar](#7-cómo-probar)
8. [Estado y almacenamiento](#8-estado-y-almacenamiento)
9. [Comportamiento y consideraciones](#9-comportamiento-y-consideraciones)

---

## 0. Guía rápida (para no técnicos)

### ¿Qué es esto?
El sistema recibe **señales (eventos)** del Portal de Recetas — por ejemplo
"el usuario entró al portal" o "el usuario encendió su robot iChef". Cuando
llegan esas señales, el sistema puede **crear o reutilizar una conversación**
en el canal de Chatwoot (Centro de Experiencias) y escribir una **nota
interna** con los datos del cliente.

### ¿Cómo funciona?
1. Un evento llega a una **dirección (endpoint)** específica.
2. El sistema **recuerda qué eventos le llegaron a cada cliente** (por email).
3. Según unas **reglas**, decide **cuándo** abrir una conversación y **qué
   nota** escribir.
4. Todo se configura en **un único archivo**:
   `src/services/triggers/trigger-rules.config.js`

> Mientras el interruptor general esté en `enabled: false`, el sistema recibe
> los eventos pero **no hace nada** (no crea conversaciones). Para activar la
> funcionalidad hay que ponerlo en `true` y reiniciar el servidor.

---

### Quiero agregar una regla nueva (cambio simple)

1. Abrir el archivo de configuración
   (`src/services/triggers/trigger-rules.config.js`).
2. Buscar la lista llamada **`triggerRules`**.
3. **Copiar una regla existente** (la de "login" o la de "robot") y pegarla
   debajo, dentro de la lista.
4. Cambiarle los datos:
   - `id`: un nombre corto único (ej. `"robot-y-revisita"`).
   - `enabled`: dejarlo en `true`.
   - `requiredEvents`: qué eventos deben haber llegado para que se active
     (ej. `['robot_encendido']`, o varios separados por coma para una
     combinación).
   - `note`: el **texto de la nota** que se escribirá en la conversación.
   - `repeatWindowMs`: dejarlo en `0` (se activa cada vez que llega una nueva
     señal).
5. **Guardar y reiniciar el servidor.**

> Si la regla usa eventos que todavía no existen, primero hay que crear el
> disparador nuevo (siguiente punto).

---

### Quiero agregar un disparador (endpoint) nuevo

Un **disparador** es una nueva señal que puede llegar del portal. Los dos
primeros pasos requieren ayuda de desarrollo; el tercero es configuración:

1. **Registrar la dirección nueva** en
   `src/routes/v2/triggers.routes.js` — se agrega una línea como
   `router.post('/eventos/<nombre>', <handler>);`
2. **Crear el "handler"** en
   `src/controllers/triggersEventos.controller.js` — se agrega una línea como
   `export const <handler> = handleEvent('<nombre_del_evento>');`
3. **Registrar el evento en la configuración** (archivo
   `trigger-rules.config.js`):
   - En **`triggerEvents`**: agregar el evento con una etiqueta descriptiva
     (ej. `mi_evento: { label: 'El usuario descargó una receta' }`).
   - En **`triggerRules`**: agregar la regla que lo use, o incluirlo dentro de
     una regla combinada con otros eventos.

Después, informar al equipo del portal la **dirección nueva** y qué datos
enviar en cada señal.

---

### Cómo configurar las reglas (combinaciones)

- Una regla con **un solo evento** (ej. `['login_portal']`) → se activa cuando
  llega ese evento.
- Una regla con **varios eventos** (ej. `['login_portal','robot_encendido']`)
  → se activa cuando **llegaron todos**, sin importar el orden.
- `repeatWindowMs: 0` → la regla se activa en cada nueva señal. Si se pone un
  número (milisegundos), **no se vuelve a activar** dentro de esa ventana.
- El texto de la nota interna se edita en **`note`** de cada regla.

---

## 1. Interruptor ON/OFF general

Archivo: `src/services/triggers/trigger-rules.config.js`

```js
export const triggerConfig = {
    enabled: false,   // <-- false = TODO apagado (default)
};
```

- `false` (por defecto): los endpoints responden `202` pero **no registran
  eventos ni crean conversaciones**. Es el modo seguro para mantener
  desplegado sin efectos hasta avisar al portal.
- `true`: se activa toda la lógica de eventos y conversaciones.

> ⚠️ Al cambiar `enabled` hay que **reiniciar el servidor** para que tome el
> cambio (la config se lee al iniciar).

---

## 2. Dónde se configura todo

Todo se configura en **un solo archivo**:
`src/services/triggers/trigger-rules.config.js`

- `triggerConfig` → interruptor general.
- `triggerEvents` → catálogo de eventos conocidos (eventKey → label).
- `triggerRules` → las reglas (combinaciones de eventos → conversación + nota).

El resto de los módulos del motor (`trigger-engine.js`, `trigger-store.js`,
`trigger-actions.js`) **no se tocan** para configurar reglas.

---

## 3. Estructura de una regla

```js
{
    id: 'login',                 // identificador único (para lastFired)
    enabled: true,               // false = esta regla no dispara
    requiredEvents: ['login_portal'],  // combinación de eventos requeridos
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
    note: (events) => 'texto del mensaje privado',  // mensaje privado custom
}
```

### Campos clave

| Campo | Qué hace |
|-------|----------|
| `id` | Identificador único. Se usa para guardar `lastFired` por email y regla. |
| `enabled` | `false` desactiva la regla sin borrarla. |
| `requiredEvents` | Lista de eventKeys que **deben haber llegado todos** (sin importar el orden). Con 1 solo evento = regla individual. Con 2+ = regla combinada. |
| `repeatWindowMs` | `0` = repite siempre (cada nueva ocurrencia dispara). `>0` = no vuelve a disparar para el mismo email hasta que pase esa ventana (ms). Ej: `300000` = 5 min. |
| `action.reuseMode` | `'reopen'`: reutiliza la conversación abierta del canal; si hay una cerrada, la reabre; crea solo si nunca existió una en ese canal. `'open'`: reutiliza solo la abierta, crea si no hay. `'new'`: siempre crea conversación nueva. |
| `action.inboxId` | El canal de Chatwoot donde se crea/reutiliza la conversación. "Centro de Experiencias" = `38`. |
| `note` | Función que recibe `events` (datos de los eventos acumulados para el email) y devuelve el texto de la nota privada. |

---

## 4. Cómo configurar una o varias reglas

El motor evalúa **todas** las reglas en cada evento recibido (son
independientes y pueden correr a la vez). Ejemplos:

### a) Dos reglas individuales (cada evento → su conversación/nota)

```js
export const triggerRules = [
    {
        id: 'login',
        enabled: true,
        requiredEvents: ['login_portal'],
        repeatWindowMs: 0,
        action: { type: 'createConversation', inboxId: 38, assigneeId: 19, teamId: 4, reuseMode: 'reopen', createContactIfMissing: true, syncRD: true },
        note: (events) => mensajeLogin(events.login_portal),
    },
    {
        id: 'robot',
        enabled: true,
        requiredEvents: ['robot_encendido'],
        repeatWindowMs: 0,
        action: { type: 'createConversation', inboxId: 38, assigneeId: 19, teamId: 4, reuseMode: 'reopen', createContactIfMissing: true, syncRD: true },
        note: (events) => mensajeRobot(events.robot_encendido),
    },
];
```

### b) Una regla combinada (dispara cuando llegaron AMBOS, en cualquier orden)

```js
{
    id: 'login-y-robot',
    enabled: true,
    requiredEvents: ['login_portal', 'robot_encendido'],
    repeatWindowMs: 0,
    action: { type: 'createConversation', inboxId: 38, assigneeId: 19, teamId: 4, reuseMode: 'reopen', createContactIfMissing: true, syncRD: true },
    note: (events) => mensajeCombinado(events),   // usa datos de ambos
}
```

> Con `reuseMode: 'reopen'` y `repeatWindowMs: 0`, si conviven reglas
> individuales Y combinada, cada evento dispara las reglas que le
> corresponden. Diseñar las combinaciones para que no se pisen entre sí.

### c) Regla que no repite dentro de una ventana

```js
{
    id: 'robot-ventana',
    enabled: true,
    requiredEvents: ['robot_encendido'],
    repeatWindowMs: 24 * 60 * 60 * 1000,  // 1 vez por día
    action: { ... },
    note: (events) => mensajeRobot(events.robot_encendido),
}
```

---

## 5. Mensaje privado (nota)

La nota privada la define la función `note` de cada regla. Recibe:

```js
{
    login_portal:    { ...payload del evento login... },
    robot_encendido: { ...payload del evento robot... },
}
```

Es decir, los datos de **todos** los eventos acumulados para ese email. Se
puede editar el texto libremente (markdown de Chatwoot) y es distinto por
regla.

Ejemplo de función de mensaje combinado:

```js
const mensajeCombinado = (events) => {
    const login = events.login_portal || {};
    const robot = events.robot_encendido || {};
    return [
        '*El usuario se logueó al portal y encendió su robot iChef*',
        '',
        `• *Nombre:* ${login.clientName}`,
        `• *Email:* ${login.email}`,
        `• *ID del robot:* ${robot.robotId}`,
        `• *Versión de firmware:* ${robot.firmwareVersion}`,
        `• *Estado:* ${robot.status}`,
    ].join('\n');
};
```

> La nota se crea como `private: true` (nota interna, no se envía al
> contacto) y la conversación se marca como no leída.

---

## 6. Cómo agregar un nuevo disparador

Para agregar un evento nuevo (ej. "el usuario descargó una receta"):

### Paso 1 — Registrar la ruta (HTTP)
Archivo: `src/routes/v2/triggers.routes.js`

```js
import { loginPortal, robotEncendido, nuevaReceta } from '../../controllers/triggersEventos.controller.js';
...
router.post('/eventos/nueva-receta', nuevaReceta);
```

### Paso 2 — Crear el handler (adaptador HTTP)
Archivo: `src/controllers/triggersEventos.controller.js`

```js
export const nuevaReceta = handleEvent('nueva_receta');
```

> `handleEvent(eventKey)` ya valida el email, responde `202` y delega en el
> motor. Solo se indica el `eventKey` nuevo.

### Paso 3 — Declarar el eventKey
Archivo: `src/services/triggers/trigger-rules.config.js`

```js
export const triggerEvents = {
    login_portal:    { label: 'El usuario se logueó al portal de recetas' },
    robot_encendido: { label: 'El usuario encendió el robot iChef' },
    nueva_receta:    { label: 'El usuario descargó una receta' },
};
```

### Paso 4 — Definir la regla (o combinación)
En `triggerRules`, agregar la regla que use el nuevo eventKey (individual o
combinado con otros), con su `note`.

> Los pasos 1 y 2 requieren tocar código (ruta + handler). Los pasos 3 y 4
> son configuración.

---

## 7. Cómo probar

Servidor corriendo (`npm run dev`, puerto según `.env`, ej. 4002):

```bash
curl -X POST http://localhost:4002/api/v2/triggers/eventos/login-portal \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: <VALIDATOR_WEBHOOK_SECRET>" \
  -d '{"clientName":"Juan Pérez","robotId":"ABC123","email":"juan@example.com","cellphone":null,"user":"juan","lastDate":null,"firmwareVersion":"V1","status":"free"}'
```

Respuestas esperadas: `202` (procesa en background), `400` (email inválido),
`401` (secret inválido), `429` (rate limit).

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
import dotenv from 'dotenv';
dotenv.config();

// ============================================================
// Configuración del motor de eventos (triggers)
// ============================================================

// Interruptor general gestionado por VARIABLE DE ENTORNO:
//   TRIGGERS_ENABLED=true  → lógica de eventos y conversaciones activa
//   TRIGGERS_ENABLED=false → todo apagado (los endpoints responden 202
//                            pero no se registra ni crea nada)
// Cambiar el valor en .env y reiniciar el servidor.
export const triggerConfig = {
    enabled: process.env.TRIGGERS_ENABLED === 'true',
};

// Eventos conocidos (eventName → metadata). El eventName es el valor que
// envía el portal en el body (ej: "login-portal", "robot-encendido").
// Para agregar un evento/campaña nuevo:
//   1. Declararlo acá (con su label)
//   2. Definir su regla (o combinación) en triggerRules
//   3. Reiniciar el servidor
// No hace falta tocar rutas ni controladores.
export const triggerEvents = {
    'login-portal':    { label: 'El usuario se logueó al portal de recetas' },
    'robot-encendido': { label: 'El usuario encendió el robot iChef' },
};

// ── Formateo de datos para las notas internas ──────────────────────────

const bool = (v) => (v === true ? 'Sí' : v === false ? 'No' : null);

const formatEventData = (event = {}) => {
    const fields = [
        ['Nombre',            event.clientName],
        ['Email',             event.email],
        ['Celular',           event.cellphone],
        ['Usuario',           event.user],
        ['ID del robot',      event.robotId],
        ['Versión de firmware', event.firmwareVersion],
        ['Estado',            event.status],
        ['Última conexión',   event.lastDate],
        ['Conectado',         bool(event.connected)],
        ['Habilitado',        bool(event.enabled)],
        ['Activado',          bool(event.activated)],
        ['Bloqueado',         bool(event.blocked)],
        ['Betatester',        bool(event.betatester)],
    ].filter(([, v]) => v !== null && v !== undefined && v !== '');

    return fields.map(([k, v]) => `• *${k}:* ${v}`).join('\n');
};

// ── Mensajes privados (editables por regla) ─────────────────────────────
// Cada regla puede definir `note` de dos formas:
//   - Plantilla de texto (fácil): '{{label}}: {{clientName}} ({{email}})'
//     con placeholders {{label}}, {{eventName}} y {{campo}} del payload.
//   - Función (avanzado): (eventsData) => string, para notas complejas o
//     que combinan varios eventos.

const mensajeLogin = (event = {}) =>
    `*${triggerEvents['login-portal'].label}*\n\n` +
    `Se ha registrado un evento de actividad:\n\n` +
    formatEventData(event);

const mensajeRobot = (event = {}) =>
    `*${triggerEvents['robot-encendido'].label}*\n\n` +
    `Se ha registrado un evento de actividad:\n\n` +
    formatEventData(event);

// ── Reglas ──────────────────────────────────────────────────────────────
// Cada regla define qué combinación de eventos dispara la creación de una
// conversación con un mensaje privado custom.
//
//   - requiredEvents: 1..N eventNames; deben haber llegado TODOS (sin importar orden)
//   - repeatWindowMs: 0 = repite siempre; >0 = no vuelve a disparar para el
//                     mismo email hasta que pase la ventana (milisegundos)
//   - note:           plantilla de texto o función (ver arriba). Recibe los
//                     datos de TODOS los eventos acumulados para el email.
//   - action:         parámetros de la conversación.
//                     reuseMode:
//                       'reopen' (default) → reutiliza la abierta; si hay una
//                            cerrada en el canal la reabre; crea solo si nunca
//                            existió una en el canal.
//                       'open' → reutiliza solo la abierta; crea si no hay abierta.
//                       'new'  → siempre crea una conversación nueva.
export const triggerRules = [
    {
        id: 'login',
        enabled: true,
        requiredEvents: ['login-portal'],
        repeatWindowMs: 0,
        action: {
            type: 'createConversation',
            inboxId: 38,
            assigneeId: 19,
            teamId: 4,
            reuseMode: 'reopen',
            createContactIfMissing: true,
            syncRD: true,
        },
        note: (events) => mensajeLogin(events['login-portal']),
    },
    {
        id: 'robot',
        enabled: true,
        requiredEvents: ['robot-encendido'],
        repeatWindowMs: 0,
        action: {
            type: 'createConversation',
            inboxId: 38,
            assigneeId: 19,
            teamId: 4,
            reuseMode: 'reopen',
            createContactIfMissing: true,
            syncRD: true,
        },
        note: (events) => mensajeRobot(events['robot-encendido']),
    },
];
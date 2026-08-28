// ============================================================
// Configuración del motor de eventos (triggers)
// ============================================================
// Interruptor general: con `enabled: false` se apaga TODA la lógica
// de eventos y conversaciones (los endpoints siguen respondiendo 202
// al portal, pero no se registra ni crea nada).
//
// POR DEFECTO ESTÁ EN OFF: no se crearán conversaciones hasta que se
// avise al portal de recetas y se decida activarlo.
export const triggerConfig = {
    enabled: false,
};

// Eventos conocidos (eventKey → metadata). Para agregar un evento nuevo:
//   1. Registrar su ruta en src/routes/v2/triggers.routes.js
//   2. Declararlo acá (eventKey)
//   3. Definir su regla (o combinación) en triggerRules
export const triggerEvents = {
    login_portal:    { label: 'El usuario se logueó al portal de recetas' },
    robot_encendido: { label: 'El usuario encendió el robot iChef' },
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

const mensajeLogin = (event = {}) =>
    `*${triggerEvents.login_portal.label}*\n\n` +
    `Se ha registrado un evento de actividad:\n\n` +
    formatEventData(event);

const mensajeRobot = (event = {}) =>
    `*${triggerEvents.robot_encendido.label}*\n\n` +
    `Se ha registrado un evento de actividad:\n\n` +
    formatEventData(event);

// ── Reglas ──────────────────────────────────────────────────────────────
// Cada regla define qué combinación de eventos dispara la creación de una
// conversación con un mensaje privado custom.
//
//   - requiredEvents: 1..N eventKeys; deben haber llegado TODOS (sin importar orden)
//   - repeatWindowMs: 0 = repite siempre; >0 = no vuelve a disparar para el
//                     mismo email hasta que pase la ventana (milisegundos)
//   - note:           (eventsData) => string — mensaje privado custom.
//                     `eventsData` es { [eventKey]: <payload del evento> } con
//                     los datos de TODOS los eventos acumulados para el email.
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
        requiredEvents: ['login_portal'],
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
        note: (events) => mensajeLogin(events.login_portal),
    },
    {
        id: 'robot',
        enabled: true,
        requiredEvents: ['robot_encendido'],
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
        note: (events) => mensajeRobot(events.robot_encendido),
    },
];
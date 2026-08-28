import { processEvent } from '../services/triggers/trigger-engine.js';

/**
 * POST /api/v2/triggers/eventos/login-portal
 * POST /api/v2/triggers/eventos/robot-encendido
 *
 * Adaptador HTTP delgado: valida el email, responde 202 y delega el
 * procesamiento al motor de triggers (trigger-engine), que decide según
 * la configuración en src/services/triggers/trigger-rules.config.js
 * qué combinación de eventos dispara una conversación y con qué mensaje.
 *
 * Body esperado (evento del portal de recetas):
 * { "clientId", "clientName", "robotId", "email", "cellphone", ... }
 */
const handleEvent = (eventKey) => async (req, res) => {
    const event = req.body || {};
    const email = (event.email || '').trim();

    if (!email.includes('@')) {
        console.error(`[triggers-eventos] Body inválido (${eventKey}). Recibido:`, JSON.stringify(req.body));
        return res.status(400).json({
            success: false,
            error: 'Body inválido: se requiere un email válido'
        });
    }

    console.log(`[triggers-eventos] Evento ${eventKey} recibido para: ${email}`);

    // Responder inmediatamente (202) para evitar reintentos del portal
    res.status(202).json({
        success: true,
        message: 'Procesando en background',
        event: eventKey
    });

    setImmediate(async () => {
        try {
            const result = await processEvent({
                email,
                robotId: event.robotId || null,
                eventKey,
                data: event
            });
            console.log(`[triggers-eventos] ${eventKey} procesado (${email}):`, result);
        } catch (err) {
            console.error(`[triggers-eventos] ✗ ERROR procesando ${eventKey} (${email}):`, err.message);
            if (err.response?.status) console.error(`  HTTP ${err.response.status}`);
            if (err.response?.data)   console.error('  Detalle:', JSON.stringify(err.response.data));
        }
    });
};

export const loginPortal = handleEvent('login_portal');
export const robotEncendido = handleEvent('robot_encendido');
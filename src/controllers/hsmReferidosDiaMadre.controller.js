import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// ============================================================
// Dedupe robusto: por lead (uuid/id) + número + campaña
// TTL configurable vía env (por defecto 24 horas)
// ============================================================
const sentRegistry = new Map(); // key: "campaña:leadId:number" -> timestamp
const DEDUPE_TTL_MS = Number(process.env.HSM_DEDUPE_TTL_MS || 24 * 60 * 60 * 1000); // 24h

const CAMPAIGN_KEY = 'referidos-dia-madre-2026';

const cleanupRegistry = () => {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, ts] of sentRegistry.entries()) {
        if (now - ts > DEDUPE_TTL_MS) {
            sentRegistry.delete(key);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        console.log(`[${CAMPAIGN_KEY}] Cleanup: eliminadas ${cleaned} entradas antiguas del registro`);
    }
};

// Cleanup automático cada hora
setInterval(cleanupRegistry, 60 * 60 * 1000);

const wasSentRecently = (leadId, number) => {
    const key = `${CAMPAIGN_KEY}:${leadId}:${number}`;
    const ts = sentRegistry.get(key);
    if (!ts) return false;
    return (Date.now() - ts) <= DEDUPE_TTL_MS;
};

const markAsSent = (leadId, number) => {
    const key = `${CAMPAIGN_KEY}:${leadId}:${number}`;
    sentRegistry.set(key, Date.now());
};

// ============================================================
// Normalización de número WhatsApp (Uruguay - código 598)
// ============================================================
const pickPhoneRaw = (lead) =>
    lead?.mobile_phone || lead?.personal_phone || lead?.phone || null;

const normalizeWhatsappNumber = (raw) => {
    if (!raw || typeof raw !== 'string') return null;
    const digits = raw.replace(/\D/g, '');
    if (!digits) return null;
    if (digits.startsWith('598')) return digits;
    if (digits.length === 9 && digits.startsWith('0')) return `598${digits.slice(1)}`;
    return null;
};

// ============================================================
// Handler principal
// POST /api/v2/hsm/referidos-dia-madre
// Body esperado (viene de automatización RD Station):
// { "leads": [ { "id", "uuid", "email", "mobile_phone", ... }, ... ] }
// ============================================================
const hsmReferidosDiaMadre = async (req, res) => {
    const EVOLUTION_SENDMEDIA_URL =
        process.env.EVOLUTION_SENDMEDIA_URL ||
        'https://evolution-evolution.5vsa59.easypanel.host/message/sendMedia/iChef%20Center%20Wpp';
    const EVOLUTION_APIKEY =
        process.env.EVOLUTION_APIKEY || '49C2506BEDA7-46A6-8EC3-C8ABD1EA0551';

    // URL pública de la imagen (requiere BACKEND_URL configurado en .env)
    const BACKEND_URL = (process.env.BACKEND_URL || '').replace(/\/$/, '');
    const IMAGE_URL = `${BACKEND_URL}/assets/Wapp-Referi-y-gana.png`;

    const MESSAGE_TEXT =
        '🎁 iChef Lovers, este Día de la Madre tienen un regalo esperándolos. ' +
        'Si referís a un amigo y compra su iChef con la promo especial (USD 1.290), ' +
        'vos te llevás un bolso iChef o un slicer rallador rebanador a elección (valor USD 120). ' +
        'Es simple: compartís tu amor por iChef, tu amigo compra, vos ganás. ' +
        '¡Aprovechá que es solo por esta promo!';

    const listaLeads = req.body;
    console.log(`[${CAMPAIGN_KEY}] Leads recibidos:`, listaLeads);

    const leads = listaLeads?.leads;
    if (!Array.isArray(leads) || leads.length === 0) {
        return res.status(400).json({
            success: false,
            error: 'Body inválido: se esperaba { leads: [...] }'
        });
    }

    if (!BACKEND_URL) {
        return res.status(500).json({
            success: false,
            error: 'BACKEND_URL no configurado en variables de entorno'
        });
    }

    // Responder inmediatamente (202) para evitar reintentos de RD Station
    res.status(202).json({
        success: true,
        message: 'Procesando en background',
        received: leads.length
    });

    // Procesar envíos en background
    setImmediate(async () => {
        cleanupRegistry();

        const results = {
            received: leads.length,
            sent: 0,
            skipped: 0,
            errors: 0,
            details: []
        };

        // Dedupe dentro del mismo request (evita duplicados en el array leads[])
        const seenInThisRequest = new Set();

        for (const lead of leads) {
            const rawPhone = pickPhoneRaw(lead);
            const number = normalizeWhatsappNumber(rawPhone);

            if (!number) {
                results.skipped += 1;
                results.details.push({
                    leadId: lead?.id,
                    email: lead?.email,
                    reason: 'No se encontró celular válido',
                    rawPhone
                });
                continue;
            }

            // Identificador único del lead (priorizar uuid, luego id, luego email)
            const leadId = lead?.uuid || lead?.id || lead?.email || number;
            const dedupKey = `${leadId}:${number}`;

            // 1. Dedupe dentro del mismo request
            if (seenInThisRequest.has(dedupKey)) {
                results.skipped += 1;
                results.details.push({
                    leadId: lead?.id,
                    email: lead?.email,
                    number,
                    reason: 'Duplicado en este request (mismo lead/número repetido)'
                });
                continue;
            }
            seenInThisRequest.add(dedupKey);

            // 2. Dedupe persistente (entre requests / reintentos de RD Station)
            if (wasSentRecently(leadId, number)) {
                const elapsed = Date.now() - sentRegistry.get(`${CAMPAIGN_KEY}:${leadId}:${number}`);
                results.skipped += 1;
                results.details.push({
                    leadId: lead?.id,
                    email: lead?.email,
                    number,
                    reason: `Ya enviado en esta campaña hace ${Math.round(elapsed / 60000)} min`
                });
                continue;
            }

            try {
                await axios.post(
                    EVOLUTION_SENDMEDIA_URL,
                    {
                        number,
                        mediatype: 'image',
                        media: IMAGE_URL,
                        caption: MESSAGE_TEXT
                    },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            apikey: EVOLUTION_APIKEY
                        },
                        timeout: 30000
                    }
                );

                markAsSent(leadId, number);
                results.sent += 1;
                results.details.push({
                    leadId: lead?.id,
                    email: lead?.email,
                    number,
                    status: 'sent'
                });

                console.log(`[${CAMPAIGN_KEY}] ✓ Enviado: ${number} (${lead?.email})`);

            } catch (sendError) {
                results.errors += 1;
                const status = sendError?.response?.status;
                const data = sendError?.response?.data;

                console.error(`[${CAMPAIGN_KEY}] ✗ Error enviando a ${number}:`, {
                    leadId: lead?.id,
                    email: lead?.email,
                    status,
                    data,
                    message: sendError?.message
                });

                results.details.push({
                    leadId: lead?.id,
                    email: lead?.email,
                    number,
                    status: 'error',
                    error: sendError?.message,
                    evolutionStatus: status,
                    evolutionData: data
                });
            }

            // Pequeño delay entre mensajes (evita sobrecarga en Evolution)
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        console.log(`[${CAMPAIGN_KEY}] Resumen final:`, {
            received: results.received,
            sent: results.sent,
            skipped: results.skipped,
            errors: results.errors
        });
    });
};

export default hsmReferidosDiaMadre;

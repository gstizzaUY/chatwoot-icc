import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// ============================================================
// Dedupe robusto: por lead (uuid/id) + número + campaña
// TTL configurable vía env (por defecto 24 horas)
// ============================================================
const sentRegistry = new Map(); // key: "campaña:leadId:number" -> timestamp
const DEDUPE_TTL_MS = Number(process.env.HSM_DEDUPE_TTL_MS || 24 * 60 * 60 * 1000); // 24h

const CAMPAIGN_KEY = 'ciber-lunes-2026';

const SAILBOT_API_URL =
    'https://app.sailbot.biz/Bot-Server/api/messages/whatsapp-template';
const SAILBOT_AUTH = 'Basic aWNoZWZAbWFpbC5jb206c2FpbGJvdDIwMjA=';

// WhatsApp Business account "from" (número de origen fijo en Sailbot)
const SAILBOT_FROM = '587863384414365';

const TEMPLATE_NAME = 'ciber_lunes_2026';
const TEMPLATE_VARIABLES = [
    {
        header_image:
            'https://img.auctiva.com/imgdata/1/5/5/1/4/3/4/webimg/1179300485_o.png'
    }
];

// ============================================================
// Helpers de dedupe
// ============================================================
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
    return Date.now() - ts <= DEDUPE_TTL_MS;
};

const markAsSent = (leadId, number) => {
    const key = `${CAMPAIGN_KEY}:${leadId}:${number}`;
    sentRegistry.set(key, Date.now());
};

// ============================================================
// Normalización de número WhatsApp (Uruguay - código 598)
// Devuelve solo dígitos con código de país, ej.: "59898631908"
// ============================================================
const pickPhoneRaw = (lead) =>
    lead?.mobile_phone || lead?.personal_phone || lead?.phone || null;

const normalizeWhatsappNumber = (raw) => {
    if (!raw || typeof raw !== 'string') return null;
    const digits = raw.replace(/\D/g, '');
    if (!digits) return null;
    if (digits.startsWith('598')) return digits;
    if (digits.length === 9 && digits.startsWith('0')) return `598${digits.slice(1)}`;
    // Número de 8 dígitos sin código ni cero inicial (ej. 98631908)
    if (digits.length === 8) return `598${digits}`;
    return null;
};

// ============================================================
// Handler principal
// POST /api/v2/hsm/ciber-lunes-2026
// Body esperado (viene de automatización RD Station):
// { "leads": [ { "id", "uuid", "email", "mobile_phone", ... }, ... ] }
// ============================================================
const ciberLunes2026 = async (req, res) => {
    const listaLeads = req.body;
    console.log(`[${CAMPAIGN_KEY}] Leads recibidos:`, listaLeads);

    const leads = listaLeads?.leads;
    if (!Array.isArray(leads) || leads.length === 0) {
        return res.status(400).json({
            success: false,
            error: 'Body inválido: se esperaba { leads: [...] }'
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
                console.warn(
                    `[${CAMPAIGN_KEY}] ⚠ Número inválido — lead: ${lead?.id || lead?.email} | rawPhone: ${rawPhone}`
                );
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
                console.log(
                    `[${CAMPAIGN_KEY}] ⤷ Skipped (dedupe): ${number} (${lead?.email}) — enviado hace ${Math.round(elapsed / 60000)} min`
                );
                continue;
            }

            try {
                await axios.post(
                    SAILBOT_API_URL,
                    {
                        from: SAILBOT_FROM,
                        templateName: TEMPLATE_NAME,
                        to: [
                            {
                                contactPhone: number,
                                variables: TEMPLATE_VARIABLES
                            }
                        ]
                    },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: SAILBOT_AUTH
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

                console.log(
                    `[${CAMPAIGN_KEY}] ✅ Enviado correctamente — número: ${number} | lead: ${lead?.id || lead?.email}`
                );

            } catch (sendError) {
                results.errors += 1;
                const status = sendError?.response?.status;
                const data = sendError?.response?.data;

                console.error(`[${CAMPAIGN_KEY}] ❌ Error enviando a ${number}:`, {
                    leadId: lead?.id,
                    email: lead?.email,
                    httpStatus: status,
                    responseData: data,
                    message: sendError?.message
                });

                results.details.push({
                    leadId: lead?.id,
                    email: lead?.email,
                    number,
                    status: 'error',
                    error: sendError?.message,
                    sailbotStatus: status,
                    sailbotData: data
                });
            }

            // Pequeño delay entre mensajes (evita sobrecarga en Sailbot)
            await new Promise((resolve) => setTimeout(resolve, 500));
        }

        console.log(`[${CAMPAIGN_KEY}] 📊 Resumen final:`, {
            received: results.received,
            sent: results.sent,
            skipped: results.skipped,
            errors: results.errors
        });
    });
};

export default ciberLunes2026;

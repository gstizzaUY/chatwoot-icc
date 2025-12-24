import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// Dedupe robusto: por lead (uuid/id) + número + campaña
// TTL configurable vía env (por defecto 24 horas)
const sentRegistry = new Map(); // key: "campaña:leadId:number" -> timestamp
const DEDUPE_TTL_MS = Number(process.env.HSM_DEDUPE_TTL_MS || 24 * 60 * 60 * 1000); // 24h

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
        console.log(`[Cleanup] Eliminadas ${cleaned} entradas antiguas del registro`);
    }
};

// Cleanup automático cada hora
setInterval(cleanupRegistry, 60 * 60 * 1000);

const wasSentRecently = (campaignKey, leadId, number) => {
    const key = `${campaignKey}:${leadId}:${number}`;
    const ts = sentRegistry.get(key);
    if (!ts) return false;
    return (Date.now() - ts) <= DEDUPE_TTL_MS;
};

const markAsSent = (campaignKey, leadId, number) => {
    const key = `${campaignKey}:${leadId}:${number}`;
    sentRegistry.set(key, Date.now());
};

const hsmWebinar = async (req, res) => {

    const EVOLUTION_SENDTEXT_URL = process.env.EVOLUTION_SENDTEXT_URL || 'https://evolution-evolution.5vsa59.easypanel.host/message/sendText/iChef%20Center%20Wpp';
    const EVOLUTION_APIKEY = process.env.EVOLUTION_APIKEY || '49C2506BEDA7-46A6-8EC3-C8ABD1EA0551';

    const WEBINAR_TEXT = '¡Hola! 😊\n' +
        'Esperamos que estés disfrutando tu iChef.\n\n' +
        'Queremos invitarte a un webinar especial este martes a las 17 hs, junto a Neiff Cardozo.\n' +
        'Vamos a preparar vitel toné y a charlar sobre todas sus particularidades, tips y secretos para que te quede perfecto.\n\n' +
        '📺 La transmisión será en vivo por YouTube:\n' +
        '👉 https://youtube.com/live/Rk3gyZNNG9A?feature=share\n\n' +
        '¡Te esperamos para cocinar y aprender juntos! 🍽️✨';

    const listaLeads = req.body;
    console.log('Leads recibidos en hsmWebinar:', listaLeads);

    const leads = listaLeads?.leads;
    if (!Array.isArray(leads) || leads.length === 0) {
        return res.status(400).json({
            success: false,
            error: 'Body inválido: se esperaba { leads: [...] }'
        });
    }

    const pickPhoneRaw = (lead) => {
        return lead?.mobile_phone || lead?.personal_phone || lead?.phone || null;
    };

    const normalizeWhatsappNumber = (raw) => {
        if (!raw || typeof raw !== 'string') return null;

        const digits = raw.replace(/\D/g, '');
        if (!digits) return null;

        if (digits.startsWith('598')) return digits;

        if (digits.length === 9 && digits.startsWith('0')) {
            return `598${digits.slice(1)}`;
        }

        return null;
    };

    // Responder inmediatamente a RD Station (evita reintentos)
    res.status(202).json({
        success: true,
        message: 'Procesando en background',
        received: leads.length
    });

    // Procesar envíos en background (sin bloquear la respuesta)
    setImmediate(async () => {
        cleanupRegistry();

        const results = {
            received: leads.length,
            sent: 0,
            skipped: 0,
            errors: 0,
            details: []
        };

        const CAMPAIGN_KEY = 'webinar-vitel-tone';
        
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

            // 2. Dedupe persistente (entre requests/reintentos de RD Station)
            if (wasSentRecently(CAMPAIGN_KEY, leadId, number)) {
                results.skipped += 1;
                const elapsed = Date.now() - sentRegistry.get(`${CAMPAIGN_KEY}:${leadId}:${number}`);
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
                    EVOLUTION_SENDTEXT_URL,
                    {
                        number,
                        text: WEBINAR_TEXT,
                        linkPreview: false,
                    },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            apikey: EVOLUTION_APIKEY
                        },
                        timeout: 30000 // Aumentado a 30s
                    }
                );

                // Marcar como enviado (dedupe persistente)
                markAsSent(CAMPAIGN_KEY, leadId, number);
                
                results.sent += 1;
                results.details.push({
                    leadId: lead?.id,
                    email: lead?.email,
                    number,
                    status: 'sent'
                });

                console.log(`✓ WhatsApp enviado: ${number} (${lead?.email})`);

            } catch (sendError) {
                results.errors += 1;
                const status = sendError?.response?.status;
                const data = sendError?.response?.data;
                
                console.error('Error enviando WhatsApp (Evolution):', {
                    leadId: lead?.id,
                    email: lead?.email,
                    number,
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

        console.log('Resumen final de envíos:', {
            received: results.received,
            sent: results.sent,
            skipped: results.skipped,
            errors: results.errors
        });
    });
};


export default hsmWebinar;
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

const saludoFinAno2025 = async (req, res) => {

    const EVOLUTION_SENDMEDIA_URL = process.env.EVOLUTION_SENDMEDIA_URL || 'https://evolution-evolution.5vsa59.easypanel.host/message/sendMedia/iChef%20Center%20Wpp';
    const EVOLUTION_APIKEY = process.env.EVOLUTION_APIKEY || '49C2506BEDA7-46A6-8EC3-C8ABD1EA0551';

    const FIN_ANO_TEXT = '💚 Gracias por elegir iChef cada día.\n' +
        'Por sumar tu experiencia, tus ideas, tus ganas.\n' +
        'Porque con vos, esto no es solo una comunidad…\n' +
        'es una mesa larga donde siempre hay lugar para uno más.\n\n' +
        'Que este fin de año te encuentre ahí:\n' +
        'rodeado de los tuyos, compartiendo una comida como más nos gusta.';
    
    const VIDEO_URL = 'https://youtube.com/shorts/WydoBA7PszU';
    const VIDEO_THUMBNAIL = 'https://img.auctiva.com/imgdata/1/5/5/1/4/3/4/webimg/1173290492_o.png';

    const listaLeads = req.body;
    console.log('Leads recibidos en saludoFinAno2025:', listaLeads);

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

        const CAMPAIGN_KEY = 'fin-ano-2025';
        
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
                // Enviar imagen (poster del video) con texto + link en el caption
                await axios.post(
                    EVOLUTION_SENDMEDIA_URL,
                    {
                        number,
                        mediatype: 'image',
                        media: VIDEO_THUMBNAIL,
                        caption: `${FIN_ANO_TEXT}\n\n${VIDEO_URL}`
                    },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            apikey: EVOLUTION_APIKEY
                        },
                        timeout: 30000
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

                console.log(`✓ WhatsApp enviado (Fin de Año): ${number} (${lead?.email})`);

            } catch (sendError) {
                results.errors += 1;
                const status = sendError?.response?.status;
                const data = sendError?.response?.data;
                
                console.error('Error enviando WhatsApp (Evolution - Fin de Año):', {
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

        console.log('Resumen final de envíos (Fin de Año 2025):', {
            received: results.received,
            sent: results.sent,
            skipped: results.skipped,
            errors: results.errors
        });
    });
};

export default saludoFinAno2025;

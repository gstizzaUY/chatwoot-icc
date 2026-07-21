import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const CAMPAIGN_KEY = 'confirmacion_pedido_web';

const SAILBOT_API_URL =
    'https://app.sailbot.biz/Bot-Server/api/messages/whatsapp-template';
const SAILBOT_AUTH = 'Basic aWNoZWZAbWFpbC5jb206c2FpbGJvdDIwMjA=';
const SAILBOT_FROM = '587863384414365';
const TEMPLATE_NAME = 'confirmacion_pedido_web';

const normalizeWhatsappNumber = (raw) => {
    if (!raw || typeof raw !== 'string') return null;
    const digits = raw.replace(/\D/g, '');
    if (!digits) return null;
    if (digits.startsWith('598')) return digits;
    if (digits.length === 9 && digits.startsWith('0')) return `598${digits.slice(1)}`;
    if (digits.length === 8) return `598${digits}`;
    return null;
};

const buildVariables = (order, customer, items) => {
    const orderNumber = String(order?.number || order?.id || 'N/A');
    const name = customer?.name || 'cliente';

    let productText;
    if (items && items.length === 1) {
        productText = items[0].name;
    } else if (items && items.length > 1) {
        productText = items.map((i) => `${i.name} x${i.quantity || 1}`).join(', ');
    } else {
        productText = 'No especificado';
    }

    const total = String(order?.total || '0');

    return [
        { order_number: orderNumber },
        { name: name },
        { total: total },
        { product: productText }
    ];
};

const confirmacionPedidoWeb = async (req, res) => {
    const body = req.body;
    console.log(`[${CAMPAIGN_KEY}] Pedido recibido:`, body);

    const { order, customer, items } = body;

    if (!customer?.phone) {
        return res.status(400).json({
            success: false,
            error: 'Falta customer.phone'
        });
    }

    res.status(202).json({
        success: true,
        message: 'Procesando en background'
    });

    setImmediate(async () => {
        const rawPhone = customer.phone;
        const number = normalizeWhatsappNumber(rawPhone);

        if (!number) {
            console.error(`[${CAMPAIGN_KEY}] Número inválido: ${rawPhone} (pedido #${order?.number})`);
            return;
        }

        const variables = buildVariables(order, customer, items);

        const sailbotPayload = {
            from: SAILBOT_FROM,
            templateName: TEMPLATE_NAME,
            to: [
                {
                    contactPhone: number,
                    variables
                }
            ]
        };

        console.log(`[${CAMPAIGN_KEY}] Payload a Sailbot:`, JSON.stringify(sailbotPayload, null, 2));
        console.log(`[${CAMPAIGN_KEY}] Variables generadas:`, variables);

        try {
            const response = await axios.post(
                SAILBOT_API_URL,
                sailbotPayload,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: SAILBOT_AUTH
                    },
                    timeout: 30000
                }
            );

            console.log(`[${CAMPAIGN_KEY}] Sailbot response:`, {
                status: response.status,
                data: response.data
            });
            console.log(`[${CAMPAIGN_KEY}] Template WhatsApp enviado — pedido #${order?.number} a ${number}`);
        } catch (sendError) {
            console.error(`[${CAMPAIGN_KEY}] Error Sailbot:`, {
                requestBody: JSON.stringify(sailbotPayload),
                status: sendError?.response?.status,
                data: JSON.stringify(sendError?.response?.data),
                message: sendError?.message
            });
        }
    });
};

export default confirmacionPedidoWeb;

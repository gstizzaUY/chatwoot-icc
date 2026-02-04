import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Normaliza un número de teléfono uruguayo al formato internacional
 * Misma función que en rdStationControllers.js
 */
const normalizeUruguayanPhone = (phone) => {
    if (!phone) return null;

    // Limpiar el teléfono de todo excepto dígitos
    let cleanPhone = phone.replace(/\D/g, '');

    // Si ya tiene el código de país, validar longitud
    if (cleanPhone.startsWith('598')) {
        // Uruguay: +598 + 8 o 9 dígitos = 11 o 12 dígitos totales
        if (cleanPhone.length === 11 || cleanPhone.length === 12) {
            return cleanPhone;
        }
        return null; // Formato inválido
    }

    // Si es un número uruguayo sin código de país
    // Celulares: 09X XXXXXX (9 dígitos) -> +598 9X XXXXXX
    // Fijos: 0X XXX XXXX (9 dígitos) -> +598 X XXX XXXX
    if (cleanPhone.length === 9 && cleanPhone.startsWith('0')) {
        return '598' + cleanPhone.substring(1); // Quitar el 0 inicial y agregar 598
    }

    // Si tiene 8 dígitos y empieza con 9 (celular sin el 0)
    if (cleanPhone.length === 8 && cleanPhone.startsWith('9')) {
        return '598' + cleanPhone;
    }

    // Si tiene 8 dígitos y NO empieza con 9 (fijo sin el 0)
    if (cleanPhone.length === 8 && !cleanPhone.startsWith('9')) {
        return '598' + cleanPhone;
    }

    // Otros casos: intentar agregar 598 si tiene una longitud razonable
    if (cleanPhone.length >= 8 && cleanPhone.length <= 9) {
        return '598' + cleanPhone;
    }

    console.log(`⚠️ [Onboarding] Número de teléfono con formato no reconocido: ${phone}`);
    return null;
};

const onboardingHsmStarterPack = async (req, res) => {
    const reqId = Math.random().toString(36).substring(7);
    
    console.log(`🚀 [${reqId}] Iniciando onboardingHsmStarterPack`);

    const ONBOARDING_TEXT = '¡Bienvenido/a a la familia iChef! 👩‍🍳🤖\n\n' +
        'Para que empieces a disfrutar tu robot desde el primer momento, preparamos una guía rápida de inicio — nuestro Starter Pack iChef 🚀\n\n' +
        'Ahí vas a encontrar, paso a paso y con videos, todo lo que necesitás para:\n' +
        '✔️ Verificar los accesorios\n' +
        '✔️ Conectar el robot al Wi-Fi\n' +
        '✔️ Descargar la app y empezar a cocinar\n\n' +
        '👉 Iniciá ahora acá: https://ichef.com.uy/starter-pack\n\n' +
        'En pocos minutos tu iChef va a estar listo para cocinar contigo 🍪✨\n' +
        'Y si necesitás ayuda, estamos siempre para acompañarte 💬';

    try {
        // Procesar identificación única (igual que actualizacionFirmwareNh2025101735)
        let dataEntry = req.body;
        if (dataEntry.leads && Array.isArray(dataEntry.leads) && dataEntry.leads.length > 0) {
            dataEntry = dataEntry.leads[0];
        } else if (dataEntry.contact) {
            dataEntry = dataEntry.contact;
        }

        console.log(`📋 [${reqId}] Data entry:`, JSON.stringify(dataEntry, null, 2));

        const rawPhone = dataEntry.mobile_phone || dataEntry.personal_phone || dataEntry.tele_movil || dataEntry.phone || dataEntry.phone_number || '';
        console.log(`📞 [${reqId}] Raw phone: ${rawPhone}`);

        const cleanPhone = normalizeUruguayanPhone(rawPhone);
        console.log(`📞 [${reqId}] Clean phone: ${cleanPhone}`);

        // Validar que el número de teléfono sea válido
        if (!cleanPhone) {
            console.log(`❌ [${reqId}] Número de teléfono inválido: ${rawPhone}`);
            return res.status(400).json({
                success: false,
                message: 'Número de teléfono inválido o formato no reconocido',
                phone: rawPhone
            });
        }

        console.log(`📤 [${reqId}] Enviando mensaje a ${cleanPhone}...`);

        // Enviar WhatsApp directamente (igual que actualizacionFirmwareNh2025101735)
        await axios.post(
            'https://evolution-evolution.5vsa59.easypanel.host/message/sendText/iChef%20Center%20Wpp',
            {
                number: cleanPhone,
                text: ONBOARDING_TEXT
            },
            {
                headers: {
                    'apikey': '49C2506BEDA7-46A6-8EC3-C8ABD1EA0551'
                }
            }
        );

        console.log(`✅ [${reqId}] Mensaje enviado exitosamente a ${cleanPhone}`);

        return res.status(200).json({
            success: true,
            message: 'Mensaje enviado exitosamente',
            phone: cleanPhone
        });

    } catch (error) {
        console.error(`❌ [${reqId}] Error:`, error.message);
        if (error.response) {
            console.error(`📋 [${reqId}] Response status: ${error.response.status}`);
            console.error(`📋 [${reqId}] Response data:`, JSON.stringify(error.response.data, null, 2));
        }
        return res.status(500).json({
            success: false,
            error: error.message,
            details: error.response?.data
        });
    }
};

export default onboardingHsmStarterPack;
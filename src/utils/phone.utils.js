/**
 * Utilidades para normalización y validación de números de teléfono
 */

// Constantes de códigos de país
export const COUNTRY_CODES = {
    'UY': '598',
    'AR': '54',
    'BR': '55',
    'CL': '56',
    'CO': '57',
    'PE': '51',
    'EC': '593',
    'BO': '591',
    'PY': '595',
    'VE': '58'
};

/**
 * Normaliza un número de teléfono a formato E164 (+código_país + número)
 * Soporta múltiples países de América Latina
 * 
 * @param {string} phone - Número de teléfono en cualquier formato
 * @param {string} country - Código ISO del país (UY, AR, BR, etc.)
 * @returns {string|null} - Número en formato E164 o null si inválido
 * 
 * @example
 * normalizePhone('099 123 456', 'UY') // '+59899123456'
 * normalizePhone('598 99 123 456', 'UY') // '+59899123456'
 * normalizePhone('+598 99 123 456') // '+59899123456'
 */
export function normalizePhone(phone, country = 'UY') {
    if (!phone || typeof phone !== 'string') return null;
    
    // Si ya tiene el formato E164 (empieza con +), limpiar y validar
    if (phone.startsWith('+')) {
        const cleanPhone = phone.replace(/\D/g, '');
        return cleanPhone.length >= 10 ? `+${cleanPhone}` : null;
    }
    
    // Limpiar el número de espacios, guiones y otros caracteres
    const cleanPhone = phone.replace(/\D/g, '');
    
    // Si no es un número válido, retornar null
    if (!cleanPhone || cleanPhone.length < 7) return null;
    
    const countryCode = COUNTRY_CODES[country] || '598'; // Default a Uruguay
    
    // Si el número ya incluye el código de país, agregarlo solo con +
    if (cleanPhone.startsWith(countryCode)) {
        return `+${cleanPhone}`;
    }
    
    // Para Uruguay: si empieza con 0, quitarlo (09X es formato local)
    if (country === 'UY' && cleanPhone.startsWith('0') && cleanPhone.length === 9) {
        return `+598${cleanPhone.slice(1)}`;
    }
    
    // Si es un número local, agregar el código de país
    return `+${countryCode}${cleanPhone}`;
}

/**
 * Normaliza específicamente para WhatsApp (formato sin +)
 * 
 * @param {string} phone - Número de teléfono
 * @returns {string|null} - Número sin el prefijo + (ej: '59899123456')
 * 
 * @example
 * normalizeWhatsAppNumber('+598 99 123 456') // '59899123456'
 */
export function normalizeWhatsAppNumber(phone) {
    const normalized = normalizePhone(phone);
    return normalized ? normalized.replace('+', '') : null;
}

/**
 * Valida si un número de teléfono es válido
 * 
 * @param {string} phone - Número a validar
 * @returns {boolean}
 */
export function isValidPhone(phone) {
    if (!phone || typeof phone !== 'string') return false;
    const cleanPhone = phone.replace(/\D/g, '');
    return /^\d{7,15}$/.test(cleanPhone);
}

/**
 * Detecta el país del número de teléfono basándose en el código
 * 
 * @param {string} phone - Número de teléfono
 * @returns {string|null} - Código ISO del país o null
 * 
 * @example
 * detectCountry('+59899123456') // 'UY'
 * detectCountry('+5491112345678') // 'AR'
 */
export function detectCountry(phone) {
    if (!phone) return null;
    
    const cleanPhone = phone.replace(/\D/g, '');
    
    // Buscar coincidencia con códigos de país
    for (const [countryCode, phonePrefix] of Object.entries(COUNTRY_CODES)) {
        if (cleanPhone.startsWith(phonePrefix)) {
            return countryCode;
        }
    }
    
    return null;
}

/**
 * Formatea un número de teléfono para mostrar de forma legible
 * 
 * @param {string} phone - Número de teléfono
 * @param {string} format - 'international' | 'local' | 'e164'
 * @returns {string}
 */
export function formatPhoneDisplay(phone, format = 'international') {
    const normalized = normalizePhone(phone);
    
    if (!normalized) return phone;
    
    if (format === 'e164') {
        return normalized;
    }
    
    const country = detectCountry(normalized);
    
    if (format === 'international') {
        // Formato: +598 99 123 456
        const digits = normalized.replace('+', '');
        if (country === 'UY' && digits.length === 11) {
            return `+${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
        }
        return normalized;
    }
    
    if (format === 'local' && country === 'UY') {
        // Formato: 099 123 456
        const digits = normalized.replace(/\D/g, '');
        if (digits.startsWith('598')) {
            const localNumber = digits.slice(3);
            return `0${localNumber.slice(0, 2)} ${localNumber.slice(2, 5)} ${localNumber.slice(5)}`;
        }
    }
    
    return normalized;
}

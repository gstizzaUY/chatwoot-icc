/**
 * Utilidades para generación y validación de emails
 */

/**
 * Genera un email ficticio basado en el número de teléfono
 * Usado cuando el contacto no tiene email en Chatwoot (campo obligatorio en RD Station)
 * 
 * @param {string} phone - Número de teléfono
 * @param {string} domain - Dominio para el email (default: 'email.com')
 * @returns {string|null} - Email generado o null si no hay teléfono
 * 
 * @example
 * generateEmailFromPhone('+598 99 123 456') // '59899123456@email.com'
 * generateEmailFromPhone('099 123 456', 'ichef.com.uy') // '59899123456@ichef.com.uy'
 */
export function generateEmailFromPhone(phone, domain = 'email.com') {
    if (!phone || typeof phone !== 'string') return null;
    const cleanPhone = phone.replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 7) return null;
    return `${cleanPhone}@${domain}`;
}

/**
 * Valida si un email tiene formato válido
 * 
 * @param {string} email - Email a validar
 * @returns {boolean}
 * 
 * @example
 * isValidEmail('test@example.com') // true
 * isValidEmail('invalid-email') // false
 */
export function isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
}

/**
 * Normaliza un email (lowercase, trim)
 * 
 * @param {string} email
 * @returns {string}
 */
export function normalizeEmail(email) {
    if (!email) return '';
    return email.trim().toLowerCase();
}

/**
 * Verifica si un email es generado (ficticio) o real
 * 
 * @param {string} email
 * @returns {boolean} - true si es email ficticio
 * 
 * @example
 * isFakeEmail('59899123456@email.com') // true
 * isFakeEmail('usuario@gmail.com') // false
 */
export function isFakeEmail(email) {
    if (!email) return false;
    return /@email\.com$/.test(email);
}

/**
 * Extrae el dominio de un email
 * 
 * @param {string} email
 * @returns {string|null}
 * 
 * @example
 * extractDomain('user@example.com') // 'example.com'
 */
export function extractDomain(email) {
    if (!isValidEmail(email)) return null;
    const parts = email.split('@');
    return parts[1] || null;
}

/**
 * Valida si un dominio de email es común/conocido
 * 
 * @param {string} email
 * @returns {boolean}
 */
export function isCommonEmailDomain(email) {
    const domain = extractDomain(email);
    if (!domain) return false;
    
    const commonDomains = [
        'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com',
        'icloud.com', 'live.com', 'msn.com', 'protonmail.com',
        'aol.com', 'zoho.com'
    ];
    
    return commonDomains.includes(domain.toLowerCase());
}

/**
 * Ofusca un email para mostrar de forma segura
 * 
 * @param {string} email
 * @returns {string}
 * 
 * @example
 * obfuscateEmail('usuario@example.com') // 'us***io@example.com'
 */
export function obfuscateEmail(email) {
    if (!isValidEmail(email)) return email;
    
    const [local, domain] = email.split('@');
    
    if (local.length <= 3) {
        return `${local[0]}***@${domain}`;
    }
    
    const start = local.slice(0, 2);
    const end = local.slice(-2);
    return `${start}***${end}@${domain}`;
}

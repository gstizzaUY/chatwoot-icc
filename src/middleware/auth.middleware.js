import dotenv from 'dotenv';

dotenv.config();

/**
 * Middleware de autenticación para webhooks
 * Valida tokens específicos en el header Authorization
 * 
 * @param {string} tokenEnvVar - Nombre de la variable de entorno con el token esperado
 * @returns {Function} - Middleware de Express
 */
export function authenticateWebhook(tokenEnvVar) {
    return (req, res, next) => {
        const authHeader = req.headers.authorization;
        const expectedToken = process.env[tokenEnvVar];

        // Validar que el token exista en .env
        if (!expectedToken) {
            console.error(`⚠️ Token de webhook no configurado: ${tokenEnvVar}`);
            return res.status(500).json({
                success: false,
                error: 'Server configuration error'
            });
        }

        // Validar que el header exista
        if (!authHeader) {
            return res.status(401).json({
                success: false,
                error: 'Authorization header required'
            });
        }

        // Extraer el token (formato: "Bearer <token>")
        const token = authHeader.startsWith('Bearer ')
            ? authHeader.substring(7)
            : authHeader;

        // Comparar tokens
        if (token !== expectedToken) {
            console.warn('⚠️ Intento de acceso con token inválido');
            return res.status(403).json({
                success: false,
                error: 'Invalid authentication token'
            });
        }

        // Token válido
        next();
    };
}

/**
 * Middleware de autenticación por API Key
 * Para endpoints de recursos (no webhooks)
 * 
 * @returns {Function} - Middleware de Express
 */
export function authenticateApiKey() {
    return (req, res, next) => {
        const apiKey = req.headers['x-api-key'] || req.query.api_key;
        const expectedApiKey = process.env.API_KEY;

        if (!expectedApiKey) {
            console.error('⚠️ API_KEY no configurada en .env');
            return res.status(500).json({
                success: false,
                error: 'Server configuration error'
            });
        }

        if (!apiKey) {
            return res.status(401).json({
                success: false,
                error: 'API key required'
            });
        }

        if (apiKey !== expectedApiKey) {
            console.warn('⚠️ Intento de acceso con API key inválida');
            return res.status(403).json({
                success: false,
                error: 'Invalid API key'
            });
        }

        next();
    };
}

/**
 * Middleware opcional para autenticación
 * Permite acceso si el token es válido, pero no requiere que exista
 */
export function optionalAuth(tokenEnvVar) {
    return (req, res, next) => {
        const authHeader = req.headers.authorization;
        const expectedToken = process.env[tokenEnvVar];

        if (authHeader && expectedToken) {
            const token = authHeader.startsWith('Bearer ')
                ? authHeader.substring(7)
                : authHeader;

            req.authenticated = token === expectedToken;
        }

        next();
    };
}

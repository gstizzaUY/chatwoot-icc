import rateLimit from 'express-rate-limit';

/**
 * Rate limiter para webhooks
 * Limita la cantidad de solicitudes para prevenir abuso
 * 
 * Nota: validate: false deshabilita las validaciones estrictas de trust proxy
 * para evitar errores cuando se usa detrás de un reverse proxy
 */
export const webhookLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 100, // 100 requests por minuto
    message: {
        success: false,
        error: 'Too many webhook requests from this IP, please try again later.'
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    validate: false, // Deshabilitar validaciones estrictas de trust proxy
    skip: (req) => {
        // Opcional: skip rate limiting en desarrollo
        return process.env.NODE_ENV === 'development' && process.env.SKIP_RATE_LIMIT === 'true';
    }
});

/**
 * Rate limiter estricto para endpoints de API
 */
export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // 100 requests por 15 minutos
    message: {
        success: false,
        error: 'Too many API requests from this IP, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    validate: false // Deshabilitar validaciones estrictas de trust proxy
});

/**
 * Rate limiter flexible para endpoints públicos
 */
export const publicLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 200, // 200 requests por minuto
    message: {
        success: false,
        error: 'Too many requests, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    validate: false // Deshabilitar validaciones estrictas de trust proxy
});

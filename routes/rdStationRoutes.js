import express from 'express';
import { 
    importarContactos, 
    actualizarContacto, 
    registrarDemo,
    getCredentialsStatus,
    getCircuitBreakerStatus,
    initializeCredentials,
    testConversionEvent
} from '../controllers/rdStationControllers.js';
import onboarding from '../controllers/onboardingController.js';
import onboardingHsmStarterPack from '../controllers/onboardingHsmController.js';
import hsmWebinar from '../controllers/hsmWebinarController.js';
import saludoFinAno2025 from '../controllers/hsmEvolutionController.js';
import { actualizacionFirmwareNh2025101735 } from '../controllers/rdStationControllers.js';

const router = express.Router();

// Endpoints principales
router.post('/importar-contactos', importarContactos);
router.post('/actualizar-contacto', actualizarContacto);
router.post('/registro-demo', registrarDemo);

// Endpoint de test para eventos de conversión
router.post('/test-conversion-event', testConversionEvent);

// Endpoint de debugging para verificar estado del sistema
router.get('/status', (req, res) => {
    try {
        const credentialsStatus = getCredentialsStatus();
        const circuitBreakerStatus = getCircuitBreakerStatus();
        
        const status = {
            credentials: credentialsStatus,
            circuitBreaker: circuitBreakerStatus,
            timestamp: new Date().toISOString(),
            environment: {
                nodeEnv: process.env.NODE_ENV,
                rdStationUrl: process.env.RDSTATION_URL || 'NOT_SET'
            }
        };

        // Determinar el estado general
        const isHealthy = credentialsStatus.hasClientId && 
                         credentialsStatus.hasClientSecret && 
                         credentialsStatus.hasRefreshToken &&
                         !circuitBreakerStatus.isOpen;

        res.status(isHealthy ? 200 : 503).json({
            success: isHealthy,
            status: isHealthy ? 'healthy' : 'unhealthy',
            data: status
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            status: 'error',
            error: error.message
        });
    }
});

// Endpoint para recargar credenciales
router.post('/reload-credentials', (req, res) => {
    try {
        const success = initializeCredentials();
        const credentialsStatus = getCredentialsStatus();
        
        res.status(success ? 200 : 500).json({
            success,
            message: success ? 'Credenciales recargadas exitosamente' : 'Error al recargar credenciales',
            credentials: credentialsStatus
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.post('/onboarding/:etapa', onboarding);
router.post('/onboarding/hsm/starter-pack', onboardingHsmStarterPack);
router.post('/onboarding-provisorio/:etapa', onboarding);


router.post('/hsm/webinar-vitel-tone', hsmWebinar);
router.post('/hsm/evolution/saludo-fin-ano-2025', saludoFinAno2025);

router.post('/nh2025101735', actualizacionFirmwareNh2025101735);


export default router;
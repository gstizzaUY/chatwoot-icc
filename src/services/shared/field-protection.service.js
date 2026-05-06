import { PROTECTED_FIELDS, STAGE_HIERARCHY } from '../../constants/agent.constants.js';

/**
 * Servicio centralizado de protección de campos
 * Implementa reglas de negocio para actualizaciones de CRM
 */
class FieldProtectionService {
    /**
     * Valida si una actualización de campo es permitida según reglas de negocio
     * 
     * @param {string} field - Nombre del campo
     * @param {any} oldValue - Valor actual
     * @param {any} newValue - Nuevo valor propuesto
     * @param {Object} context - Contexto adicional
     * @returns {Object} - { allowed: boolean, reason: string }
     */
    validateUpdate(field, oldValue, newValue, context = {}) {
        // Si no hay valor nuevo, no actualizar
        if (newValue === undefined || newValue === null || newValue === '') {
            return { allowed: false, reason: 'Valor vacío' };
        }

        // Si no hay valor anterior, permitir
        if (!oldValue || oldValue === null || oldValue === '') {
            return { allowed: true, reason: 'Campo vacío, se puede poblar' };
        }

        // PROTECCIÓN: tiene_ichef y es_cliente NO pueden retroceder de "Sí"
        if (PROTECTED_FIELDS.NEVER_DOWNGRADE.includes(field)) {
            if (oldValue === 'Sí' && newValue !== 'Sí') {
                return {
                    allowed: false,
                    reason: `${field} no puede retroceder de "Sí" a "${newValue}"`
                };
            }
        }

        // PROTECCIÓN: stage solo puede avanzar, nunca retroceder
        if (field === 'stage' || PROTECTED_FIELDS.FORWARD_ONLY.includes(field)) {
            const oldLevel = STAGE_HIERARCHY[oldValue] || 0;
            const newLevel = STAGE_HIERARCHY[newValue] || 0;

            if (newLevel < oldLevel) {
                return {
                    allowed: false,
                    reason: `Stage no puede retroceder: ${oldValue} (${oldLevel}) → ${newValue} (${newLevel})`
                };
            }
        }

        // PROTECCIÓN: email - priorizar email real sobre ficticio
        if (field === 'email') {
            const oldIsFake = oldValue && oldValue.includes('@email.com');
            const newIsFake = newValue && newValue.includes('@email.com');

            // Si el viejo es real y el nuevo es ficticio, no actualizar
            if (!oldIsFake && newIsFake) {
                return {
                    allowed: false,
                    reason: 'No reemplazar email real con email ficticio'
                };
            }
        }

        // Comparar valores para evitar actualizaciones innecesarias
        const oldStr = String(oldValue || '');
        const newStr = String(newValue);

        if (oldStr === newStr) {
            return { allowed: false, reason: 'Sin cambios' };
        }

        return { allowed: true, reason: 'Actualización válida' };
    }

    /**
     * Aplica reglas de negocio a información extraída
     * 
     * @param {Object} extractedInfo - Información nueva extraída
     * @param {Object} currentContact - Contacto actual
     * @param {Object} previousData - Datos de conversaciones previas (opcional)
     * @returns {Object} - Información validada y consolidada
     */
    applyBusinessRules(extractedInfo, currentContact, previousData = null) {
        const validated = { ...extractedInfo };
        const currentAttrs = currentContact.custom_attributes || {};

        // REGLA 1: Si es_cliente = Sí → SIEMPRE customer + tiene_ichef = Sí
        if (validated.es_cliente === 'Sí') {
            console.log('🎯 Regla: es_cliente=Sí → Forzando stage=customer y tiene_ichef=Sí');
            validated.stage = 'customer';
            validated.tiene_ichef = 'Sí';
        }

        // REGLA 2: Preservar campos críticos de datos previos
        if (previousData) {
            // tiene_ichef: Una vez "Sí", siempre "Sí"
            if (previousData.tiene_ichef === 'Sí' && validated.tiene_ichef !== 'Sí') {
                console.log('🛡️  Preservando tiene_ichef=Sí de conversaciones previas');
                validated.tiene_ichef = 'Sí';
            }

            // es_cliente: Una vez "Sí", siempre "Sí"
            if (previousData.es_cliente === 'Sí' && validated.es_cliente !== 'Sí') {
                console.log('🛡️  Preservando es_cliente=Sí de conversaciones previas');
                validated.es_cliente = 'Sí';
            }

            // Email: priorizar real sobre ficticio
            if (previousData.email && !previousData.email.includes('@email.com')) {
                if (!validated.email || validated.email.includes('@email.com')) {
                    console.log('📧 Preservando email real de conversaciones previas');
                    validated.email = previousData.email;
                }
            }
        }

        // REGLA 3: Validar stage basado en tiene_ichef/es_cliente actual
        const currentTieneIchef = currentAttrs.tiene_ichef || validated.tiene_ichef;
        const currentEsCliente = currentAttrs.es_cliente || validated.es_cliente;

        if (currentEsCliente === 'Sí' || currentTieneIchef === 'Sí') {
            const currentStage = currentAttrs.stage || validated.stage;
            const customerLevels = ['customer', 'cliente'];
            
            if (currentStage && !customerLevels.includes(currentStage)) {
                console.log('⚠️  Inconsistencia: tiene_ichef/es_cliente=Sí pero stage no es customer');
                // No forzar stage aquí, dejar que se maneje en updateField
            }
        }

        return validated;
    }

    /**
     * Consolida información de múltiples fuentes con priorización
     * 
     * @param {Object} currentAnalysis - Análisis de conversación actual
     * @param {Object} previousFields - Campos extraídos de conversaciones previas
     * @returns {Object} - Información consolidada
     */
    consolidateInformation(currentAnalysis, previousFields = {}) {
        const consolidated = { ...currentAnalysis };

        // Campos críticos: priorizar actual, pero preservar previos si hay "Sí"
        const criticalFields = ['tiene_ichef', 'es_cliente', 'id_equipo', 'email', 'phone', 'mobile_phone'];

        for (const field of criticalFields) {
            // Si no hay valor actual pero sí en previos, usar el previo
            if ((!consolidated[field] || consolidated[field] === null) && previousFields[field]) {
                console.log(`📋 Usando ${field} de conversaciones previas: ${previousFields[field]}`);
                consolidated[field] = previousFields[field];
            }

            // PROTECCIÓN: Nunca retroceder campos críticos
            if ((field === 'tiene_ichef' || field === 'es_cliente') && previousFields[field] === 'Sí') {
                if (consolidated[field] !== 'Sí') {
                    console.log(`🛡️  Preservando ${field}=Sí de conversaciones previas (no retroceder)`);
                    consolidated[field] = 'Sí';
                }
            }
        }

        // Otros campos: usar previos solo si actual está vacío
        const otherFields = Object.keys(previousFields).filter(k =>
            !criticalFields.includes(k) &&
            !k.endsWith('_priority') &&
            (!consolidated[k] || consolidated[k] === null)
        );

        for (const field of otherFields) {
            if (previousFields[field]) {
                consolidated[field] = previousFields[field];
            }
        }

        return consolidated;
    }

    /**
     * Limpia campos eliminando aquellos que no deben enviarse
     * 
     * @param {Object} data - Datos a limpiar
     * @param {Array} fieldsToRemove - Campos a eliminar
     * @returns {Object} - Datos limpios
     */
    cleanFields(data, fieldsToRemove = []) {
        const cleaned = { ...data };

        for (const field of fieldsToRemove) {
            delete cleaned[field];
        }

        // Eliminar campos con valores null/undefined/empty
        for (const [key, value] of Object.entries(cleaned)) {
            if (value === null || value === undefined || value === '') {
                delete cleaned[key];
            }
        }

        return cleaned;
    }
}

export default new FieldProtectionService();

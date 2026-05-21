import PreVentaAgent from './pre-venta/PreVentaAgent.js';
import PostVentaAgent from './post-venta/PostVentaAgent.js';
import NutridorAgent from './nutridor/NutridorAgent.js';
import { AGENT_TYPES } from '../constants/agent.constants.js';

/**
 * Factory para instanciar agentes según tipo
 * Singleton pattern
 */
class AgentFactory {
    constructor() {
        this.agents = new Map();
        this._initializeAgents();
    }

    /**
     * Inicializa instancias de agentes (singleton por tipo)
     */
    _initializeAgents() {
        this.agents.set(AGENT_TYPES.PRE_VENTA, new PreVentaAgent());
        this.agents.set(AGENT_TYPES.POST_VENTA, new PostVentaAgent());
        this.agents.set(AGENT_TYPES.NUTRIDOR, new NutridorAgent());
        // AGENT_TYPES.RESUMEN se manejará de manera especial
    }

    /**
     * Obtiene agente por tipo
     * 
     * @param {string} agentType - Tipo de agente (pre-venta, post-venta, resumen)
     * @returns {BaseAgent} - Instancia del agente
     */
    getAgent(agentType) {
        const agent = this.agents.get(agentType);

        if (!agent) {
            throw new Error(`Agente tipo "${agentType}" no encontrado`);
        }

        return agent;
    }

    /**
     * Verifica si un tipo de agente existe
     * 
     * @param {string} agentType - Tipo de agente
     * @returns {boolean}
     */
    hasAgent(agentType) {
        return this.agents.has(agentType);
    }

    /**
     * Lista todos los agentes disponibles
     * 
     * @returns {string[]} - Array de tipos de agentes
     */
    listAgents() {
        return Array.from(this.agents.keys());
    }
}

// Exportar singleton
export default new AgentFactory();

import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const EXTRACTION_SYSTEM_PROMPT = `Eres un extractor de datos de contacto. Tu única tarea es extraer nombre, email y teléfono del texto de un formulario web o email.

REGLAS:
- NO inventes datos. Si no aparece, devuelve null.
- El email debe tener formato válido (contener @ y dominio)
- El teléfono puede aparecer con o sin prefijo (09xxxxxx, 099xxxxxx, +598, etc)
- El nombre puede ser uno o dos (firstname, lastname)
- Ignora palabras como "PRUEBA", "TEST", "asunto", "de:", "para:", "enviado:" que son metadata del email
- Si ves un patrón como "(Nombre Apellido email@dominio.com 09xxxxxxxx)" extrae los datos

Responde SIEMPRE con este JSON exacto:
{
  "email": "email@ejemplo.com" o null,
  "firstname": "Nombre" o null,
  "lastname": "Apellido" o null,
  "phone": "099123456" o null
}`;

/**
 * Servicio para extraer datos de contacto desde texto plano (formularios web, emails)
 * Usa GPT-4o-mini con fallback a regex
 */
class ContactExtractionService {
    constructor() {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            console.warn('⚠️ OPENAI_API_KEY no configurada - solo funcionará extracción por regex');
            this.openai = null;
        } else {
            this.openai = new OpenAI({ apiKey });
        }
        this.model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    }

    /**
     * Extrae datos de contacto de un texto
     * @param {string} text - Texto del email o formulario
     * @returns {Promise<{email: string|null, firstname: string|null, lastname: string|null, phone: string|null, source: string}>}
     */
    async extract(text) {
        if (!text || text.trim().length === 0) {
            return { email: null, firstname: null, lastname: null, phone: null, source: 'empty' };
        }

        try {
            return await this._extractWithAI(text);
        } catch (error) {
            console.warn('⚠️ Extracción con IA falló, usando regex:', error.message);
            return this._extractWithRegex(text);
        }
    }

    async _extractWithAI(text) {
        if (!this.openai) throw new Error('OpenAI no inicializado');

        const userPrompt = `Extrae los datos de contacto de este mensaje:\n\n"""\n${text}\n"""`;

        const completion = await this.openai.chat.completions.create({
            model: this.model,
            messages: [
                { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
                { role: 'user', content: userPrompt }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.1,
            max_completion_tokens: 300
        });

        const result = JSON.parse(completion.choices[0].message.content);
        return {
            email: this._validateEmail(result.email),
            firstname: result.firstname || null,
            lastname: result.lastname || null,
            phone: this._cleanPhone(result.phone),
            source: 'ai'
        };
    }

    _extractWithRegex(text) {
        let email = null;
        let phone = null;
        let firstname = null;
        let lastname = null;

        const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
        if (emailMatch) {
            email = emailMatch[0].toLowerCase();
        }

        const phoneMatch = text.match(/(?:0|\\+?598)?\s*9[0-9]{7}\b/);
        if (phoneMatch) {
            phone = phoneMatch[0].replace(/\D/g, '');
        }

        const nameLines = text
            .split(/[\n\r]+/)
            .filter(line => {
                const trimmed = line.trim();
                if (!trimmed) return false;
                if (trimmed.includes('@')) return false;
                if (/^(de:|para:|from:|to:|subject:|asunto:|enviado:|fecha:|date:)/i.test(trimmed)) return false;
                if (/prueba|test/i.test(trimmed) && trimmed.length < 20) return false;
                return true;
            });

        if (nameLines.length > 0) {
            const nameParts = nameLines[0].trim().split(/\s+/);
            const meaningfulParts = nameParts.filter(p =>
                !/prueba|test|mensaje|contacto|formulario|web/i.test(p)
            );
            if (meaningfulParts.length >= 2) {
                firstname = meaningfulParts[0];
                lastname = meaningfulParts.slice(1).join(' ');
            } else if (meaningfulParts.length === 1) {
                firstname = meaningfulParts[0];
            }
        }

        return {
            email: this._validateEmail(email),
            firstname,
            lastname,
            phone: this._cleanPhone(phone),
            source: 'regex'
        };
    }

    _validateEmail(email) {
        if (!email) return null;
        const cleaned = email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) return null;
        if (cleaned === 'comercial@ichef.uy') return null;
        return cleaned;
    }

    _cleanPhone(phone) {
        if (!phone) return null;
        const cleaned = phone.replace(/\D/g, '');
        if (cleaned.length < 8 || cleaned.length > 15) return null;
        return cleaned;
    }
}

export default new ContactExtractionService();

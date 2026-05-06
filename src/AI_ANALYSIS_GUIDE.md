# Análisis de Conversaciones con IA

## 🤖 Descripción

El sistema ahora puede analizar conversaciones usando **Inteligencia Artificial** (OpenAI GPT) en lugar de solo regex y palabras clave.

### Ventajas del Análisis con IA

| Aspecto | Regex (fallback) | IA (OpenAI) |
|---------|------------------|-------------|
| **Comprensión** | Palabras clave literales | Contexto y lenguaje natural |
| **Sinónimos** | ❌ No detecta variaciones | ✅ Entiende "compré" = "adquirí" |
| **Contexto** | ❌ Análisis superficial | ✅ Entiende conversación completa |
| **Sentimiento** | Conteo básico de palabras | Análisis profundo de tono |
| **Información implícita** | ❌ No captura | ✅ Infiere datos del contexto |
| **Adaptabilidad** | Requiere actualizar código | Aprende de ejemplos en prompt |
| **Costo** | Gratis | ~$0.005-0.01 por conversación |

### Ejemplo Comparativo

**Conversación:**
> Cliente: "Hace una semana adquirí uno de sus equipos"

**Regex:**
```json
{
  "tiene_ichef": null,  ❌ No detecta "adquirí"
  "es_cliente": null
}
```

**IA:**
```json
{
  "tiene_ichef": "Sí",  ✅ Entiende que "adquirí" = compró
  "es_cliente": "Sí",
  "confidence": "high"
}
```

---

## 🚀 Configuración

### 1. Obtener API Key de OpenAI

1. Ve a [OpenAI Platform](https://platform.openai.com/)
2. Crea una cuenta o inicia sesión
3. Ve a **API Keys**: https://platform.openai.com/api-keys
4. Crea una nueva API key
5. Copia la key (empieza con `sk-...`)

### 2. Configurar en .env

Agrega estas variables a tu archivo `.env`:

```env
# Obligatorio para habilitar análisis con IA
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxx

# Opcional: especificar modelo (por defecto: gpt-4o-mini)
OPENAI_MODEL=gpt-4o-mini
```

### 3. Instalar Dependencia

```bash
cd backend
npm install openai
```

### 4. Reiniciar Servidor

```bash
npm start
```

Verás en los logs:

```
✅ Servicio de IA inicializado (modelo: gpt-4o-mini)
```

---

## 📊 Funcionamiento

### Flujo de Análisis

```
┌─────────────────────────┐
│ Conversación cerrada    │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ ¿IA habilitada?         │
│ (OPENAI_API_KEY existe) │
└────┬────────────────┬───┘
     │ SÍ             │ NO
     ▼                ▼
┌──────────┐    ┌─────────────┐
│ Análisis │    │ Análisis    │
│ con IA   │    │ con Regex   │
│ (GPT)    │    │ (fallback)  │
└────┬─────┘    └──────┬──────┘
     │                 │
     │ ❌ Error        │
     └────────┬────────┘
              ▼
     ┌─────────────────┐
     │ Fallback Regex  │
     └─────────────────┘
```

### Logs en Consola

**Con IA habilitada:**
```
📊 Iniciando análisis de conversación cerrada: 11295
🔍 DEBUG - Muestra de mensaje: {...}
👤 Contacto encontrado: jorge rindzinski
🤖 Intentando análisis con IA...
✅ Análisis con IA exitoso
🔍 Información extraída (método: ai): {
  "email": "jorge@example.com",
  "tiene_ichef": "Sí",
  "es_cliente": "Sí",
  "confidence": "high"
}
```

**Sin IA (fallback):**
```
📊 Iniciando análisis de conversación cerrada: 11295
📝 Usando análisis por regex (IA no habilitada)
🔍 Información extraída (método: regex): {
  "email": null,
  "tiene_ichef": null,
  "confidence": "low"
}
```

**IA falla → Fallback automático:**
```
🤖 Intentando análisis con IA...
⚠️  Análisis con IA falló, usando método de fallback (regex): Rate limit exceeded
📝 Usando análisis por regex
```

---

## 💰 Costos

### Modelos Disponibles

| Modelo | Costo/1M tokens input | Costo/1M tokens output | $/conversación* |
|--------|----------------------|------------------------|----------------|
| **gpt-4o-mini** | $0.15 | $0.60 | $0.005-0.01 |
| gpt-4o | $2.50 | $10.00 | $0.08-0.15 |
| gpt-3.5-turbo | $0.50 | $1.50 | $0.02-0.03 |

\* *Estimado para conversación promedio de 20-30 mensajes*

### Recomendaciones

- **Producción con volumen alto**: `gpt-4o-mini` (mejor relación calidad/precio)
- **Máxima precisión**: `gpt-4o` (5x más caro pero más preciso)
- **Testing/desarrollo**: `gpt-4o-mini` o incluso Ollama local (gratis)

### Cambiar de Modelo

En `.env`:

```env
# Económico (recomendado)
OPENAI_MODEL=gpt-4o-mini

# Máxima calidad
OPENAI_MODEL=gpt-4o

# Legacy (no recomendado)
OPENAI_MODEL=gpt-3.5-turbo
```

---

## 🔧 Información Extraída por la IA

La IA extrae y analiza:

### Campos Básicos
- **email**: Email del cliente
- **tiene_ichef**: ¿Ya tiene el equipo?
- **es_cliente**: ¿Ya compró?
- **id_equipo**: Número de serie si lo menciona
- **city**: Ciudad donde vive

### Análisis Avanzado (solo con IA)
- **sentiment**: positive / neutral / negative
- **sentiment_reason**: Explicación del sentimiento
- **customer_intent**: consulta / compra / soporte / reclamo
- **extracted_topics**: Array de temas (ej: `["precio", "demo"]`)
- **requires_followup**: ¿Requiere seguimiento?
- **summary**: Resumen breve de la conversación
- **confidence**: Nivel de confianza (low/medium/high)

### Ejemplo de Respuesta Completa

```json
{
  "email": "cliente@example.com",
  "tiene_ichef": "Sí",
  "es_cliente": "Sí",
  "id_equipo": "AB123456",
  "city": "Montevideo",
  "sentiment": {
    "sentiment": "positive",
    "reason": "Cliente agradecido por la atención"
  },
  "metadata": {
    "confidence": "high",
    "sources": ["ai_analysis"],
    "ai_topics": ["consulta_serial", "agradecimiento"],
    "customer_intent": "soporte",
    "requires_followup": false
  },
  "summary": "Cliente consulta sobre registro de serial de equipo recién adquirido. Problema resuelto satisfactoriamente."
}
```

---

## 🔍 Personalización del Prompt

El prompt de la IA está en:
```
src/services/ai-analysis.service.js
```

### Modificar el Prompt del Sistema

```javascript
_buildSystemPrompt() {
    return `Eres un asistente experto en análisis de conversaciones...
    
    CAMPOS A EXTRAER:
    1. email: ...
    2. tiene_ichef: ...
    
    REGLAS PERSONALIZADAS:
    - Detectar si pregunta por precios específicos
    - Identificar si menciona la competencia
    - ...
    `;
}
```

### Agregar Nuevos Campos

1. Modifica el prompt para pedir el nuevo campo
2. Actualiza `_normalizeAIResponse()` para incluirlo
3. Actualiza el mapper y base de datos si es necesario

---

## 🐛 Troubleshooting

### Error: "OPENAI_API_KEY no configurada"

**Solución**: Agrega la key a tu `.env`:
```env
OPENAI_API_KEY=sk-proj-xxxxxxxxx
```

### Error: "Rate limit exceeded"

**Causa**: Excediste el límite de requests de tu cuenta OpenAI.

**Soluciones**:
1. Espera unos minutos (límite se resetea)
2. Aumenta el tier de tu cuenta OpenAI
3. El sistema automáticamente usará fallback (regex)

### Error: "Insufficient quota"

**Causa**: No tienes créditos en tu cuenta OpenAI.

**Solución**: Agrega créditos en https://platform.openai.com/account/billing

### La IA no detecta información correcta

**Solución**:
1. Revisa los logs: `🤖 Enviando conversación a IA...`
2. Verifica que los mensajes tengan `message_type` correcto
3. Ajusta el prompt en `ai-analysis.service.js`
4. Considera usar `gpt-4o` (más preciso que mini)

### Quiero usar análisis básico (sin IA)

**Solución**: Simplemente NO configures `OPENAI_API_KEY` en tu `.env`.

El sistema automáticamente usará el análisis por regex.

---

## 🎯 Alternativas a OpenAI

### Ollama (Local, Gratis)

Para evitar costos, puedes usar Ollama con modelos locales:

1. Instala Ollama: https://ollama.ai/
2. Descarga un modelo: `ollama pull llama3`
3. Modifica `ai-analysis.service.js` para usar Ollama en lugar de OpenAI

### OpenRouter (Múltiples modelos)

Acceso a GPT-4, Claude, Gemini con una sola API:
- Sitio: https://openrouter.ai/
- Más económico que OpenAI directo en algunos casos

---

## 📈 Monitoreo de Uso

### Ver Uso en OpenAI

1. Ve a https://platform.openai.com/usage
2. Revisa el dashboard de consumo
3. Establece límites si es necesario

### Logs en la Aplicación

Cada conversación analizada muestra:

```
🤖 Intentando análisis con IA...
✅ Análisis con IA exitoso
```

Cuenta cuántas veces aparece para estimar tu consumo diario.

---

## ✅ Resumen

1. **Sin configurar**: Sistema usa regex (fallback) - gratis pero limitado
2. **Con OpenAI configurado**: Usa IA inteligente - ~$0.005-0.01/conversación
3. **Fallback automático**: Si IA falla, usa regex automáticamente
4. **Personalizable**: Puedes modificar el prompt según tus necesidades
5. **Monitoreado**: Logs claros muestran qué método se usó

El análisis con IA es **opcional** y el sistema funciona perfectamente sin ella, pero la calidad de extracción mejora significativamente cuando está habilitada.

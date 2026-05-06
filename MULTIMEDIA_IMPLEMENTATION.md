# Implementación de Soporte Multimedia

## Descripción General

Sistema de procesamiento de multimedia (audios e imágenes/documentos) enviados por clientes a través de Chatwoot. Utiliza OpenAI Whisper para transcripción de audio y GPT-4o Vision para análisis de imágenes/documentos.

## Características

### ✅ Implementado

1. **Transcripción de Audio (Whisper-1)**
   - Opción más económica de OpenAI (~$0.006 por minuto)
   - Formatos soportados: MP3, M4A, WAV, WebM, OGG
   - Tamaño máximo: 25MB por archivo
   - Límite: 10 audios por conversación
   - Caché de 7 días para evitar retranscripciones
   - Solo procesa audios enviados por clientes (no por agentes)

2. **Análisis de Imágenes y Documentos (GPT-4o Vision)**
   - Extracción de información de contacto
   - Análisis técnico de problemas (capturas de pantalla, fotos de equipos)
   - Formatos soportados: JPEG, PNG, GIF, WebP, PDF
   - Tamaño máximo: 20MB por archivo
   - Límite: 15 imágenes por conversación
   - Solo procesa imágenes enviadas por clientes (no por agentes)

3. **Integración con CRM**
   - Consolidación automática de información extraída
   - Actualización de Chatwoot con datos de multimedia
   - Sincronización con RD Station
   - Notas internas con registro de cambios (antes/después)

4. **Notas Internas Detalladas**
   - Sección dedicada de multimedia en notas de cierre
   - Muestra cantidad de audios/imágenes procesados
   - Lista campos actualizados desde multimedia con valores antes/después
   - Previsualización de contenido extraído

5. **Resumen en Cierre de Conversación**
   - Incluye estadísticas de multimedia procesada
   - Indica si se actualizaron CRMs con información de multimedia
   - Mantiene compatibilidad con resúmenes existentes

### ❌ No Implementado (por especificación del usuario)

- Videos: No se procesan por decisión explícita del usuario

## Arquitectura

```
src/
├── constants/
│   └── multimedia.constants.js      # Configuración centralizada
├── utils/
│   └── attachment-downloader.utils.js  # Descarga de attachments
├── services/
│   └── multimedia/
│       ├── audio-transcription.service.js    # Whisper API
│       ├── image-analysis.service.js         # GPT-4o Vision
│       ├── multimedia-processor.service.js   # Coordinador
│       └── index.js                          # Exportaciones
├── mappers/
│   └── attachment.mapper.js         # Clasificación de attachments
└── agents/
    └── base/BaseAgent.js            # Integración con agentes
```

## Flujo de Procesamiento

### 1. Agentes en Tiempo Real (Pre-Venta / Post-Venta)

```
Webhook message_created (cada 3 mensajes)
    ↓
BaseAgent.buildContext()
    ↓
ContextBuilder.buildContext({ processMultimedia: true })
    ↓
ContextBuilder.processMultimediaMessages()
    ↓
MultimediaProcessor.processMessageAttachments()
    ├─→ AudioTranscription.transcribe() (si audio)
    └─→ ImageAnalysis.extractContactInfo() (si imagen/documento)
    ↓
Consolidar información extraída
    ↓
BaseAgent.analyzeWithAI() (con multimedia en contexto)
    ↓
BaseAgent.syncBothCRMs() (actualizar con info de multimedia)
```

### 2. Resumen al Cerrar (ResumenAgent)

```
Webhook conversation_status_changed (resolved)
    ↓
ConversationAnalysisService.processClosedConversation()
    ↓
Procesar multimedia de todos los mensajes
    ↓
Consolidar con información de texto
    ↓
Actualizar Chatwoot + RD Station
    ↓
Generar nota interna con sección de multimedia
```

## Uso de OpenAI

### Whisper API

```javascript
import audioTranscriptionService from './services/multimedia/audio-transcription.service.js';

const result = await audioTranscriptionService.transcribe(audioUrl, mimeType);
// result: { text, duration, cached, timestamp }
```

**Costos**: ~$0.006 USD por minuto de audio

### GPT-4o Vision

```javascript
import imageAnalysisService from './services/multimedia/image-analysis.service.js';

// Extraer información de contacto
const result = await imageAnalysisService.extractContactInfo(imageUrl, mimeType);

// Análisis técnico (problemas de equipos)
const technical = await imageAnalysisService.analyzeTechnical(imageUrl, mimeType);
```

**Costos**: Varía según tamaño de imagen y detalle requerido

## Caché

Ambos servicios implementan caché en memoria:
- **TTL**: 7 días
- **Máximo**: 1000 entradas
- **Criterio**: MD5 hash de URL

## Configuración

Variables de entorno requeridas:

```env
OPENAI_API_KEY=sk-...
```

### Límites Configurables

En `multimedia.constants.js`:

```javascript
MULTIMEDIA_LIMITS: {
    MAX_AUDIO_SIZE_MB: 25,
    MAX_IMAGE_SIZE_MB: 20,
    MAX_AUDIO_PER_CONVERSATION: 10,
    MAX_IMAGES_PER_CONVERSATION: 15,
    DOWNLOAD_TIMEOUT_MS: 30000,
    TRANSCRIPTION_TIMEOUT_MS: 60000,
    VISION_TIMEOUT_MS: 45000
}
```

## Filtrado Cliente vs Agente

**CRÍTICO**: Solo se procesan attachments enviados por clientes (incoming), NO por agentes.

Detección de mensajes incoming:
```javascript
const isIncoming = 
    msg.message_type === 0 || 
    msg.message_type === '0' || 
    msg.message_type === 'incoming' || 
    msg.incoming === true;
```

## Prompts de IA

Los prompts de Pre-Venta y Post-Venta fueron actualizados para informar a la IA sobre multimedia:

```
Los mensajes pueden incluir:
- Texto escrito por el cliente
- 🎤 Transcripciones de audios (marcados como [AUDIO])
- 🖼️ Descripciones de imágenes/documentos (marcados como [IMAGEN])
```

## Formato de Mensajes con Multimedia

Ejemplo de formato para IA:

```
[1] Cliente: Hola, quiero comprar un iChef
[2] Cliente: [🎤 AUDIO 1 (15s)]: Mi nombre es Juan Pérez, mi teléfono es 099123456
[3] Agente: ¡Hola Juan! Con gusto te ayudo.
[4] Cliente: [🖼️ IMAGEN 1]: Captura de pantalla con información de contacto [Contiene información de contacto]
```

## Notas Internas

Ejemplo de sección multimedia en nota de cierre:

```markdown
## 🎬 MULTIMEDIA PROCESADA

🎤 **Audios transcritos: 2**
   1. Mi nombre es Juan Pérez, mi teléfono es 099123456... (15s)
   2. Estoy interesado en el robot iChef para cocinar para 4 personas... (28s)

🖼️ **Imágenes/Documentos analizados: 1**
   ✓ 1 con información de contacto detectada
   1. Documento con nombre: Juan Pérez, email: juan@example.com...

📝 **Campos actualizados desde multimedia:**
   • **mobile_phone**: (vacío) → 099123456
   • **email**: (vacío) → juan@example.com

ℹ️ **Info extraída:** Nombre: Juan, Apellido: Pérez, Email: juan@example.com, Celular: 099123456
```

## Manejo de Errores

- Si OpenAI API falla: continúa sin multimedia, no bloquea el flujo
- Si un audio/imagen falla: marca error, continúa con siguiente
- Si cuota excedida: muestra mensaje claro en notas
- Timeouts configurables por servicio

## Testing

Para probar:

1. **Audio**: Enviar mensaje de voz desde WhatsApp/Telegram
2. **Imagen**: Enviar captura de pantalla con datos de contacto
3. **Documento**: Enviar PDF escaneado con información

Verificar:
- Transcripción/análisis aparece en contexto del agente
- Información extraída actualiza CRMs
- Nota interna muestra sección de multimedia
- Solo procesa attachments del cliente

## Próximos Pasos (Futuro)

- [ ] Análisis de sentimiento en audios (tono de voz)
- [ ] OCR mejorado para documentos complejos
- [ ] Soporte para videos (si el usuario lo solicita)
- [ ] Dashboard de estadísticas de multimedia
- [ ] Detección automática de equipos en imágenes

## Costos Estimados

Ejemplo mensual (1000 conversaciones):
- 500 audios x 30s promedio = 250 minutos = **$1.50 USD**
- 1000 imágenes x $0.01 promedio = **$10 USD**
- **Total aproximado: $11.50 USD/mes**

## Referencias

- [OpenAI Whisper API](https://platform.openai.com/docs/guides/speech-to-text)
- [OpenAI Vision API](https://platform.openai.com/docs/guides/vision)
- [Chatwoot Webhooks](https://www.chatwoot.com/docs/product/channels/api/webhooks)

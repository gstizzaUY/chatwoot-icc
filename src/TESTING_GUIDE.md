# Scripts de Testing - API v2 Webhooks

Este archivo contiene comandos útiles para probar los endpoints de la API v2.

## 🚀 Iniciar el Servidor

### Modo Desarrollo (con nodemon)
```bash
cd backend
npm run dev
```

### Modo Producción
```bash
cd backend
npm start
```

---

## 🧪 Tests de Endpoints

### 1. Health Check
Verifica que la API v2 esté funcionando:

**PowerShell:**
```powershell
Invoke-RestMethod -Uri "http://localhost:4000/api/v2/health" -Method Get | ConvertTo-Json -Depth 10
```

**Bash/cURL:**
```bash
curl http://localhost:4000/api/v2/health | jq
```

**Salida esperada:**
```json
{
  "success": true,
  "version": "v2",
  "status": "healthy",
  "timestamp": "2024-...",
  "features": {
    "webhooks": true,
    "conversationAnalysis": true,
    ...
  }
}
```

---

### 2. Webhook de Conversación Cerrada
Simula el webhook que Chatwoot envía cuando se cierra una conversación.

**PowerShell:**
```powershell
$body = @{
    event = "conversation_status_changed"
    id = 12345
    status = "resolved"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:4000/api/v2/webhooks/chatwoot/conversation-status-changed" -Method Post -Body $body -ContentType "application/json"
```

**Bash/cURL:**
```bash
curl -X POST http://localhost:4000/api/v2/webhooks/chatwoot/conversation-status-changed \
  -H "Content-Type: application/json" \
  -d '{
    "event": "conversation_status_changed",
    "id": 12345,
    "status": "resolved"
  }'
```

**Salida esperada:**
- `202 Accepted` - Procesamiento iniciado
- `400 Bad Request` - Evento inválido o status no es "resolved"
- `429 Too Many Requests` - Rate limit excedido (100 req/min)

**Nota:** Ya no se requiere autenticación por token. Los webhooks están protegidos por rate limiting.

---

### 3. Análisis Manual de Conversación
Analiza una conversación específica sin necesidad de webhook (útil para testing).

**PowerShell:**
```powershell
$body = @{
    conversationId = 12345
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:4000/api/v2/webhooks/chatwoot/analyze-conversation" -Method Post -Body $body -ContentType "application/json"
```

**Bash/cURL:**
```bash
curl -X POST http://localhost:4000/api/v2/webhooks/chatwoot/analyze-conversation \
  -H "Content-Type: application/json" \
  -d '{"conversationId": 12345}'
```

**Salida esperada:**
```json
{
  "success": true,
  "message": "Análisis iniciado",
  "conversationId": 12345
}
```

---

### 4. Análisis en Lote
Analiza múltiples conversaciones de una vez.

**PowerShell:**
```powershell
$body = @{
    conversationIds = @(12345, 12346, 12347)
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:4000/api/v2/webhooks/chatwoot/bulk-analyze" -Method Post -Body $body -ContentType "application/json"
```

**Bash/cURL:**
```bash
curl -X POST http://localhost:4000/api/v2/webhooks/chatwoot/bulk-analyze \
  -H "Content-Type: application/json" \
  -d '{
    "conversationIds": [12345, 12346, 12347]
  }'
```

---

## 🔍 Monitoreo de Logs

### Logs en Tiempo Real
```powershell
# Ejecutar el servidor en modo dev para ver logs en consola
npm run dev
```

### Buscar Errores
```powershell
# Ver últimas 50 líneas de logs
Get-Content logs/app.log -Tail 50

# Filtrar solo errores
Get-Content logs/app.log | Select-String "ERROR"
```

---

## 📊 Verificación de Datos

### Verificar que el contacto se actualizó en Chatwoot
Después de analizar una conversación, verifica en Chatwoot que:
1. Los `custom_attributes` se actualizaron
2. Las etiquetas se aplicaron correctamente
3. Se agregó una nota interna con el resumen

### Verificar sincronización con RD Station
1. Buscar el contacto en RD Station por email
2. Verificar que los campos personalizados se actualizaron
3. Verificar que el evento de conversión se registró

---

## 🐛 Debugging

### Probar con conversación real de Chatwoot

1. Obtener el ID de una conversación cerrada en Chatwoot
2. Ejecutar análisis manual:

**PowerShell:**
```powershell
$conversationId = 12345  # Reemplazar con ID real
$body = @{ conversationId = $conversationId } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:4000/api/v2/webhooks/chatwoot/analyze-conversation" -Method Post -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 10
```

3. Observar la salida en consola del servidor
4. Verificar en Chatwoot que los cambios se aplicaron

### Probar extracción de información

Crea una conversación de prueba en Chatwoot con mensajes que contengan:
- Email: "Mi email es test@example.com"
- iChef: "Sí, tengo iChef"
- Serial: "Serial: 123456789"
- Cliente: "Soy cliente"

Cierra la conversación y verifica que toda la información se extrajo correctamente.

---

## 📝 Notas

- ~~Los tokens deben configurarse en el archivo `.env`~~ (Ya no se usan tokens de webhook)
- El servidor debe estar corriendo para probar los endpoints
- Los IDs de conversación deben existir en Chatwoot
- Verificar que las credenciales de RD Station estén configuradas

---

## 🔧 Variables de Entorno

Antes de probar, asegúrate de configurar en `.env`:

```bash
# Chatwoot
CHATWOOT_URL=https://contact-center.5vsa59.easypanel.host
CHATWOOT_ACCOUNT_ID=2
API_ACCESS_TOKEN=your_token

# Webhooks (YA NO SE USAN - deprecados)
# Los webhooks están protegidos por rate limiting
# CHATWOOT_WEBHOOK_TOKEN=your_webhook_token

# RD Station
RDSTATION_CLIENT_ID=your_client_id
RDSTATION_CLIENT_SECRET=your_client_secret
RDSTATION_REFRESH_TOKEN=your_refresh_token
```

Ver `.env.example` para la configuración completa.

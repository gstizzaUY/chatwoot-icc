# Configuración de Campos Personalizados en RD Station

## Problema

RD Station requiere que todos los campos personalizados (custom fields) estén **creados previamente** en la plataforma antes de poder usarlos en la API.

Si intentas enviar un campo que no existe, recibirás este error:

```json
{
  "error_type": "INVALID_FIELDS",
  "error_message": "Payload contains fields that do not exist: (cf_es_cliente, cf_chatwoot_id, ...)"
}
```

## Solución: Configuración Flexible

La aplicación ahora usa la variable de entorno `RDSTATION_CUSTOM_FIELDS` para controlar qué campos se envían a RD Station.

### Configuración por Defecto

```env
# Solo envía cf_tiene_ichef (asumiendo que ya existe en tu cuenta)
RDSTATION_CUSTOM_FIELDS=cf_tiene_ichef
```

### Campos Disponibles

Estos son todos los campos que la aplicación puede sincronizar con RD Station:

| Campo | Descripción | Tipo |
|-------|-------------|------|
| `cf_tiene_ichef` | ¿El contacto tiene iChef? (Sí/No) | Text |
| `cf_es_cliente` | ¿Es cliente activo? (Sí/No) | Text |
| `cf_chatwoot_id` | ID del contacto en Chatwoot | Text/Number |
| `cf_id_equipo` | ID del equipo asignado | Text/Number |
| `cf_nickname` | Apodo del contacto | Text |
| `cf_experiencia` | Nivel de experiencia | Text |
| `cf_gusta_cocinar` | ¿Le gusta cocinar? | Text |
| `cf_last_sync_from_chatwoot` | Última sincronización desde Chatwoot | DateTime |

## Cómo Crear Campos Personalizados en RD Station

### 1. Acceder a Configuraciones

1. Inicia sesión en tu cuenta de RD Station
2. Ve a **Configurações** (⚙️ Configuraciones)
3. En el menú lateral, busca **Campos personalizados** o **Custom Fields**

### 2. Crear un Nuevo Campo

Para cada campo que quieras usar:

1. Haz clic en **+ Novo campo** (Nuevo campo)
2. Configura los siguientes valores:

   - **Nome da API** (Nombre de API): `cf_tiene_ichef` (exactamente como aparece arriba)
   - **Nome de exibição** (Nombre de visualización): "Tiene iChef" (como quieras mostrarlo)
   - **Tipo**: `Texto` (Text) o `Número` (Number) según corresponda
   - **Aplicável em**: Marca **Contatos** (Contactos)

3. Guarda el campo

### 3. Verificar que el Campo Existe

Puedes verificar si un campo existe haciendo una petición GET a la API:

```bash
curl "https://api.rd.services/platform/contacts/fields" \
  -H "Authorization: Bearer TU_ACCESS_TOKEN"
```

### 4. Habilitar el Campo en la Aplicación

Una vez creado el campo en RD Station, agrégalo a tu archivo `.env`:

```env
# Un solo campo
RDSTATION_CUSTOM_FIELDS=cf_tiene_ichef

# Múltiples campos (separados por comas, SIN ESPACIOS)
RDSTATION_CUSTOM_FIELDS=cf_tiene_ichef,cf_es_cliente,cf_chatwoot_id

# Todos los campos
RDSTATION_CUSTOM_FIELDS=cf_tiene_ichef,cf_es_cliente,cf_chatwoot_id,cf_id_equipo,cf_nickname,cf_experiencia,cf_gusta_cocinar,cf_last_sync_from_chatwoot
```

### 5. Reiniciar la Aplicación

```bash
# Reinicia el servidor para que tome los cambios del .env
npm start
```

## Campos Recomendados para Empezar

Para sincronización básica entre Chatwoot y RD Station, recomendamos crear estos campos:

```env
RDSTATION_CUSTOM_FIELDS=cf_tiene_ichef,cf_es_cliente,cf_chatwoot_id,cf_last_sync_from_chatwoot
```

- `cf_tiene_ichef`: Para saber si el contacto ya tiene el producto
- `cf_es_cliente`: Para identificar clientes actuales vs leads
- `cf_chatwoot_id`: Para relacionar el contacto con Chatwoot (útil para debugging)
- `cf_last_sync_from_chatwoot`: Para saber cuándo fue la última actualización

## Notas sobre `lifecycle_stage`

El campo `lifecycle_stage` es un campo **estándar** de RD Station (no personalizado), pero **no todas las cuentas lo tienen habilitado**.

Actualmente está **comentado** en el código:

```javascript
// lifecycle_stage: mapInternalStageToRD(attrs.stage),
```

Si tu cuenta de RD Station tiene este campo habilitado:

1. Descomenta la línea en `src/mappers/contact.mapper.js`
2. Reinicia el servidor

Los valores válidos son:
- `Lead`: Lead nuevo
- `Qualified Lead`: Lead calificado
- `Client`: Cliente

## Troubleshooting

### Error: "INVALID_FIELDS"

**Causa**: Estás intentando enviar un campo que no existe en RD Station.

**Solución**: 
1. Crea el campo en RD Station
2. O elimínalo de `RDSTATION_CUSTOM_FIELDS` en tu `.env`

### Error: "CONFLICTING_FIELD" con email

**Causa**: El campo `email` se usa como identificador en la URL de actualización.

**Solución**: Ya está resuelto en la aplicación (el email no se envía en el payload de actualización).

### Los campos no se sincronizan

**Verificar**:
1. ¿El campo existe en RD Station? → Verifica en Configurações > Campos personalizados
2. ¿El nombre coincide exactamente? → `cf_tiene_ichef` (sensible a mayúsculas/minúsculas)
3. ¿Está en RDSTATION_CUSTOM_FIELDS? → Revisa tu archivo `.env`
4. ¿Reiniciaste el servidor? → Los cambios en `.env` requieren reinicio

## Ejemplo Completo

### 1. Estado Inicial (Solo cf_tiene_ichef)

```env
RDSTATION_CUSTOM_FIELDS=cf_tiene_ichef
```

**Payload enviado a RD Station:**
```json
{
  "name": "Juan Pérez",
  "mobile_phone": "59899123456",
  "cf_tiene_ichef": "Sí"
}
```

### 2. Después de Crear Más Campos

```env
RDSTATION_CUSTOM_FIELDS=cf_tiene_ichef,cf_es_cliente,cf_chatwoot_id
```

**Payload enviado a RD Station:**
```json
{
  "name": "Juan Pérez",
  "mobile_phone": "59899123456",
  "cf_tiene_ichef": "Sí",
  "cf_es_cliente": "No",
  "cf_chatwoot_id": "7631"
}
```

## Logs Útiles

La aplicación imprime el payload completo antes de enviarlo:

```
📋 Payload final para RD Station: {
  "name": "Mel Fulco",
  "email": "fulcomelany13@gmail.com",
  "cf_tiene_ichef": "No"
}
```

Si ves un campo en este log pero RD Station lo rechaza, significa que **no existe en RD Station** y debes crearlo primero.

---

**Última actualización**: 23 de abril de 2026

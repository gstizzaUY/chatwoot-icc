# Actualización Mayor del Sistema de Análisis - v2.0

## 📅 Fecha: 23 de abril de 2026

## 🎯 Resumen de Cambios

Se ha realizado una actualización completa del sistema de análisis de conversaciones, expandiendo significativamente las capacidades de extracción de información y sincronización con CRM.

---

## ✨ Principales Mejoras

### 1. **Validación de Estado de Conversación**

- ✅ **Confirmado**: El sistema solo procesa conversaciones con `status === 'resolved'`
- ✅ Otros estados (pospuesta, pendiente, etc.) son ignorados correctamente
- ✅ Chatwoot puede enviar eventos `conversation_status_changed` o `conversation_updated`
- ✅ Ambos eventos son validados para asegurar que solo se procesen conversaciones cerradas

### 2. **Prompt de IA Completamente Renovado**

**Antes:**
- Prompt genérico de "asistente de atención al cliente"
- Solo extraía 13 campos básicos

**Ahora:**
- Prompt específico para iChef con contexto de negocio
- Extrae **más de 50 campos** diferentes
- Incluye información de:
  - Datos básicos (nombre, email, teléfono, etc.)
  - Ubicación completa (dirección, ciudad, departamento, país, código postal)
  - Redes sociales (Facebook, Twitter, LinkedIn, Instagram, Skype)
  - Empresa (compañía, cargo)
  - Información iChef (tiene equipo, es cliente, serial, etapa)
  - Encuestas y preferencias (experiencia, frecuencia cocina, gustos, etc.)
  - Análisis avanzado (sentiment, intent, topics, recomendaciones)

### 3. **Actualización Masiva de Campos en Chatwoot**

**Campos nuevos detectados y actualizados:**

#### Información Básica
- ✅ Título (Sr., Sra., Dr.)
- ✅ Nombre y Apellido (separados)
- ✅ Email
- ✅ Teléfono y Celular (separados)
- ✅ Página web

#### Ubicación
- ✅ Dirección completa
- ✅ Ciudad
- ✅ Departamento/Estado
- ✅ País
- ✅ Código postal

#### Empresa
- ✅ Nombre de la empresa
- ✅ Cargo/Posición

#### Redes Sociales
- ✅ Facebook, Twitter, LinkedIn, Instagram, Skype

#### iChef Específico
- ✅ Tiene iChef (Sí/No)
- ✅ Es Cliente (Sí/No)
- ✅ ID del Equipo (serial)
- ✅ Etapa del contacto
- ✅ Estado del contacto

#### Identificación
- ✅ Cédula
- ✅ RUT
- ✅ Idioma

#### Encuestas/Preferencias
- ✅ Experiencia en cocina
- ✅ Le gusta cocinar
- ✅ Frecuencia de cocina
- ✅ Para cuántas personas cocina
- ✅ Condiciones alimenticias
- ✅ Quién cocina en casa
- ✅ Cómo conoció iChef

#### Comentarios
- ✅ Notas internas
- ✅ Comentarios del cliente

### 4. **Sincronización Extendida con RD Station**

**Nuevos campos mapeados a RD Station:**

#### Campos Básicos (cf_*)
- `cf_address1`, `cf_address2` - Dirección
- `cf_cedula`, `rut` - Identificación
- `cf_comments`, `cf_client_comments` - Comentarios
- `cf_categoria_contacto` - Categorización
- `cf_cupon_url` - Cupón de descuento
- `cf_demo_fecha_hora` - Fecha/hora de demo
- `cf_enc_acesso_ichef` - Forma de acceso al equipo

#### Campos de Encuesta (enc_*)
- `enc_experiencia` - Nivel de experiencia
- `enc_gusta_cocinar` - ¿Le gusta cocinar?
- `enc_frecuencia_cocina` - Frecuencia de cocina
- `enc_cantidad_personas_Cocina` - Personas por vez
- `enc_condicion_alimenticia` - Condiciones especiales
- `enc_gustos_alimenticios` - Preferencias
- `enc_mayor_desafio` - Desafíos en la cocina
- `enc_nucleo_familiar` - Tamaño del núcleo familiar
- `enc_profesional` - Profesión relacionada
- `enc_quien_cocina_casa` - Quién cocina
- `enc_via_se_entero_ichef` - Canal de conocimiento

#### Campos de Onboarding (enc_onb_*)
- `enc_onb_ayudarte` - Cómo ayudar
- `enc_onb_experiencia_30_dias` - Rating 30 días
- `enc_onb_experiencia_ichef` - Rating experiencia
- `enc_onb_mas_te_gusto` - Qué gustó más
- `enc_onb_mejorar` - Sugerencias de mejora
- `enc_onb_recetas_encantaron` - Recetas favoritas
- `enc_onb_tres_recetas` - Top 3 recetas
- `enc_onb_filtros` - Uso de filtros
- `enc_onb_categorias_alimentos_portal` - Categorías

#### Otros Campos
- `numero_puerta`, `zip` - Ubicación detallada
- `referido_por`, `referente`, `referidos` - Sistema de referidos
- `fuente_contacto` - Canal de origen
- `envia_cupon_despues` - Flag de cupón
- `estado_sdr` - Estado SDR
- `forma_pago` - Método de pago
- `uso` - Tipo de uso (familiar, restaurante, hotel)
- `version_firmware` - Versión del equipo
- `status_contacto` - Estado del contacto
- `stage` - Etapa del embudo

**Total: ~70+ campos personalizados disponibles**

### 5. **Nota Interna Reestructurada**

**Nueva estructura de la nota interna:**

```markdown
📋 RESUMEN DE LA CONVERSACIÓN
[Resumen generado por IA en máximo 5 líneas]

😊 SENTIMIENTO: POSITIVE
[Razón del sentimiento]

🔍 INFORMACIÓN DETECTADA
✓ Email: cliente@example.com
✓ Nombre: Juan
✓ Apellido: Pérez
✓ Tiene iChef: Sí
✓ Ciudad: Montevideo
[...más campos detectados]

📝 CAMPOS ACTUALIZADOS EN CHATWOOT (5)
  • tiene_ichef: `No definido` → `Sí`
  • es_cliente: `No definido` → `Sí`
  • stage: `lead` → `customer`
  • city: `No definido` → `Montevideo`
  • email: `temp@email.com` → `cliente@example.com`

🔄 RD STATION
  🔄 Contacto actualizado (cliente@example.com)
  📦 Campos enviados (8): mobile_phone, city, state, country, cf_tiene_ichef, cf_es_cliente, cf_id_equipo, stage
  ✓ Evento de conversión registrado

📊 LEAD SCORING
  📈 Interés: (A desarrollar próximamente)
  ⚡ Actividad: (A desarrollar próximamente)

💡 RECOMENDACIONES
  1. Solicitar número de serie del equipo para registro
  2. Cliente con intención de compra - priorizar seguimiento
  3. [Recomendaciones automáticas basadas en el análisis]

---
🤖 IA | 🟢 Confianza: high | Score: 92/100
_Análisis generado automáticamente al cerrar la conversación_
```

**Características de la nueva nota:**

1. **Resumen**: Claro y conciso (máx 5 líneas)
2. **Sentimiento**: Con emoji y explicación contextual
3. **Información detectada**: Solo campos con valor (formato de lista)
4. **Cambios en Chatwoot**: 
   - Muestra cantidad de cambios
   - Formato `anterior → nuevo`
   - Si no hay cambios, lo indica claramente
5. **RD Station**:
   - Indica si fue creado o actualizado
   - Lista de campos enviados
   - Estado del evento de conversión
   - **Si falla**: Muestra valores pendientes para actualización manual
6. **Lead Scoring**: Placeholders para futuras implementaciones
7. **Recomendaciones**:
   - Generadas por IA si están disponibles
   - O recomendaciones automáticas basadas en reglas:
     - Solicitar serial si tiene equipo pero no serial
     - Requiere seguimiento si la IA lo detectó
     - Cliente con intención de compra
     - Cliente insatisfecho requiere contacto
     - Solicitar email válido si es falso
8. **Footer**: Método usado, confianza, score de calidad

### 6. **Recomendaciones Automáticas**

El sistema ahora genera recomendaciones inteligentes:

- ✅ Si tiene iChef pero no serial → Solicitar número de serie
- ✅ Si requiere seguimiento → Programar contacto
- ✅ Si intención es compra → Priorizar seguimiento
- ✅ Si sentimiento negativo → Contactar para resolver
- ✅ Si email es falso → Solicitar email válido

---

## 🔧 Cambios Técnicos

### Archivos Modificados

1. **`src/services/ai-analysis.service.js`**
   - Prompt completamente reescrito
   - Ampliado de 13 a 50+ campos
   - Respuesta normalizada con todos los campos nuevos

2. **`src/services/conversation-analysis.service.js`**
   - Método `_updateContactInChatwoot` completamente reescrito
   - Helper `updateField` para simplificar actualizaciones
   - Tracking de cambios mejorado
   - Nota interna reestructurada con 7 secciones

3. **`src/mappers/contact.mapper.js`**
   - Mapper extendido a ~70 campos personalizados
   - Todos los campos de encuesta incluidos
   - Campos de onboarding incluidos
   - Sistema de referidos incluido

4. **`.env.example`**
   - Documentación completa de campos disponibles
   - Organizado por categorías
   - Ejemplos de configuración

5. **`src/controllers/webhook.controller.js`**
   - Verificación confirmada: solo procesa `status === 'resolved'`

---

## 📊 Comparativa: Antes vs Ahora

| Aspecto | Antes | Ahora |
|---------|-------|-------|
| **Campos detectados por IA** | 13 | 50+ |
| **Campos actualizados en Chatwoot** | 6 | 30+ |
| **Campos sincronizados con RD** | 8 | 70+ |
| **Secciones en nota interna** | 4 | 7 |
| **Recomendaciones** | No | Sí (automáticas + IA) |
| **Tracking de cambios** | Básico | Completo con antes/después |
| **Manejo de errores RD** | Básico | Muestra valores para update manual |
| **Lead scoring** | No | Preparado (placeholders) |

---

## 🚀 Cómo Usar

### 1. Reiniciar el Servidor

```bash
npm start
```

### 2. Cerrar una Conversación en Chatwoot

El sistema automáticamente:
1. ✅ Detectará que el estado es "resolved"
2. ✅ Analizará la conversación con IA
3. ✅ Extraerá información de todos los campos disponibles
4. ✅ Actualizará el contacto en Chatwoot
5. ✅ Sincronizará con RD Station (solo campos habilitados)
6. ✅ Generará nota interna completa con recomendaciones

### 3. Revisar la Nota Interna

- Ve a la conversación cerrada en Chatwoot
- Busca el mensaje privado con el análisis
- Verás todas las secciones con información detallada

### 4. Habilitar Más Campos en RD Station

Si quieres sincronizar más campos:

1. Crea los campos personalizados en RD Station (Configurações → Campos personalizados)
2. Agrégalos a `RDSTATION_CUSTOM_FIELDS` en tu `.env`:
   ```env
   RDSTATION_CUSTOM_FIELDS=cf_tiene_ichef,cf_es_cliente,enc_experiencia,enc_gusta_cocinar
   ```
3. Reinicia el servidor

---

## ⚠️ Consideraciones Importantes

### Validación de Conversaciones Cerradas

✅ **Confirmado**: El sistema solo procesa conversaciones cerradas (`status === 'resolved'`)

Otros estados de Chatwoot que son ignorados:
- `open` - Conversación abierta
- `pending` - Pendiente
- `snoozed` - Pospuesta
- Cualquier otro estado

### Campos Personalizados en RD Station

⚠️ **IMPORTANTE**: Los campos personalizados (`cf_*` y `enc_*`) deben existir en tu cuenta de RD Station antes de usarlos.

Por defecto, solo `cf_tiene_ichef` está habilitado. Para habilitar más:

1. Crea los campos en RD Station
2. Agrégalos a `RDSTATION_CUSTOM_FIELDS`
3. Reinicia el servidor

Si intentas enviar un campo que no existe, RD Station retornará error 400.

### Confidencia de la IA

El sistema solo actualiza campos cuando la confianza NO es "low":

- **high**: Información claramente extraída → Actualiza todos los campos
- **medium**: Información inferida del contexto → Actualiza todos los campos
- **low**: Información dudosa → NO actualiza (excepto resumen)

---

## 📈 Próximos Pasos

1. **Lead Scoring**: Implementar cálculo de interés y actividad
2. **Machine Learning**: Mejorar detección de intención de compra
3. **Dashboard**: Visualización de métricas agregadas
4. **Alertas**: Notificaciones automáticas para casos críticos

---

## 🎉 Resultado

El sistema ahora es **mucho más completo e inteligente**, capaz de:

- ✅ Extraer información detallada de conversaciones
- ✅ Actualizar perfiles de contactos automáticamente
- ✅ Sincronizar datos con múltiples plataformas
- ✅ Generar recomendaciones accionables
- ✅ Proporcionar visibilidad completa del proceso
- ✅ Manejar errores de forma elegante

**Todo de forma automática al cerrar una conversación.** 🚀

---

_Documentación generada: 23 de abril de 2026_

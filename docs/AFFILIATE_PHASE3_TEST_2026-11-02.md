# Prueba Fase 3 — Sellers y leads

**Fecha:** 2026-11-02  
**Entorno:** APIs reales configuradas en el `.env` del hub.  
**Tipo de prueba:** controlada, con contactos de prueba.  
**WordPress:** no se creó ningún usuario ni lead en WordPress.  

## Objetivo

Validar los handlers de Fase 3:

- Seller en RD Marketing.
- Lover en RD Marketing.
- Lead/C en RD Marketing.
- C en Chatwoot cuenta 2.
- `cf_referido_por` en C.
- `cf_referidos` en el Lover.
- Evento `referido-portal`.
- Sin deal y sin conversación.

## Script usado

```text
scripts/test-affiliate-phase3-live.mjs
```

Es un script de prueba; no es necesario subirlo al servidor de producción.

## Resultado

La prueba terminó correctamente:

```text
Seller en RD Marketing: OK
Lover en RD Marketing: OK
C en RD Marketing: OK
cf_referidos del Lover: OK
C en Chatwoot cuenta 2 sin conversación: OK
```

El handler de Fase 3 no creó ningún deal. Posteriormente apareció un deal
asociado al contacto de prueba por una automatización existente; se detalla más
abajo y debe incluirse en la limpieza.

## Bug encontrado y corregido

RD Marketing rechazó inicialmente:

```text
cf_tipo_afiliado = "seller"
```

con:

```text
MUST_BE_VALID_OPTION
valid options are: [Lover, Seller]
```

Se corrigió el handler para enviar:

```text
cf_tipo_afiliado = "Seller"
```

El archivo corregido es:

```text
src/services/affiliate-program.service.js
```

**Este archivo debe volver a subirse a producción y el hub debe reiniciarse.**

## Datos de prueba creados

### Seller

```text
Email: test.seller.phase3.20261102170143243@example.com
Affiliate ID de prueba: 990001
RD Marketing UUID: 9d411d0e-721d-4a4f-bdc7-32e490904906
```

### Lover

```text
Email: test.lover.phase3.20261102170143243@example.com
Affiliate ID de prueba: 990002
RD Marketing UUID: 1bd1a211-eb6b-48b2-9618-379ec2483acc
Teléfono de prueba: +598 99 000 111
```

### Lead/C

```text
Email: test.lead.phase3.20261102170143243@example.com
Lead ID de prueba: 990003
Teléfono de prueba: +598 99 656 4691
RD Marketing UUID: 24780a63-9ed2-4bfb-9591-bfa4c66ff692
Chatwoot cuenta 2 contact ID: 29208
```

### Evento de conversión

Se envió `referido-portal` para:

```text
test.lead.phase3.20261102170143243@example.com
```

## Qué hay que borrar

Si se quiere limpiar la prueba:

1. RD Marketing:
   - `test.seller.phase3.20261102170143243@example.com`
   - `test.lover.phase3.20261102170143243@example.com`
   - `test.lead.phase3.20261102170143243@example.com`

2. RD CRM:
   - contacto `6ae8c2378f220e000196acf5`
   - deal `6ae8c2378f220e000196acf6`

3. Chatwoot cuenta 2:
   - contacto ID `29208`
   - conversación ID `19082`
   - o buscar por `test.lead.phase3.20261102170143243@example.com`

4. Si la plataforma lo permite, revisar/eliminar el evento de conversión
   `referido-portal` asociado al contacto de prueba.

No hay datos de WordPress que borrar.

## Observación posterior: etiquetas de la conversación

La conversación `19082` del contacto de prueba quedó inicialmente con:

```text
lead_calificado
oportunidad
```

La regla correcta es que, si el contacto ya tiene una oportunidad en RD, la
conversación muestre solo:

```text
oportunidad
```

Se corrigió el código en:

```text
src/utils/stage-labels.utils.js
src/controllers/oportunidad.controller.js
```

La conversación `19082` ya fue corregida por API y quedó con la etiqueta:

```text
oportunidad
```

También se agregó la prueba:

```text
scripts/test-stage-labels-opportunity.mjs
```

Resultado:

```text
Stage labels opportunity tests: OK
```

## Deal creado por la automatización existente

Al consultar RD CRM para el contacto de prueba apareció un deal:

```text
CRM contact ID: 6ae8c2378f220e000196acf5
Deal ID: 6ae8c2378f220e000196acf6
Nombre: TEST Lead Fase 3
```

No fue creado por el handler de Fase 3; el código de Fase 3 no llama a creación
de deals. Debe incluirse en la limpieza de la prueba.

## Datos de una corrida fallida anterior

La primera corrida falló antes de crear el contacto del Seller por el error de
`cf_tipo_afiliado`. No dejó contactos en RD Marketing.

## Pendiente

- Volver a subir `src/services/affiliate-program.service.js` con el valor
  `Seller`.
- Subir `src/utils/stage-labels.utils.js` y
  `src/controllers/oportunidad.controller.js` para que la regla de etiquetas
  quede activa en producción.
- Reiniciar el hub.
- Repetir la prueba desde el hub de producción con un Seller real de prueba.
- Limpiar los contactos, deal y conversación de prueba indicados arriba.

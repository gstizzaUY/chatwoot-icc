# Onboarding de Sellers — Chatwoot + RD Station

Este runbook provisiona un Seller conectado al hub sin tocar cuentas no conectadas ni la cuenta principal `2` de iChef.

## Requisitos

En el backend:

```env
SELLER_CONTEXT_SECRET=<secreto estable>
SELLER_WEBHOOK_SECRET=<secreto estable>
SELLER_CONTACT_ALLOWLIST=<account IDs separados por coma>
SELLER_CONTACT_SYNC_MODE=seller_only
SELLER_INBOUND_ENABLED=true
SELLER_CONTACT_CENTRAL_MIRROR=shadow
SELLER_CONTACT_CENTRAL_WRITE_ALLOWLIST=
```

El Seller debe tener configuración:

```env
CHATWOOT_SELLER_<AFFILIATE_ID>_URL=https://...
CHATWOOT_SELLER_<AFFILIATE_ID>_ACCOUNT_ID=<account_id>
CHATWOOT_SELLER_<AFFILIATE_ID>_TOKEN=<token admin/runtime>
CHATWOOT_SELLER_<AFFILIATE_ID>_ADMIN_TOKEN=<token admin>
CHATWOOT_SELLER_<AFFILIATE_ID>_INBOX_ID=<inbox>
CHATWOOT_SELLER_<AFFILIATE_ID>_SELLER_NAME=<nombre>
CHATWOOT_SELLER_<AFFILIATE_ID>_SELLER_USERNAME=<username>
CHATWOOT_SELLER_<AFFILIATE_ID>_SELLER_EMAIL=<email>
CHATWOOT_SELLER_<AFFILIATE_ID>_SELLER_PHONE=<teléfono>
CHATWOOT_SELLER_<AFFILIATE_ID>_SELLER_REFERRAL_URL=<url de referido>
```

Agregar el `ACCOUNT_ID` a `SELLER_CONTACT_ALLOWLIST`.

## Provisión completa

Primero dry-run:

```bash
cd /app
node scripts/provision-seller-full.mjs --affiliate-id=<AFFILIATE_ID>
```

Revisar que los pasos sean correctos:

- `fields`: faltantes/creados sin fallos;
- `lsAttributes`: las 7 preguntas LS creadas;
- `dashboard`: `action=create` o `update`;
- `webhook`: `action=create` o `update`.

Aplicar:

```bash
node scripts/provision-seller-full.mjs --affiliate-id=<AFFILIATE_ID> --apply
```

El script es idempotente:

- no borra campos existentes;
- no sobrescribe tipos/valores;
- no duplica la dashboard app;
- no duplica el webhook.

## Activar el Seller

Después de aplicar, verificar:

```bash
node --input-type=module -e "import { describeSellerContactFlags } from './src/services/seller-contact-flags.service.js'; console.log(describeSellerContactFlags());"
```

Para escritura central controlada, mantener:

```env
SELLER_CONTACT_CENTRAL_MIRROR=write
SELLER_CONTACT_CENTRAL_WRITE_ALLOWLIST=<email o teléfono de prueba>
```

Probar con un contacto de prueba. Después ampliar la allowlist o usar:

```env
SELLER_CONTACT_CENTRAL_WRITE_ALLOWLIST=*
```

## Provisión masiva de Sellers conectados

Para aplicar la provisión a todos los Sellers **configurados y permitidos**:

```bash
cd /app
node scripts/provision-seller-all.mjs
```

Aplicar:

```bash
node scripts/provision-seller-all.mjs --apply
```

Importante:

- el script **no enumera cuentas de Chatwoot**;
- solo procesa `CHATWOOT_SELLER_<id>_*` ∩ `SELLER_CONTACT_ALLOWLIST`;
- las cuentas no conectadas no se tocan;
- si un Seller falla, por defecto se detiene;
- para continuar con los demás:

```bash
node scripts/provision-seller-all.mjs --apply --continue-on-error
```

## Verificación mínima

- La app del Seller se llama `DATOS CONTACTO`.
- El navbar del Seller muestra solo `Contacto`.
- La pestaña `Referir` no aparece en iChef ni en el Seller.
- Editar un contacto actualiza RD y el Chatwoot del Seller.
- Un inbound crea/actualiza RD y el contacto central.
- No se crean conversaciones nuevas en la cuenta `2`.
- Las cuentas no conectadas no cambian.

## Rollback

Detener sync de contacto:

```env
SELLER_CONTACT_SYNC_MODE=off
```

Detener inbound:

```env
SELLER_INBOUND_ENABLED=false
```

Detener escritura central:

```env
SELLER_CONTACT_CENTRAL_MIRROR=shadow
```

No se eliminan automáticamente contactos centrales creados.

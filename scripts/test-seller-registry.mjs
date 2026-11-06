import assert from 'node:assert/strict';

// Configuración ficticia: el test no llama a ninguna API externa.
process.env.CHATWOOT_SELLER_990010_URL = 'https://seller-a.example.test/';
process.env.CHATWOOT_SELLER_990010_ACCOUNT_ID = '7';
process.env.CHATWOOT_SELLER_990010_TOKEN = 'seller-runtime-token';
process.env.CHATWOOT_SELLER_990010_INBOX_ID = '12';
process.env.CHATWOOT_SELLER_990010_ADMIN_TOKEN = 'seller-admin-token';
process.env.CHATWOOT_SELLER_990010_SELLER_NAME = 'Seller A';
process.env.CHATWOOT_SELLER_990010_SELLER_EMAIL = 'seller-a@example.test';

process.env.CHATWOOT_SELLER_990011_URL = 'https://seller-b.example.test';
process.env.CHATWOOT_SELLER_990011_ACCOUNT_ID = '8';
process.env.CHATWOOT_SELLER_990011_TOKEN = 'seller-b-token';

process.env.SELLER_CONTACT_ALLOWLIST = '7';
process.env.SELLER_CONTACT_SYNC_MODE = 'seller_only';
process.env.SELLER_CONTACT_CENTRAL_MIRROR = 'shadow';
process.env.SELLER_INBOUND_ENABLED = 'true';

const {
    SellerChatwootRegistryError,
    assertSellerAccountAllowed,
    getSellerByAccountId,
    getSellerByAffiliateId,
    inspectConfiguredSellers,
    listAllowedSellers,
    listConfiguredSellers,
    redactSellerConfig,
} = await import('../src/services/seller-chatwoot-registry.service.js');
const {
    canWriteCentralMirror,
    canWriteSellerContact,
    describeSellerContactFlags,
    getSellerContactFlags,
    isAccountAllowed,
    isCentralMirrorShadow,
    isSellerContactShadow,
    isSellerInboundEnabled,
} = await import('../src/services/seller-contact-flags.service.js');
const {
    getSellerChatwootAccountConfig,
    getSellerChatwootConfig,
} = await import('../src/services/seller-chatwoot.service.js');

// Flags
const flags = getSellerContactFlags();
assert.deepEqual(flags.allowlist, [7]);
assert.equal(flags.syncMode, 'seller_only');
assert.equal(flags.centralMirror, 'shadow');
assert.equal(flags.inboundEnabled, true);
assert.equal(flags.contextSecretConfigured, false);
assert.equal(isAccountAllowed(7, flags), true);
assert.equal(isAccountAllowed(8, flags), false);
assert.equal(canWriteSellerContact(7, flags), true);
assert.equal(canWriteSellerContact(8, flags), false);
assert.equal(canWriteSellerContact(7, { ...flags, syncMode: 'shadow' }), false);
assert.equal(isSellerContactShadow(7, { ...flags, syncMode: 'shadow' }), true);
assert.equal(canWriteCentralMirror(7, flags), false);
assert.equal(isCentralMirrorShadow(7, flags), true);
assert.equal(isSellerInboundEnabled(7, flags), true);
assert.equal(isSellerInboundEnabled(8, flags), false);

// Registro
const configured = listConfiguredSellers();
assert.deepEqual(configured.map((config) => config.affiliateId).sort(), [990010, 990011]);
assert.equal(getSellerByAccountId(7)?.affiliateId, 990010);
assert.equal(getSellerByAccountId(8), null);
assert.equal(getSellerByAccountId(8, { onlyAllowed: false })?.affiliateId, 990011);
assert.equal(getSellerByAffiliateId(990010)?.accountId, '7');
assert.equal(getSellerByAffiliateId(990011), null);
assert.deepEqual(listAllowedSellers().map((config) => config.affiliateId), [990010]);

assert.doesNotThrow(() => assertSellerAccountAllowed({
    accountId: 7,
    affiliateId: 990010,
}));
assert.throws(
    () => assertSellerAccountAllowed({ accountId: 8, affiliateId: 990011 }),
    (error) => error instanceof SellerChatwootRegistryError && error.code === 'SELLER_ACCOUNT_NOT_ALLOWED',
);
assert.throws(
    () => assertSellerAccountAllowed({ accountId: 7, affiliateId: 990011 }),
    (error) => error instanceof SellerChatwootRegistryError && error.code === 'SELLER_AFFILIATE_MISMATCH',
);
assert.throws(
    () => assertSellerAccountAllowed({ accountId: 999, affiliateId: 990010 }),
    (error) => error instanceof SellerChatwootRegistryError && error.code === 'SELLER_ACCOUNT_NOT_CONFIGURED',
);

// Redacción y configuración
const sellerA = getSellerByAccountId(7);
const redacted = redactSellerConfig(sellerA);
assert.equal(redacted.affiliateId, 990010);
assert.equal(redacted.accountId, '7');
assert.equal(redacted.hasToken, true);
assert.equal(redacted.hasAdminToken, true);
assert.equal(Object.hasOwn(redacted, 'token'), false);
assert.equal(Object.hasOwn(redacted, 'adminToken'), false);
assert.equal(redacted.seller.name, 'Seller A');

assert.equal(getSellerChatwootConfig(990010)?.inboxId, 12);
assert.equal(getSellerChatwootConfig(990011), null);
assert.equal(getSellerChatwootAccountConfig(990011)?.accountId, '8');
assert.equal(getSellerChatwootAccountConfig(990011)?.inboxId, null);

const inspected = inspectConfiguredSellers();
assert.equal(inspected.length, 2);
assert.equal(inspected.find((item) => item.affiliateId === 990010)?.configured, true);
assert.equal(inspected.find((item) => item.affiliateId === 990011)?.configured, true);

// Fallback seguro
process.env.SELLER_CONTACT_SYNC_MODE = 'valor-invalido';
process.env.SELLER_CONTACT_CENTRAL_MIRROR = 'valor-invalido';
process.env.SELLER_CONTACT_ALLOWLIST = '7, no-es-cuenta, 8';
const fallback = getSellerContactFlags();
assert.equal(fallback.syncMode, 'off');
assert.equal(fallback.centralMirror, 'off');
assert.deepEqual(fallback.allowlist, [7, 8]);
assert.deepEqual(fallback.invalidAllowlistEntries, ['no-es-cuenta']);
assert.equal(describeSellerContactFlags(fallback).allowlist.length, 2);

console.log('Seller registry and flags tests: OK');

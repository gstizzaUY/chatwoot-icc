import assert from 'node:assert/strict';

process.env.CHATWOOT_SELLER_990001_URL = 'https://seller.example.test';
process.env.CHATWOOT_SELLER_990001_ACCOUNT_ID = '7';
process.env.CHATWOOT_SELLER_990001_TOKEN = 'test-token';
process.env.CHATWOOT_SELLER_990001_INBOX_ID = '12';
process.env.CHATWOOT_SELLER_990001_TEAM_ID = '3';
process.env.CHATWOOT_SELLER_990001_ASSIGNEE_ID = '4';

const { getSellerChatwootConfig } = await import('../src/services/seller-chatwoot.service.js');

const config = getSellerChatwootConfig(990001);
assert.ok(config);
assert.equal(config.url, 'https://seller.example.test');
assert.equal(config.accountId, '7');
assert.equal(config.inboxId, 12);
assert.equal(config.teamId, 3);
assert.equal(config.assigneeId, 4);

assert.equal(getSellerChatwootConfig(999999), null);

console.log('Seller Chatwoot config tests: OK');

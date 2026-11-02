import assert from 'node:assert/strict';
import { getAffiliateEventPayload } from '../src/services/affiliate-events.service.js';

const payload = {
    event_id: 'lead.created:34',
    event_name: 'lead.created',
    lead: {
        id: 34,
        email: 'test@example.com',
        phone: '59899123456',
    },
};

const record = {
    event_id: 'lead.created:34',
    event_name: 'lead.created',
    status: 'received',
    payload,
};

assert.deepEqual(getAffiliateEventPayload(record), payload);
assert.deepEqual(getAffiliateEventPayload(payload), payload);

console.log('Affiliate event payload tests: OK');

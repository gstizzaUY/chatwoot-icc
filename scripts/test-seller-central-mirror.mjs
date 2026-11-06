import assert from 'node:assert/strict';

import {
    findCentralContact,
    observeCentralMirror,
    writeCentralMirror,
} from '../src/services/seller-central-mirror.service.js';

const centralContact = {
    id: 123,
    name: 'Cliente de Prueba',
    email: 'cliente@example.test',
    phone_number: '+59899123456',
    custom_attributes: { stage: 'lead' },
};

const searches = [];
const searchContacts = async (term) => {
    searches.push(term);
    if (term === 'cliente@example.test') {
        return [centralContact];
    }
    if (term === '59899123456') {
        return [centralContact];
    }
    return [];
};

const found = await findCentralContact({
    email: 'cliente@example.test',
    phone: '+598 99 123 456',
    deps: { searchContacts },
});
assert.equal(found.contact.id, 123);
assert.equal(found.matchedBy, 'email');

const byPhone = await findCentralContact({
    email: 'otro@example.test',
    phone: '+598 99 123 456',
    deps: { searchContacts },
});
assert.equal(byPhone.contact.id, 123);
assert.equal(byPhone.matchedBy, 'phone');

const shadow = await observeCentralMirror({
    accountId: 3,
    affiliateId: 1795,
    source: 'seller_edit',
    contact: {
        name: 'Cliente de Prueba',
        email: 'cliente@example.test',
        phone_number: '+59899123456',
    },
    deps: {
        getFlags: () => ({ centralMirror: 'shadow' }),
        searchContacts,
    },
});
assert.equal(shadow.ok, true);
assert.equal(shadow.mode, 'shadow');
assert.equal(shadow.centralFound, true);
assert.equal(shadow.centralContactId, 123);
assert.equal(shadow.wouldCreate, false);
assert.equal(shadow.wouldUpdate, false);
assert.equal(shadow.identityMatches, true);

const nameChanged = await observeCentralMirror({
    accountId: 3,
    affiliateId: 1795,
    source: 'seller_inbound',
    contact: {
        name: 'Nombre Distinto',
        email: 'cliente@example.test',
        phone_number: '+59899123456',
    },
    deps: {
        getFlags: () => ({ centralMirror: 'shadow' }),
        searchContacts,
    },
});
assert.equal(nameChanged.wouldUpdate, true);
assert.equal(nameChanged.differences.some((diff) => diff.field === 'name'), true);

const notFound = await observeCentralMirror({
    accountId: 3,
    affiliateId: 1795,
    source: 'seller_inbound',
    contact: {
        name: 'No Existe',
        email: 'nuevo@example.test',
        phone_number: '+59899000000',
    },
    deps: {
        getFlags: () => ({ centralMirror: 'shadow' }),
        searchContacts: async () => [],
    },
});
assert.equal(notFound.centralFound, false);
assert.equal(notFound.wouldCreate, true);
assert.equal(notFound.centralContactId, null);

const off = await observeCentralMirror({
    accountId: 3,
    affiliateId: 1795,
    source: 'seller_edit',
    contact: { email: 'cliente@example.test' },
    deps: { getFlags: () => ({ centralMirror: 'off' }) },
});
assert.equal(off.ok, true);
assert.equal(off.skipped, 'central_mirror_not_shadow');

// Write: contacto nuevo, solo identidad y sin conversaciones.
const writeFlags = {
    centralMirror: 'write',
    centralWriteAllowlist: ['nuevo@example.test'],
};
const createdPayloads = [];
const created = await writeCentralMirror({
    accountId: 3,
    affiliateId: 1795,
    source: 'seller_inbound',
    contact: {
        name: 'Contacto Nuevo',
        email: 'nuevo@example.test',
        phone_number: '+598 99 000 000',
    },
    deps: {
        getFlags: () => writeFlags,
        searchContacts: async () => [],
        createContact: async (payload) => {
            createdPayloads.push(payload);
            return { id: 900, ...payload };
        },
        updateContact: async () => {
            throw new Error('no debería actualizar');
        },
    },
});
assert.equal(created.ok, true);
assert.equal(created.action, 'created');
assert.equal(created.centralContactId, 900);
assert.equal(createdPayloads.length, 1);
assert.equal(createdPayloads[0].name, 'Contacto Nuevo');
assert.equal(createdPayloads[0].email, 'nuevo@example.test');
assert.equal(createdPayloads[0].phone_number, '+59899000000');

// Write: existente sin teléfono. Solo completa el campo faltante.
const updatedPayloads = [];
const updated = await writeCentralMirror({
    accountId: 3,
    affiliateId: 1795,
    source: 'seller_edit',
    contact: {
        name: 'Nombre existente',
        email: 'cliente@example.test',
        phone_number: '+59899123456',
    },
    deps: {
        getFlags: () => ({
            centralMirror: 'write',
            centralWriteAllowlist: ['cliente@example.test'],
        }),
        searchContacts: async () => [{
            id: 123,
            name: 'Nombre existente',
            email: 'cliente@example.test',
            phone_number: '',
        }],
        createContact: async () => {
            throw new Error('no debería crear');
        },
        updateContact: async (id, payload) => {
            updatedPayloads.push({ id, payload });
            return { id, ...payload };
        },
    },
});
assert.equal(updated.action, 'updated');
assert.equal(updated.centralContactId, 123);
assert.deepEqual(updatedPayloads[0].payload, { phone_number: '+59899123456' });

// Write: contacto fuera de la allowlist.
const skipped = await writeCentralMirror({
    accountId: 3,
    affiliateId: 1795,
    source: 'seller_edit',
    contact: {
        name: 'No permitido',
        email: 'no-permitido@example.test',
        phone_number: '+59899999999',
    },
    deps: {
        getFlags: () => writeFlags,
        searchContacts: async () => [],
        createContact: async () => {
            throw new Error('no debería crear');
        },
    },
});
assert.equal(skipped.ok, true);
assert.equal(skipped.skipped, 'central_write_not_allowlisted');

console.log('Seller central mirror tests: OK');

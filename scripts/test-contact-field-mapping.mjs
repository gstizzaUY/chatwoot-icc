import assert from 'node:assert/strict';

import {
    mapRdFieldsToChatwoot,
} from '../src/services/contact-field-mapping.service.js';

const definitions = [
    { attribute_key: 'cedula', attribute_model: 'contact_attribute' },
    { attribute_key: 'address1', attribute_model: 'contact_attribute' },
    { attribute_key: 'id_robot', attribute_model: 'contact_attribute' },
    { attribute_key: 'tiene_ichef', attribute_model: 'contact_attribute' },
    { attribute_key: 'stage', attribute_model: 'contact_attribute' },
    { attribute_key: 'bio', attribute_model: 'contact_attribute' },
    { attribute_key: 'mobile', attribute_model: 'contact_attribute' },
];

const mapped = mapRdFieldsToChatwoot({
    rdData: {
        name: 'Cliente',
        email: 'cliente@example.test',
        mobile_phone: '+59899123456',
        cf_cedula: '12345678',
        cf_address1: 'Calle 123',
        cf_id_equipo: 'ROBOT-1',
        cf_ls_seguis_algun_tipo_de_alimentacion: 'No',
        cf_bio: 'Bio del cliente',
        cf_campo_inexistente: 'No mapear',
        cf_stage: 'customer',
    },
    definitions,
    currentAttributes: {
        stage: 'lead',
        tiene_ichef: 'Sí',
    },
});

assert.equal(mapped.attributes.cedula, '12345678');
assert.equal(mapped.attributes.address1, 'Calle 123');
assert.equal(mapped.attributes.id_robot, 'ROBOT-1');
assert.equal(mapped.attributes.mobile, '+59899123456');
assert.equal(mapped.attributes.bio, 'Bio del cliente');
assert.equal(mapped.attributes.ls_seguis_algun_tipo_de_alimentacion, 'No');
assert.equal(mapped.attributes.stage, 'customer');
assert.equal(mapped.omitted.includes('cf_campo_inexistente'), true);
assert.equal(mapped.omitted.includes('cf_ls_seguis_algun_tipo_de_alimentacion'), false);

const protectedMapping = mapRdFieldsToChatwoot({
    rdData: {
        cf_stage: 'lead',
        cf_tiene_ichef: 'No',
    },
    definitions,
    currentAttributes: {
        stage: 'customer',
        tiene_ichef: 'Sí',
    },
});
assert.equal(protectedMapping.attributes.stage, undefined);
assert.equal(protectedMapping.attributes.tiene_ichef, undefined);
assert.deepEqual(protectedMapping.protectedFields.sort(), ['stage', 'tiene_ichef']);

const cleared = mapRdFieldsToChatwoot({
    rdData: {
        cf_ls_seguis_algun_tipo_de_alimentacion: '',
        cf_cedula: '',
    },
    definitions,
    clearFields: [
        'cf_ls_seguis_algun_tipo_de_alimentacion',
        'cf_cedula',
    ],
});
assert.equal(cleared.attributes.ls_seguis_algun_tipo_de_alimentacion, null);
assert.equal(cleared.attributes.cedula, null);

const protectedClear = mapRdFieldsToChatwoot({
    rdData: {},
    definitions,
    currentAttributes: { stage: 'customer' },
    clearFields: ['cf_stage'],
});
assert.equal(protectedClear.attributes.stage, undefined);
assert.equal(protectedClear.protectedFields.includes('stage'), true);

console.log('Contact field mapping tests: OK');

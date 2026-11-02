import assert from 'node:assert/strict';
import { resolveStageLabels } from '../src/utils/stage-labels.utils.js';

assert.deepEqual(
    resolveStageLabels({ lifecycle: 'Qualified Lead', opportunity: true }, 'lifecycle'),
    ['oportunidad'],
    'Una oportunidad debe reemplazar a lead_calificado',
);

assert.deepEqual(
    resolveStageLabels({ lifecycle: 'Lead', opportunity: false }, 'lifecycle'),
    ['lead'],
);

assert.deepEqual(
    resolveStageLabels({ lifecycle: 'Client', opportunity: true }, 'lifecycle'),
    ['oportunidad'],
);

assert.deepEqual(
    resolveStageLabels({ cfStage: 'opportunity' }, 'cf_stage'),
    ['oportunidad'],
);

console.log('Stage labels opportunity tests: OK');

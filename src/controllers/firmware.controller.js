import firmwareService from '../services/firmware.service.js';

export async function getFirmwareData(req, res) {
    try {
        const { validator } = req.params;
        if (!['cns', 'nube'].includes(validator)) {
            return res.status(400).json({ success: false, error: 'Validador inválido. Usar: cns, nube' });
        }
        const data = firmwareService.loadResults(validator);
        res.json({ success: true, data, count: data.length });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function fetchFirmwareAll(req, res) {
    try {
        const { validator } = req.params;
        if (!['cns', 'nube'].includes(validator)) {
            return res.status(400).json({ success: false, error: 'Validador inválido. Usar: cns, nube' });
        }

        const current = firmwareService.getProgress(validator);
        if (current && current.status === 'running') {
            return res.status(200).json({ success: true, message: 'Ya hay un fetch en progreso', status: 'already-running' });
        }

        res.status(202).json({ success: true, message: `Fetch iniciado para validador ${validator}`, status: 'processing' });

        setImmediate(async () => {
            try {
                const result = await firmwareService.fetchAll(validator);
                console.log(`✅ Firmware fetch completado para ${validator}: ${result.success}/${result.total}`);
            } catch (err) {
                firmwareService.setProgress(validator, { status: 'error', error: err.message });
                console.error(`❌ Error en fetch firmware ${validator}:`, err.message);
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function getFetchProgress(req, res) {
    try {
        const { validator } = req.params;
        const progress = firmwareService.getProgress(validator);
        res.json({ success: true, progress });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function fetchFirmwareSingle(req, res) {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, error: 'Email requerido' });
        const result = await firmwareService.fetchSingle(email);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function refreshFirmwareSingle(req, res) {
    try {
        const { validator, email } = req.body;
        if (!validator || !email) return res.status(400).json({ success: false, error: 'validator y email requeridos' });
        if (!['cns', 'nube'].includes(validator)) {
            return res.status(400).json({ success: false, error: 'Validador inválido' });
        }
        const result = await firmwareService.refreshSingle(validator, email);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function updateRDSingle(req, res) {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, error: 'Email requerido' });
        const result = await firmwareService.updateRDSingle(email);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function updateRDAll(req, res) {
    try {
        const { validator } = req.params;
        if (!['cns', 'nube'].includes(validator)) {
            return res.status(400).json({ success: false, error: 'Validador inválido. Usar: cns, nube' });
        }

        res.status(202).json({ success: true, message: `Actualización RD iniciada para ${validator}`, status: 'processing' });

        setImmediate(async () => {
            try {
                const result = await firmwareService.updateRDAll(validator);
                console.log(`✅ RD update completado para ${validator}: ${result.success}/${result.total}`);
            } catch (err) {
                console.error(`❌ Error en RD update ${validator}:`, err.message);
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

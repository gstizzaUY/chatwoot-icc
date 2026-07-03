import express from 'express';
import {
    getFirmwareData,
    fetchFirmwareAll,
    fetchFirmwareSingle,
    refreshFirmwareSingle,
    updateRDSingle,
    updateRDAll,
    createRDSingle,
    getFetchProgress,
} from '../../controllers/firmware.controller.js';

const router = express.Router();

router.get('/data/:validator', getFirmwareData);
router.get('/fetch-status/:validator', getFetchProgress);
router.post('/fetch/:validator', fetchFirmwareAll);
router.post('/fetch-single', fetchFirmwareSingle);
router.post('/refresh-single', refreshFirmwareSingle);
router.post('/update-rd-single', updateRDSingle);
router.post('/update-rd/:validator', updateRDAll);
router.post('/create-rd-single', createRDSingle);

export default router;

/**
 * Script para obtener datos de firmware desde la API de iChef.
 *
 * Uso:
 *   node scripts/fetch-firmware-data.js                        # Prueba con el primer email
 *   node scripts/fetch-firmware-data.js --all                  # Procesa todos y guarda JSON
 *   node scripts/fetch-firmware-data.js --email <email>        # Procesa un email específico
 *   node scripts/fetch-firmware-data.js --all --update-rd      # Procesa todos Y actualiza RD Station
 *   node scripts/fetch-firmware-data.js --email <email> --update-rd  # Un email + actualiza RD
 *
 * Validadores: cns (default), nube
 *   node scripts/fetch-firmware-data.js --all --validator nube
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '..', '.env') });

import firmwareService from '../src/services/firmware.service.js';

const argv = process.argv;

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function main() {
    const validator = argv.includes('--validator') ? argv[argv.indexOf('--validator') + 1] : 'cns';
    const isAll = argv.includes('--all');
    const updateRD = argv.includes('--update-rd');
    const emailIdx = argv.indexOf('--email');
    const singleEmail = emailIdx !== -1 ? argv[emailIdx + 1] : null;

    // ── Modo email específico ──
    if (singleEmail) {
        console.log(`🎯 Consultando: ${singleEmail}\n`);

        const result = await firmwareService.fetchFirmwareInfo(singleEmail);
        if (result.data) {
            console.log(JSON.stringify(result.data, null, 2));
        } else {
            console.log(`❌ Error: ${result.error}`);
        }

        if (updateRD && result.data) {
            console.log('\n📤 Actualizando RD Station...');
            const rdResult = await firmwareService.updateRDSingle(singleEmail);
            console.log(rdResult.success
                ? `✅ RD actualizado: ${JSON.stringify(rdResult.updatedFields)}`
                : `❌ RD falló: ${rdResult.error}`);
        }
        return;
    }

    // ── Modo prueba (primer email) ──
    if (!isAll) {
        const items = firmwareService.loadEmails(validator);
        const first = items[0];
        console.log(`🔍 MODO PRUEBA - Validador: ${validator}`);
        console.log(`Total emails en lista: ${items.length} (verdes: ${items.filter(i => i.source === 'verde').length}, rojos: ${items.filter(i => i.source === 'rojo').length})`);
        console.log(`Probando con: ${first.email} [${first.source}]\n`);

        const result = await firmwareService.fetchFirmwareInfo(first.email);
        if (result.data) {
            console.log('✅ Respuesta:');
            console.log(JSON.stringify(result.data, null, 2));
            console.log('\nPara procesar todos los emails, ejecuta:');
            console.log(`  node scripts/fetch-firmware-data.js --all --validator ${validator}`);
            if (!updateRD) {
                console.log('Para también actualizar RD Station:');
                console.log(`  node scripts/fetch-firmware-data.js --all --validator ${validator} --update-rd`);
            }
        } else {
            console.log(`❌ Error: ${result.error}`);
        }
        return;
    }

    // ── Modo completo ──
    const items = firmwareService.loadEmails(validator);
    const verdeCount = items.filter(i => i.source === 'verde').length;
    const rojoCount = items.filter(i => i.source === 'rojo').length;
    console.log(`🚀 Procesando ${items.length} emails para validador "${validator}" (verdes: ${verdeCount}, rojos: ${rojoCount})...\n`);

    const results = [];
    let success = 0;
    let fail = 0;

    for (let i = 0; i < items.length; i++) {
        const { email, source } = items[i];
        const result = await firmwareService.fetchFirmwareInfo(email);
        result.source = source;
        results.push(result);
        const tag = source === 'rojo' ? ' 🔴' : '';
        if (result.data) {
            success++;
            const v = result.data.firmwareVersion || '?';
            const r = result.data.robotId || '?';
            console.log(`[${i + 1}/${items.length}] ✅ ${result.email}${tag} | robot: ${r} | fw: ${v}`);
        } else {
            fail++;
            console.log(`[${i + 1}/${items.length}] ❌ ${result.email}${tag}: ${result.error}`);
        }
        if (i < items.length - 1) await sleep(100);
    }

    firmwareService.saveResults(validator, results);
    console.log(`\n--- Resumen ---`);
    console.log(`✅ Éxitos:  ${success}`);
    console.log(`❌ Fallos:  ${fail}`);
    console.log(`📁 Guardado en: data/${firmwareService.VALIDATOR_FILES[validator]}`);

    if (updateRD) {
        console.log('\n📤 Actualizando RD Station con cf_id_equipo y cf_version_firmware...\n');
        let rdOk = 0;
        let rdFail = 0;

        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            if (!r.data) { rdFail++; continue; }
            const rdResult = await firmwareService.updateRDSingle(r.email);
            if (rdResult.success) {
                rdOk++;
                console.log(`[${i + 1}/${results.length}] ✅ RD ${r.email}`);
            } else {
                rdFail++;
                console.log(`[${i + 1}/${results.length}] ❌ RD ${r.email}: ${rdResult.error}`);
            }
            if (i < results.length - 1) await sleep(100);
        }

        console.log(`\n--- RD Station ---`);
        console.log(`✅ Actualizados: ${rdOk}`);
        console.log(`❌ Fallos:      ${rdFail}`);
    }
}

main().catch(err => {
    console.error('Error fatal:', err.message);
    process.exit(1);
});

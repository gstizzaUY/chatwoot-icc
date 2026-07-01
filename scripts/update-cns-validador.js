/**
 * Script para actualizar campos en RD Station para usuarios validador CNS.
 *
 * Uso:
 *   node scripts/update-cns-validador.js                          # Solo prueba con el primer email
 *   node scripts/update-cns-validador.js --all                    # Procesa todos los emails
 *   node scripts/update-cns-validador.js --email fatrillo2@...    # Procesa un email específico
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '..', '.env') });

import rdStationClient from '../src/clients/rdstation.client.js';

const DATA_FILE = resolve(__dirname, '..', 'data', 'usuarios_validador_cns.json');

function loadEmails() {
    const raw = JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
    if (!Array.isArray(raw) || raw.length === 0 || !raw[0].email) {
        throw new Error('Formato inesperado en usuarios_validador_cns.json');
    }
    return raw[0].email;
}

async function updateContact(email, index, total) {
    const updateData = {
        cf_validador: 'CNS',
        cf_tiene_ichef: 'Sí'
    };

    try {
        await rdStationClient.updateContact(email, updateData);
        console.log(`[${index}/${total}] ✅ ${email}`);
        return { success: true, email };
    } catch (error) {
        const status = error.response?.status || '?';
        console.error(`[${index}/${total}] ❌ ${email} (HTTP ${status}): ${error.message}`);
        return { success: false, email, error: error.message };
    }
}

async function main() {
    const argv = process.argv;

    // Modo email específico: --email <email>
    const emailIdx = argv.indexOf('--email');
    if (emailIdx !== -1 && argv[emailIdx + 1]) {
        const targetEmail = argv[emailIdx + 1];
        console.log(`🎯 Procesando email específico: ${targetEmail}\n`);
        const result = await updateContact(targetEmail, 1, 1);
        console.log(result.success ? `✅ Actualizado.` : `❌ Falló: ${result.error}`);
        return;
    }

    const allEmails = loadEmails();
    const isTestMode = !argv.includes('--all');

    if (isTestMode) {
        console.log('🔍 MODO PRUEBA: solo se procesará el primer email.\n');
        const first = allEmails[0];
        console.log(`Probando con: ${first}`);
        console.log('Campos a actualizar: cf_validador="CNS", cf_tiene_ichef="Sí"\n');

        const result = await updateContact(first, 1, 1);

        console.log('\n--- Resultado de la prueba ---');
        if (result.success) {
            console.log(`✅ Éxito. El contacto ${first} fue actualizado.`);
            console.log('\nPara procesar todos los emails, ejecuta:');
            console.log('  node scripts/update-cns-validador.js --all');
        } else {
            console.log(`❌ Falló: ${result.error}`);
            console.log('\nRevisa las credenciales de RD Station en el .env.');
        }
        return;
    }

    // Modo completo: procesar todos
    console.log(`🚀 Procesando ${allEmails.length} emails...\n`);

    let successCount = 0;
    let failCount = 0;
    const failures = [];

    for (let i = 0; i < allEmails.length; i++) {
        const result = await updateContact(allEmails[i], i + 1, allEmails.length);
        if (result.success) {
            successCount++;
        } else {
            failCount++;
            failures.push(result);
        }
    }

    console.log('\n--- Resumen ---');
    console.log(`✅ Éxitos:  ${successCount}`);
    console.log(`❌ Fallos:  ${failCount}`);

    if (failures.length > 0) {
        console.log('\nFallos:');
        failures.forEach(f => console.log(`  - ${f.email}: ${f.error}`));
    }
}

main().catch(err => {
    console.error('Error fatal:', err.message);
    process.exit(1);
});

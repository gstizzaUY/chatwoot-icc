import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import rdStationClient from './src/clients/rdstation.client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
    try {
        console.log('--- Iniciando envío masivo de eventos de conversión ---');
        
        // 1. Leer el archivo JSON
        const jsonPath = path.join(__dirname, 'data', 'lista_validador_nube_verdes.json');
        const fileContent = fs.readFileSync(jsonPath, 'utf-8');
        const data = JSON.parse(fileContent);
        
        // 2. Extraer todos los emails
        const emails = data[0].lista_validador_nube;
        console.log(`Se encontraron ${emails.length} emails para procesar.`);
        
        const conversionIdentifier = 'lista-validador-nube';
        let successCount = 0;
        let errorCount = 0;
        
        for (let i = 0; i < emails.length; i++) {
            const email = emails[i];
            console.log(`[${i + 1}/${emails.length}] Enviando evento para ${email}...`);
            
            try {
                const result = await rdStationClient.sendConversionEvent(email, conversionIdentifier);
                console.log(`  ✅ OK (UUID: ${result.event_uuid})`);
                successCount++;
            } catch (error) {
                console.error(`  ❌ Error: ${error.message}`);
                errorCount++;
            }
            
            // Retardo de 1 segundo (1000ms) para respetar el Rate Limit (120 req/min)
            if (i < emails.length - 1) {
                await delay(1000);
            }
        }
        
        console.log('\n--- Resumen Final ---');
        console.log(`Total procesados: ${emails.length}`);
        console.log(`Exitosos: ${successCount}`);
        console.log(`Fallidos: ${errorCount}`);
        
    } catch (error) {
        console.error('❌ Ocurrió un error general:');
        console.error(error.message);
    }
}

run();

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import rdStationClient from './src/clients/rdstation.client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
    try {
        console.log('--- Iniciando envío masivo de eventos de conversión (CSV) ---');
        
        // 1. Leer el archivo CSV
        const csvPath = path.join(__dirname, 'data', 'lista_validador_nube_verdes.csv');
        const fileContent = fs.readFileSync(csvPath, 'utf-8');
        
        // 2. Extraer todos los emails (separar por saltos de línea y limpiar)
        const lines = fileContent.split(/\r?\n/);
        const emails = lines
            .map(line => line.trim())
            .filter(line => line.includes('@')); // Filtro básico para asegurarse de que es un email y omitir cabeceras o líneas vacías
            
        console.log(`Se encontraron ${emails.length} emails válidos para procesar.`);
        
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

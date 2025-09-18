import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Cargar variables de entorno
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '.env') });

console.log('🔍 VERIFICANDO CONFIGURACIÓN DE RD STATION\n');

const variables = [
    'RDSTATION_CLIENT_ID',
    'RDSTATION_CLIENT_SECRET', 
    'RDSTATION_REFRESH_TOKEN',
    'RDSTATION_URL'
];

let allPresent = true;

variables.forEach(varName => {
    const value = process.env[varName];
    const isPresent = !!value;
    
    if (!isPresent) {
        allPresent = false;
    }
    
    const statusIcon = isPresent ? '✅' : '❌';
    const maskedValue = isPresent 
        ? (value.length > 8 ? `${value.substring(0, 4)}...${value.substring(value.length - 4)}` : '[MASKED]')
        : 'NOT_SET';
        
    console.log(`${statusIcon} ${varName}: ${maskedValue}`);
});

console.log(`\n📊 RESULTADO: ${allPresent ? '✅ TODAS LAS VARIABLES CONFIGURADAS' : '❌ VARIABLES FALTANTES'}`);

if (!allPresent) {
    console.log('\n💡 ACCIÓN REQUERIDA:');
    console.log('1. Verificar que el archivo .env existe en la raíz del proyecto');
    console.log('2. Verificar que las variables están definidas en .env');
    console.log('3. Reiniciar el servidor después de modificar .env');
    console.log('\nEjemplo de .env:');
    console.log('RDSTATION_CLIENT_ID=tu_client_id_aqui');
    console.log('RDSTATION_CLIENT_SECRET=tu_client_secret_aqui');
    console.log('RDSTATION_REFRESH_TOKEN=tu_refresh_token_aqui');
    console.log('RDSTATION_URL=https://api.rd.services');
}

process.exit(allPresent ? 0 : 1);
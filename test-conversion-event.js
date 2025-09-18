import axios from 'axios';

async function testConversionEvent() {
    try {
        console.log('🧪 Iniciando test del endpoint de conversión...');
        
        const response = await axios.post('http://127.0.0.1:4000/api/rd-station/test-conversion-event', {}, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ Respuesta del servidor:');
        console.log('Status:', response.status);
        console.log('Data:', JSON.stringify(response.data, null, 2));
        
    } catch (error) {
        console.error('❌ Error en el test:');
        console.error('Status:', error.response?.status);
        console.error('Data:', error.response?.data);
        console.error('Message:', error.message);
    }
}

testConversionEvent();
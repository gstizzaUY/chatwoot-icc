import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// Test simple para verificar que el refresh token funcione
async function testTokenRefresh() {
    console.log('🔧 Test: Renovando token...');
    
    try {
        const requestBody = {
            client_id: process.env.RDSTATION_CLIENT_ID,
            client_secret: process.env.RDSTATION_CLIENT_SECRET,
            refresh_token: process.env.RDSTATION_REFRESH_TOKEN,
            grant_type: 'refresh_token'
        };

        console.log('📡 Enviando request a RD Station auth endpoint...');
        const response = await axios.post(
            'https://api.rd.services/auth/token',
            requestBody,
            {
                headers: {
                    'accept': 'application/json',
                    'content-type': 'application/json'
                },
                timeout: 15000
            }
        );

        console.log('✅ Token renovado exitosamente!');
        console.log('📊 Response:', {
            status: response.status,
            accessToken: response.data.access_token ? 'Presente ✅' : 'Ausente ❌',
            expiresIn: response.data.expires_in || 'No especificado'
        });

        // Ahora test del evento de conversión
        console.log('\n🎯 Test: Enviando evento de conversión...');
        
        const payload = {
            conversion_identifier: "demo-test",
            name: "Usuario de Prueba",
            email: "test@rdstation.com",
            personal_phone: "+59899123456",
            mobile_phone: "+59899123456",
            state: "Montevideo",
            city: "Montevideo",
            cf_fecha_demo: "2025-01-15",
            cf_horario_demo: "14:00",
            cf_source_url: "https://test.com/demo",
            available_for_mailing: true,
            traffic_source: "https://test.com/demo",
            legal_bases: [
                {
                    category: "communications",
                    type: "consent",
                    status: "granted"
                }
            ]
        };

        const conversionResponse = await axios.post(
            'https://api.rd.services/platform/events',
            {
                event_type: "CONVERSION",
                event_family: "CDP",
                payload: payload
            },
            {
                headers: {
                    'Authorization': `Bearer ${response.data.access_token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 15000
            }
        );

        console.log('🎉 Evento de conversión enviado exitosamente!');
        console.log('📊 Response:', {
            status: conversionResponse.status,
            data: conversionResponse.data
        });

    } catch (error) {
        console.error('❌ Error:', error.response?.data || error.message);
        console.error('📊 Status:', error.response?.status);
    }
}

testTokenRefresh();
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const crm = axios.create({
    baseURL: process.env.RDSTATION_CRM_URL || 'https://crm.rdstation.com/api/v1',
    params: { token: process.env.RDSTATION_USER_TOKEN },
    headers: { 'Content-Type': 'application/json' }
});

const dealId = '693079b43e97a0001759418b';
try {
    const res = await crm.get('/activities', { params: { deal_id: dealId, limit: 200 } });
    const acts = res.data.activities || [];
    console.log(`TOTAL actividades: ${acts.length}`);
    for (const a of acts) {
        console.log(`- ${a.date} | ${a.type || '-'} | ${(a.text || '').substring(0, 120)}`);
    }
} catch (e) {
    console.log('ERR:', e.response?.status, JSON.stringify(e.response?.data || e.message));
}
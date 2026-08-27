import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const baseURL = process.env.RDSTATION_URL || 'https://api.rd.services';

const tokenRes = await axios.post(`${baseURL}/auth/token`, {
    client_id: process.env.RDSTATION_CLIENT_ID,
    client_secret: process.env.RDSTATION_CLIENT_SECRET,
    refresh_token: process.env.RDSTATION_REFRESH_TOKEN
});
const token = tokenRes.data.access_token;

const uuid = '6d892f37-9fc3-4fba-bc5d-9ac4c07381e4';
for (const type of ['CONVERSION', 'OPPORTUNITY']) {
    try {
        const res = await axios.get(`${baseURL}/platform/contacts/${uuid}/events?event_type=${type}&order=created_at:desc&page=1`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const evts = res.data || [];
        console.log(`=== ${type}: ${evts.length} eventos ===`);
        for (const e of evts.slice(0, 8)) {
            console.log(`- ${e.event_timestamp} | ${e.event_type} | ${e.event_identifier}`);
        }
    } catch (e) {
        console.log(`${type} ERR:`, e.response?.status, JSON.stringify(e.response?.data || e.message));
    }
}
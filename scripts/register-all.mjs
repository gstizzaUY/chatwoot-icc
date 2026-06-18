/**
 * Batch register notebooks on local and production MCP servers.
 * Usage: node register-all.mjs
 */
import http from 'node:http';
import https from 'node:https';

const SERVERS = {
  local: { url: 'http://127.0.0.1:3000/mcp', mod: http },
  production: { url: 'https://inchat-notebooklm-mcp.5vsa59.easypanel.host/mcp', mod: https },
};

const NOTEBOOKS = [
  { id: 'ichef-preventa',  name: 'ichef-preventa',  url: 'https://notebooklm.google.com/notebook/9727e161-dbb1-4051-9a57-d88aab89be6f', desc: 'Conversaciones de pre-ventas - iChef' },
  { id: 'ichef-postventa', name: 'ichef-postventa', url: 'https://notebooklm.google.com/notebook/ea2deb2f-5d01-4bed-ad44-bca81128b1fe', desc: 'Conversaciones de post-venta y satisfacción del cliente - iChef' },
  { id: 'ichef-comercial', name: 'ichef-comercial', url: 'https://notebooklm.google.com/notebook/db03760c-9de6-42da-84cc-90ed9d40f78a', desc: 'Conversaciones de ventas y comercial - iChef' },
  { id: 'ichef-portal',    name: 'ichef-portal',    url: 'https://notebooklm.google.com/notebook/ecb46f8e-c1ea-4cf9-a7ad-6e1fef70a1c3', desc: 'Conversaciones del portal - iChef' },
];

async function send(server, body, sid) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url = new URL(server.url);
    const mod = server.mod;
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      rejectUnauthorized: false,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Content-Length': Buffer.byteLength(payload),
        ...(sid ? { 'mcp-session-id': sid } : {}),
      },
    };
    const req = mod.request(options, (res) => {
      const h = res.headers['mcp-session-id'];
      const newSid = h ? (Array.isArray(h) ? h[0] : h) : sid;
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ raw: Buffer.concat(chunks).toString('utf8'), sid: newSid }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function parseSSE(raw) {
  if (!raw) return null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('data: ')) {
      try { return JSON.parse(line.slice(6)); } catch { return null; }
    }
  }
  try { return JSON.parse(raw); } catch { return null; }
}

async function setupSession(server) {
  const r1 = await send(server, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: { tools: {}, resources: {} }, clientInfo: { name: 'batch-register', version: '1.0.0' } },
  });
  await send(server, { jsonrpc: '2.0', id: 2, method: 'notifications/initialized', params: {} }, r1.sid);
  return r1.sid;
}

async function call(server, sid, name, args) {
  const r = await send(server, { jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args || {} } }, sid);
  const p = parseSSE(r.raw);
  const t = p?.result?.content?.[0]?.text;
  if (t) { try { return JSON.parse(t); } catch { return t; } }
  return p;
}

async function main() {
  for (const [sname, server] of Object.entries(SERVERS)) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`📍 ${sname.toUpperCase()} - ${server.url}`);
    console.log('='.repeat(50));

    const sid = await setupSession(server);
    console.log(`✅ Session: ${sid}`);

    for (const nb of NOTEBOOKS) {
      console.log(`\n📓 ${nb.name}...`);
      const r1 = await call(server, sid, 'add_notebook', {
        url: nb.url, name: nb.name, description: nb.desc,
        topics: ['conversaciones', 'soporte', 'chatwoot', 'ichef', nb.id.replace('ichef-', '')],
        content_types: ['conversaciones', 'soporte al cliente'],
        use_cases: [`Analizar conversaciones de ${nb.name}`, 'Buscar información en conversaciones'],
      });
      if (r1?.success) {
        console.log(`   ✅ Registered`);
        const r2 = await call(server, sid, 'select_notebook', { id: nb.id });
        console.log(`   ✅ Selected as active: ${r2?.success}`);
      } else {
        console.log(`   ❌ Failed: ${JSON.stringify(r1?.error || r1)}`);
      }
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log('✅ ALL DONE');
  console.log('='.repeat(50));
}

main().catch(err => { console.error(`\n❌ ${err.message}`); process.exit(1); });

/**
 * Re-authenticate NotebookLM with a different Google account
 * Usage: node reauth.mjs
 */
import http from 'node:http';

const MCP_URL = 'http://127.0.0.1:3000/mcp';
let sessionId = null;
let requestId = 0;

function jsonRpc(method, params = {}) {
  return { jsonrpc: '2.0', id: ++requestId, method, params };
}

function sendRequest(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url = new URL(MCP_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    if (sessionId) options.headers['mcp-session-id'] = sessionId;

    const req = http.request(options, (res) => {
      const h = res.headers['mcp-session-id'];
      if (h) sessionId = Array.isArray(h) ? h[0] : h;

      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, raw });
      });
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

async function main() {
  console.log('🔄 Connecting to MCP server...');
  const initRes = await sendRequest(jsonRpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: { tools: {}, resources: {} },
    clientInfo: { name: 'reauth-client', version: '1.0.0' },
  }));
  const sessionHeader = initRes.headers['mcp-session-id'];
  if (sessionHeader) sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
  console.log(`✅ Session: ${sessionId}`);

  await sendRequest(jsonRpc('notifications/initialized'));

  console.log('\n🔄 Calling re_auth tool...');
  console.log('   A browser window will open for Google login.');
  console.log('   Log in with the new Google account there.\n');

  const result = await sendRequest(jsonRpc('tools/call', {
    name: 're_auth',
    arguments: { show_browser: true },
  }));

  const parsed = parseSSE(result.raw);
  const text = parsed?.result?.content?.[0]?.text;
  if (text) {
    console.log('📋 Response:', JSON.stringify(JSON.parse(text), null, 2));
  } else {
    console.log('📋 Raw response:', result.raw);
  }

  // Also check health to see new auth status
  console.log('\n🔄 Checking auth status...');
  await new Promise(r => setTimeout(r, 1000));
  const healthRes = await sendRequest(jsonRpc('tools/call', {
    name: 'get_health',
    arguments: {},
  }));
  const healthParsed = parseSSE(healthRes.raw);
  const healthText = healthParsed?.result?.content?.[0]?.text;
  if (healthText) {
    const health = JSON.parse(healthText);
    console.log(`   Authenticated: ${health.authenticated}`);
    console.log(`   Account: ${health.account || 'N/A'}`);
  }
}

main().catch(err => {
  console.error(`❌ Error: ${err.message}`);
  process.exit(1);
});

/**
 * Register and select a notebook in NotebookLM via MCP
 * Usage: node register-notebook.mjs <url> <name> [description]
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
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Content-Length': Buffer.byteLength(payload),
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
    }, (res) => {
      const h = res.headers['mcp-session-id'];
      if (h) sessionId = Array.isArray(h) ? h[0] : h;
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
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

async function call(name, args) {
  const raw = await sendRequest(jsonRpc('tools/call', { name, arguments: args }));
  const parsed = parseSSE(raw);
  if (parsed?.error) throw new Error(`MCP error: ${parsed.error.message}`);
  const text = parsed?.result?.content?.[0]?.text;
  if (text) {
    try { return JSON.parse(text); } catch { return text; }
  }
  return parsed;
}

const [url, name, ...descParts] = process.argv.slice(2);
const description = descParts.join(' ') || `Notebook para ${name}`;

if (!url || !name) {
  console.error('Usage: node register-notebook.mjs <url> <name> [description]');
  process.exit(1);
}

// Init session
const initRaw = await sendRequest(jsonRpc('initialize', {
  protocolVersion: '2025-03-26',
  capabilities: { tools: {}, resources: {} },
  clientInfo: { name: 'register', version: '1.0.0' },
}));
await sendRequest(jsonRpc('notifications/initialized'));
console.log(`✅ Session: ${sessionId}`);

// Register
console.log(`📓 Registering: ${name}`);
const result = await call('add_notebook', {
  url, name, description,
  topics: ['conversaciones', 'soporte', 'chatwoot', 'ichef', 'whatsapp'],
  content_types: ['conversaciones', 'soporte al cliente'],
  use_cases: ['Analizar conversaciones de clientes', 'Buscar información en conversaciones'],
});
console.log(`✅ ${JSON.stringify(result)}`);

// Select as active
const nbId = result?.data?.notebook?.id;
if (nbId) {
  console.log(`🎯 Selecting as active: ${nbId}`);
  const sel = await call('select_notebook', { id: nbId });
  console.log(`✅ ${JSON.stringify(sel)}`);
}

console.log('\n✅ Done');
process.exit(0);

/**
 * Check a remote MCP server and optionally register a notebook.
 * Usage: node mcp-remote.mjs <url> [command] [args]
 *   Commands: list | add-notebook <url> <name> [desc]
 */
import https from 'node:https';
import http from 'node:http';

const targetUrl = process.argv[2];
const cmd = process.argv[3] || 'list';
if (!targetUrl) { console.error('Usage: node mcp-remote.mjs <url> [command]'); process.exit(1); }

let sessionId = null;
let requestId = 0;

function jsonRpc(method, params = {}) {
  return { jsonrpc: '2.0', id: ++requestId, method, params };
}

function sendRequest(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url = new URL(targetUrl);
    const mod = url.protocol === 'https:' ? https : http;
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Content-Length': Buffer.byteLength(payload),
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      rejectUnauthorized: false,
    };
    const req = mod.request(options, (res) => {
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
  const p = parseSSE(raw);
  if (p?.error) throw new Error(`MCP error: ${p.error.message}`);
  const text = p?.result?.content?.[0]?.text;
  if (text) { try { return JSON.parse(text); } catch { return text; } }
  return p;
}

// Init
const initRaw = await sendRequest(jsonRpc('initialize', {
  protocolVersion: '2025-03-26',
  capabilities: { tools: {}, resources: {} },
  clientInfo: { name: 'remote-client', version: '1.0.0' },
}));
await sendRequest(jsonRpc('notifications/initialized'));
console.log(`✅ Connected to ${targetUrl}`);
console.log(`   Session: ${sessionId}`);

switch (cmd) {
  case 'list': {
    const result = await call('list_notebooks', {});
    console.log('\n📋 Notebooks:');
    if (result?.success && result?.data?.notebooks) {
      for (const nb of result.data.notebooks) {
        const active = nb.active ? ' ✅ ACTIVE' : '';
        console.log(`   ${nb.id.padEnd(22)} ${nb.name}${active}`);
      }
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
    break;
  }
  case 'add-notebook': {
    const nbUrl = process.argv[4];
    const name = process.argv[5];
    const desc = process.argv.slice(6).join(' ') || `Notebook para ${name}`;
    if (!nbUrl || !name) {
      console.error('Usage: node mcp-remote.mjs <url> add-notebook <notebook-url> <name> [desc]');
      process.exit(1);
    }
    console.log(`\n📓 Adding notebook: ${name}`);
    const result = await call('add_notebook', {
      url: nbUrl, name, description: desc,
      topics: ['conversaciones', 'soporte', 'chatwoot', 'ichef', 'whatsapp'],
    });
    console.log(JSON.stringify(result, null, 2));
    if (result?.success) {
      const id = result.data?.notebook?.id;
      if (id) {
        console.log(`\n🎯 Selecting as active: ${id}`);
        const sel = await call('select_notebook', { id });
        console.log(JSON.stringify(sel, null, 2));
      }
    }
    break;
  }
  default:
    console.log('Unknown command. Use: list | add-notebook');
}

console.log('\n✅ Done');
process.exit(0);

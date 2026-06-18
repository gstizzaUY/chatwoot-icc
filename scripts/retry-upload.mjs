/**
 * Retry upload - split into 2 large chunks.
 * Usage: node retry-upload.mjs
 */
import http from 'node:http';
import fs from 'node:fs';

const MCP_URL = 'http://127.0.0.1:3000/mcp';
const TXT_PATH = 'C:\\Users\\Acer\\OneDrive\\Documentos\\Programación\\chatwoot-icc-app\\backend\\exports\\consolidated_conversations.txt';

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
  const p = parseSSE(raw);
  if (p?.error) throw new Error(`MCP error: ${p.error.message}`);
  const text = p?.result?.content?.[0]?.text;
  if (text) { try { return JSON.parse(text); } catch { return text; } }
  return p;
}

async function main() {
  console.log('📖 Reading document...');
  const content = fs.readFileSync(TXT_PATH, 'utf-8');
  console.log(`   ${content.length.toLocaleString()} chars (${Math.round(content.length/1024)} KB)`);

  // Split into 2 roughly equal halves by line
  const lines = content.split('\n');
  const midPoint = Math.floor(lines.length / 2);

  // Find the next conversation separator to not break in the middle
  let splitAt = midPoint;
  for (let i = midPoint; i < lines.length; i++) {
    if (lines[i].startsWith('# Conversación #') || lines[i].startsWith('# Reporte')) {
      splitAt = i;
      break;
    }
  }

  const part1 = lines.slice(0, splitAt).join('\n');
  const part2 = '# Reporte de Conversaciones - iChef (Parte 2/2)\n' +
                lines.slice(splitAt).join('\n').split('\n').slice(1).join('\n');

  console.log(`   Part 1: ${Math.round(part1.length/1024)} KB`);
  console.log(`   Part 2: ${Math.round(part2.length/1024)} KB`);

  // Initialize MCP session
  console.log('\n🔄 Connecting to MCP...');
  const initRaw = await sendRequest(jsonRpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: { tools: {}, resources: {} },
    clientInfo: { name: 'retry-upload', version: '1.0.0' },
  }));
  await sendRequest(jsonRpc('notifications/initialized'));
  console.log(`✅ Session: ${sessionId}`);

  // First, remove old sources (the 10 chunks from before)
  // We can't remove sources via MCP, so we skip this step

  // Upload part 1
  console.log(`\n📤 Uploading Part 1/2 (${Math.round(part1.length/1024)} KB)...`);
  const r1 = await call('add_source', {
    type: 'text',
    content: part1,
    title: 'Conversaciones iChef - Neiff Cardozo (Parte 1/2)',
  });
  console.log(`   ${r1?.success ? '✅' : '❌'} ${JSON.stringify(r1?.message || r1)}`);

  if (r1?.success) {
    // Upload part 2
    console.log(`\n📤 Uploading Part 2/2 (${Math.round(part2.length/1024)} KB)...`);
    const r2 = await call('add_source', {
      type: 'text',
      content: part2,
      title: 'Conversaciones iChef - Neiff Cardozo (Parte 2/2)',
    });
    console.log(`   ${r2?.success ? '✅' : '❌'} ${JSON.stringify(r2?.message || r2)}`);
  }

  console.log('\n✅ Done. Check NotebookLM manually to verify.');
}

main().catch(err => { console.error(`\n❌ ${err.message}`); process.exit(1); });

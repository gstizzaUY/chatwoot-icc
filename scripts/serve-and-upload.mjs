/**
 * Serve consolidated file via HTTP and upload to NotebookLM via URL source.
 * Usage: node serve-and-upload.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MCP_URL = 'http://127.0.0.1:3000/mcp';
const TXT_PATH = 'C:\\Users\\Acer\\OneDrive\\Documentos\\Programación\\chatwoot-icc-app\\backend\\exports\\consolidated_conversations.txt';
const PORT = 0; // random port

let sessionId = null;
let requestId = 0;
let server = null;

function jsonRpc(method, params = {}) {
  return { jsonrpc: '2.0', id: ++requestId, method, params };
}

function sendRequest(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url = new URL(MCP_URL);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
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

// Start HTTP server
function startServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      });
      fs.createReadStream(TXT_PATH).pipe(res);
    });
    server.listen(PORT, '127.0.0.1', () => {
      const addr = server.address();
      resolve(`http://127.0.0.1:${addr.port}/conversaciones.txt`);
    });
    server.on('error', reject);
  });
}

async function main() {
  const fileSize = fs.statSync(TXT_PATH).size;
  console.log(`📖 Document: ${path.basename(TXT_PATH)} (${Math.round(fileSize/1024)} KB)`);

  // Start HTTP server
  console.log('\n🌐 Starting local HTTP server...');
  const url = await startServer();
  console.log(`   Serving at: ${url}`);

  // Initialize MCP session
  console.log('\n🔄 Connecting to MCP server...');
  const initRaw = await sendRequest(jsonRpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: { tools: {}, resources: {} },
    clientInfo: { name: 'url-uploader', version: '1.0.0' },
  }));
  await sendRequest(jsonRpc('notifications/initialized'));
  console.log(`✅ Session: ${sessionId}`);

  // Upload via URL source
  console.log(`\n📤 Adding URL source: ${url}`);
  const result = await call('add_source', {
    type: 'url',
    content: url,
    title: 'Conversaciones iChef - Manual Wpp y Experiencias - Neiff Cardozo',
  });
  console.log(`\n📋 Result:`, JSON.stringify(result, null, 2));

  if (result?.success) {
    console.log('\n✅ Source added! NotebookLM will crawl and index the document.');
  } else {
    const msg = typeof result?.message === 'string' ? result.message : JSON.stringify(result);
    console.log(`\n❌ ${msg}`);
  }

  // Cleanup
  server.close();
  console.log('\n✅ HTTP server stopped.');
}

main().catch(err => {
  console.error(`\n❌ ${err.message}`);
  if (server) server.close();
  process.exit(1);
});

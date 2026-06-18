/**
 * Upload exported Chatwoot conversations to NotebookLM via MCP
 *
 * Usage:
 *   node upload-to-notebooklm.mjs                    # Interactive mode
 *   node upload-to-notebooklm.mjs list               # List notebooks
 *   node upload-to-notebooklm.mjs select <id>        # Select notebook
 *   node upload-to-notebooklm.mjs upload <xlsx-path> # Upload a single XLSX
 *   node upload-to-notebooklm.mjs upload-all         # Upload all XLSX in exports/
 *   node upload-to-notebooklm.mjs upload-all <nb-id> # Upload all to specific notebook
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

const MCP_URL = 'http://127.0.0.1:3000/mcp';
const EXPORTS_DIR = path.resolve(new URL('.', import.meta.url).pathname, '..', 'exports');

let sessionId = null;
let requestId = 0;

// ─── MCP Client (Streamable HTTP) ───────────────────────────────────────────

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

function parseSSEResponse(raw) {
  // SSE format: "event: message\ndata: {...}\n\n"
  if (!raw) return null;
  const lines = raw.split('\n');
  let dataLine = '';
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      dataLine = line.slice(6);
      break;
    }
  }
  if (!dataLine) {
    try { return JSON.parse(raw); } catch { return null; }
  }
  try { return JSON.parse(dataLine); } catch { return null; }
}

async function mcpCall(method, params = {}) {
  const res = await sendRequest(jsonRpc(method, params));
  const parsed = parseSSEResponse(res.raw);
  if (!parsed) throw new Error(`MCP error: ${res.raw}`);
  if (parsed.error) throw new Error(`MCP error (${parsed.error.code}): ${parsed.error.message}`);
  return parsed;
}

async function initSession() {
  console.log('🔄 Connecting to NotebookLM MCP server...');
  await mcpCall('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: { tools: {}, resources: {} },
    clientInfo: { name: 'chatwoot-uploader', version: '1.0.0' },
  });
  await sendRequest(jsonRpc('notifications/initialized'));
  console.log(`✅ Session: ${sessionId}`);
}

function extractToolResult(mcpResponse) {
  const text = mcpResponse?.result?.content?.[0]?.text;
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function listNotebooks() {
  const res = await mcpCall('tools/call', { name: 'list_notebooks', arguments: {} });
  return extractToolResult(res);
}

async function selectNotebook(id) {
  const res = await mcpCall('tools/call', { name: 'select_notebook', arguments: { id } });
  return extractToolResult(res);
}

async function addSource(type, content, title) {
  const args = { type, content };
  if (title) args.title = title;
  const res = await mcpCall('tools/call', { name: 'add_source', arguments: args });
  return extractToolResult(res);
}

// ─── XLSX Reader ────────────────────────────────────────────────────────────

async function readConversationsFromXLSX(filePath) {
  console.log(`📖 Reading: ${path.basename(filePath)}`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const messagesSheet = workbook.getWorksheet('Mensajes');
  const conversationsSheet = workbook.getWorksheet('Conversaciones');

  if (!messagesSheet || !conversationsSheet) {
    throw new Error('XLSX must have "Conversaciones" and "Mensajes" sheets');
  }

  // Build conversation metadata map
  const convMeta = new Map();
  conversationsSheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return; // skip header
    const cid = String(row.getCell(1).value || '');
    convMeta.set(cid, {
      status: row.getCell(2).value || '',
      createdAt: row.getCell(3).value || '',
      contactName: row.getCell(10).value || '',
      contactEmail: row.getCell(11).value || '',
      contactPhone: row.getCell(12).value || '',
    });
  });

  // Group messages by conversation
  const conversations = new Map();

  messagesSheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const cid = String(row.getCell(1).value || '');
    const msg = {
      timestamp: row.getCell(3).value || '',
      sender: row.getCell(6).value || '',
      role: row.getCell(7).value || '',
      content: row.getCell(9).value || '',
      type: row.getCell(4).value || '',
    };
    if (!conversations.has(cid)) conversations.set(cid, []);
    conversations.get(cid).push(msg);
  });

  console.log(`   ${conversations.size} conversations, ${[...conversations.values()].reduce((a, m) => a + m.length, 0)} messages`);
  return { meta: convMeta, conversations };
}

function formatConversation(cid, messages, meta) {
  const m = meta || {};
  const lines = [];
  lines.push(`# Conversación #${cid}`);
  if (m.contactName) lines.push(`**Contacto:** ${m.contactName}`);
  if (m.contactEmail) lines.push(`**Email:** ${m.contactEmail}`);
  if (m.contactPhone) lines.push(`**Teléfono:** ${m.contactPhone}`);
  if (m.createdAt) lines.push(`**Fecha:** ${m.createdAt}`);
  if (m.status) lines.push(`**Estado:** ${m.status}`);
  lines.push('');

  if (messages.length === 0) {
    lines.push('*(Sin mensajes)*');
  } else {
    for (const msg of messages) {
      const sender = msg.sender || 'Desconocido';
      const ts = msg.timestamp ? `[${msg.timestamp}]` : '';
      if (msg.content) {
        lines.push(`${ts} **${sender}:** ${msg.content}`);
      }
    }
  }

  return lines.join('\n');
}

// ─── CLI ────────────────────────────────────────────────────────────────────

async function cmdList() {
  const result = await listNotebooks();
  if (result?.success && result?.data?.notebooks) {
    for (const nb of result.data.notebooks) {
      const active = nb.active ? ' ✅ ACTIVE' : '';
      console.log(`  ${nb.id.padEnd(18)} ${nb.name}${active}`);
    }
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

async function cmdSelect(id) {
  const result = await selectNotebook(id);
  console.log(JSON.stringify(result, null, 2));
}

async function cmdUpload(filePath, notebookId) {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exit(1);
  }

  if (notebookId) {
    console.log(`📓 Selecting notebook: ${notebookId}`);
    await selectNotebook(notebookId);
  }

  const { meta, conversations } = await readConversationsFromXLSX(filePath);
  let success = 0;
  let failed = 0;

  for (const [cid, messages] of conversations) {
    const convMeta = meta.get(cid);
    const text = formatConversation(cid, messages, convMeta);
    const title = `Conversación #${cid}${convMeta?.contactName ? ` - ${convMeta.contactName}` : ''}`;
    const preview = text.length > 120 ? text.slice(0, 120) + '...' : text;

    console.log(`\n📤 Uploading: ${title}`);
    console.log(`   Preview: ${preview.replace(/\n/g, ' ')}`);
    console.log(`   Length: ${text.length} chars`);

    try {
      const result = await addSource('text', text, title);
      if (result?.success) {
        console.log(`   ✅ Uploaded successfully`);
        success++;
      } else {
        console.log(`   ❌ Failed: ${JSON.stringify(result)}`);
        failed++;
      }
    } catch (err) {
      console.log(`   ❌ Error: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n📊 Summary: ${success} uploaded, ${failed} failed`);
}

async function cmdUploadAll(notebookId) {
  if (!fs.existsSync(EXPORTS_DIR)) {
    console.error(`❌ Exports directory not found: ${EXPORTS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(EXPORTS_DIR)
    .filter(f => f.endsWith('.xlsx') && f.startsWith('conversaciones_'))
    .sort()
    .map(f => path.join(EXPORTS_DIR, f));

  if (files.length === 0) {
    console.log('No conversation XLSX files found in exports/');
    return;
  }

  console.log(`Found ${files.length} conversation files to upload:\n`);
  for (const f of files) {
    console.log(`  ${path.basename(f)}`);
  }
  console.log('');

  for (const f of files) {
    await cmdUpload(f, notebookId);
    // Don't re-select for subsequent files
    notebookId = null;
  }

  console.log('\n✅ All files processed!');
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'help';

  await initSession();

  switch (cmd) {
    case 'list':
      await cmdList();
      break;

    case 'select':
      if (!args[1]) { console.error('Usage: node upload-to-notebooklm.mjs select <id>'); process.exit(1); }
      await cmdSelect(args[1]);
      break;

    case 'upload':
      if (!args[1]) { console.error('Usage: node upload-to-notebooklm.mjs upload <xlsx-path> [notebook-id]'); process.exit(1); }
      await cmdUpload(args[1], args[2]);
      break;

    case 'upload-all':
      await cmdUploadAll(args[1]);
      break;

    default:
      console.log(`
NotebookLM Uploader - Sube conversaciones exportadas a NotebookLM

Commands:
  node upload-to-notebooklm.mjs list                  List available notebooks
  node upload-to-notebooklm.mjs select <id>           Select active notebook
  node upload-to-notebooklm.mjs upload <xlsx> [nb-id] Upload a single XLSX
  node upload-to-notebooklm.mjs upload-all [nb-id]    Upload all XLSX files
`);
  }
}

main().catch(err => {
  console.error(`\n❌ Fatal: ${err.message}`);
  process.exit(1);
});

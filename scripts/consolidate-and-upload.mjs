/**
 * Consolidate conversations from XLSX and upload in chunks to NotebookLM.
 *
 * Usage: node consolidate-and-upload.mjs <xlsx-path> [title]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

const MCP_URL = 'http://127.0.0.1:3000/mcp';
const CHUNK_SIZE = 80000; // ~80 KB per chunk (textarea.fill limit)

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

async function mcpCall(method, params = {}) {
  const raw = await sendRequest(jsonRpc(method, params));
  const parsed = parseSSE(raw);
  if (parsed?.error) throw new Error(`MCP error: ${parsed.error.message}`);
  return parsed;
}

async function addSource(type, content, title) {
  const res = await mcpCall('tools/call', {
    name: 'add_source',
    arguments: { type, content, title: title || undefined },
  });
  const text = res?.result?.content?.[0]?.text;
  if (text) { try { return JSON.parse(text); } catch { return text; } }
  return res;
}

function formatConversation(cid, messages, meta) {
  const lines = [];
  lines.push(`# Conversación #${cid}`);
  if (meta?.contactName) lines.push(`Contacto: ${meta.contactName}`);
  if (meta?.contactEmail) lines.push(`Email: ${meta.contactEmail}`);
  if (meta?.contactPhone) lines.push(`Teléfono: ${meta.contactPhone}`);
  if (meta?.createdAt) lines.push(`Fecha: ${meta.createdAt}`);
  if (meta?.status) lines.push(`Estado: ${meta.status}`);
  if (meta?.labels) lines.push(`Etiquetas: ${meta.labels}`);
  lines.push('');
  for (const msg of messages) {
    const sender = msg.sender || 'Desconocido';
    const ts = msg.timestamp ? `[${msg.timestamp}]` : '';
    if (msg.content) {
      lines.push(`${ts} ${sender}: ${msg.content}`);
    }
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  return lines.join('\n');
}

async function readXLSX(filePath) {
  console.log(`📖 Reading: ${path.basename(filePath)}`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const messagesSheet = workbook.getWorksheet('Mensajes');
  const conversationsSheet = workbook.getWorksheet('Conversaciones');
  if (!messagesSheet || !conversationsSheet) {
    throw new Error('XLSX must have "Conversaciones" and "Mensajes" sheets');
  }
  const convMeta = new Map();
  conversationsSheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    convMeta.set(String(row.getCell(1).value || ''), {
      status: row.getCell(2).value || '',
      createdAt: row.getCell(3).value || '',
      contactName: row.getCell(10).value || '',
      contactEmail: row.getCell(11).value || '',
      contactPhone: row.getCell(12).value || '',
    });
  });
  const conversations = new Map();
  messagesSheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const cid = String(row.getCell(1).value || '');
    const content = row.getCell(9).value || '';
    if (!content) return;
    const msg = {
      timestamp: row.getCell(3).value || '',
      sender: row.getCell(6).value || '',
      role: row.getCell(7).value || '',
      content,
      type: row.getCell(4).value || '',
    };
    if (!conversations.has(cid)) conversations.set(cid, []);
    conversations.get(cid).push(msg);
  });
  console.log(`   ${conversations.size} conversations, ${[...conversations.values()].reduce((a, m) => a + m.length, 0)} messages`);
  return { meta: convMeta, conversations };
}

async function main() {
  const args = process.argv.slice(2);
  const filePath = args[0];
  const baseTitle = args[1] || 'Conversaciones - Manual Wpp + Experiencias - Neiff Cardozo';

  if (!filePath || !fs.existsSync(filePath)) {
    console.error('Usage: node consolidate-and-upload.mjs <xlsx-path> [title]');
    process.exit(1);
  }

  const { meta, conversations } = await readXLSX(filePath);
  const convEntries = [...conversations.entries()];

  // Build chunks
  console.log('\n📝 Building chunks...');
  const chunks = [];
  let currentChunk = [];
  let currentSize = 0;
  let convCount = 0;

  // Header for each chunk
  function makeHeader(start, end, total) {
    return [
      `# Reporte de Conversaciones - iChef (Parte ${start}-${end} de ${total})`,
      `Canales: Manual Wpp, Experiencias iChef Wpp | Agente: Neiff Cardozo`,
      `Exportado: ${new Date().toLocaleString('es-UY')}`,
      ``,
      `---`,
      ``,
    ].join('\n');
  }

  let chunkIndex = 1;
  let partStart = 1;

  for (const [cid, messages] of convEntries) {
    const convMeta = meta.get(cid);
    const text = formatConversation(cid, messages, convMeta);
    const textSize = Buffer.byteLength(text, 'utf-8');

    if (currentSize + textSize > CHUNK_SIZE && currentChunk.length > 0) {
      // Save current chunk
      const header = makeHeader(partStart, convCount, convEntries.length);
      chunks.push({ index: chunkIndex, conversations: currentChunk, header });
      chunkIndex++;
      currentChunk = [];
      currentSize = 0;
      partStart = convCount + 1;
    }

    currentChunk.push({ cid, text });
    currentSize += textSize;
    convCount++;

    if (convCount % 100 === 0) {
      process.stdout.write(`\r   Processed ${convCount}/${convEntries.length} conversations (${chunks.length} chunks so far)...`);
    }
  }

  // Last chunk
  if (currentChunk.length > 0) {
    const header = makeHeader(partStart, convCount, convEntries.length);
    chunks.push({ index: chunkIndex, conversations: currentChunk, header });
  }

  console.log(`\n\n📊 ${convCount} conversations split into ${chunks.length} chunks:`);
  for (const c of chunks) {
    const totalChars = c.conversations.reduce((a, x) => a + x.text.length, 0);
    console.log(`   Chunk ${c.index}/${chunks.length}: ${c.conversations.length} conversations, ${Math.round(totalChars/1024)} KB`);
  }

  // Initialize MCP session
  console.log('\n🔄 Connecting to MCP server...');
  const initRaw = await sendRequest(jsonRpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: { tools: {}, resources: {} },
    clientInfo: { name: 'chunk-uploader', version: '1.0.0' },
  }));
  await sendRequest(jsonRpc('notifications/initialized'));
  console.log(`✅ Session: ${sessionId}`);

  // Upload each chunk
  let successCount = 0;
  let failCount = 0;

  for (const chunk of chunks) {
    const title = `${baseTitle} (Parte ${chunk.index}/${chunks.length})`;
    const content = chunk.header + chunk.conversations.map(c => c.text).join('\n');
    const sizeKB = Math.round(content.length / 1024);

    console.log(`\n📤 Uploading chunk ${chunk.index}/${chunks.length}: "${title}" (${sizeKB} KB, ${chunk.conversations.length} conversations)...`);

    try {
      const result = await addSource('text', content, title);
      if (result?.success) {
        console.log(`   ✅ Uploaded`);
        successCount++;
      } else {
        console.log(`   ❌ Failed: ${JSON.stringify(result?.message || result)}`);
        failCount++;
      }
    } catch (err) {
      console.log(`   ❌ Error: ${err.message}`);
      failCount++;
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`📊 SUMMARY:`);
  console.log(`   Total conversations: ${convCount}`);
  console.log(`   Chunks: ${chunks.length}`);
  console.log(`   Uploaded: ✅ ${successCount}`);
  console.log(`   Failed:  ❌ ${failCount}`);
  console.log(`${'='.repeat(50)}`);

  if (failCount === 0) {
    console.log('\n🎉 All sources uploaded successfully! You can now query NotebookLM.');
  }
}

main().catch(err => {
  console.error(`\n❌ Fatal: ${err.message}`);
  process.exit(1);
});

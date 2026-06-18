/**
 * MCP Streamable HTTP Client for notebooklm-mcp
 * Communicates with the server at http://127.0.0.1:3000/mcp
 */
import http from 'node:http';

const MCP_URL = 'http://127.0.0.1:3000/mcp';
let sessionId = null;
let requestId = 0;

function jsonRpcRequest(method, params = {}) {
  return {
    jsonrpc: '2.0',
    id: ++requestId,
    method,
    params,
  };
}

async function sendRequest(body) {
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

    if (sessionId) {
      options.headers['mcp-session-id'] = sessionId;
    }

    const req = http.request(options, (res) => {
      const sessionHeader = res.headers['mcp-session-id'];
      if (sessionHeader && Array.isArray(sessionHeader)) {
        sessionId = sessionHeader[0];
      } else if (sessionHeader) {
        sessionId = sessionHeader;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          const data = JSON.parse(raw);
          resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
        } catch {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: raw });
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function initialize() {
  console.log('🔄 Initializing MCP session...');
  console.log('  Request: initialize');
  const result = await sendRequest(jsonRpcRequest('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {
      tools: {},
      resources: {},
    },
    clientInfo: {
      name: 'chatwoot-uploader',
      version: '1.0.0',
    },
  }));
  console.log(`  Response status: ${result.statusCode}`);
  console.log(`  Response headers:`, JSON.stringify(result.headers));
  console.log(`  Response body:`, JSON.stringify(result.body, null, 2));
  console.log(`  Session ID: ${sessionId}`);

  if (sessionId) {
    // Send initialized notification
    console.log('\n🔄 Sending initialized notification...');
    const notifResult = await sendRequest(jsonRpcRequest('notifications/initialized'));
    console.log(`  Notification response status: ${notifResult.statusCode}`);
    console.log(`  Notification headers:`, JSON.stringify(notifResult.headers));
  } else {
    console.log('\n⚠️  No session ID received, notification skipped');
  }

  return result;
}

async function callTool(name, args = {}) {
  console.log(`🔧 Calling tool: ${name}`);
  const result = await sendRequest(jsonRpcRequest('tools/call', {
    name,
    arguments: args,
  }));
  return result;
}

async function listNotebooks() {
  const result = await callTool('list_notebooks');
  const content = result.body?.result?.content?.[0]?.text;
  if (content) {
    try {
      const parsed = JSON.parse(content);
      return parsed;
    } catch {
      return content;
    }
  }
  return result;
}

async function addSource(type, content, title) {
  const result = await callTool('add_source', {
    type,
    content,
    title: title || undefined,
  });
  const text = result.body?.result?.content?.[0]?.text;
  if (text) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return result;
}

async function selectNotebook(id) {
  const result = await callTool('select_notebook', { id });
  const text = result.body?.result?.content?.[0]?.text;
  if (text) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return result;
}

async function main() {
  try {
    await initialize();
    if (!sessionId) {
      console.error('❌ Failed to establish MCP session');
      process.exit(1);
    }

    console.log('\n📋 Listing notebooks...');
    const notebooksResult = await listNotebooks();
    console.log(`  Status: ${notebooksResult.statusCode}`);
    const notebooks = notebooksResult.body?.result?.content?.[0]?.text;
    if (notebooks) {
      console.log('  Notebooks:', notebooks);
    } else {
      console.log('  Full response:', JSON.stringify(notebooksResult.body, null, 2));
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// CLI mode
const args = process.argv.slice(2);
async function cli() {
  await initialize();
  if (!sessionId) {
    console.error('❌ Failed to establish MCP session');
    process.exit(1);
  }

  const cmd = args[0];
  switch (cmd) {
    case 'list': {
      const result = await listNotebooks();
      const text = result.body?.result?.content?.[0]?.text || JSON.stringify(result.body);
      console.log(text);
      break;
    }
    case 'select': {
      const id = args[1];
      if (!id) { console.error('Usage: node mcp-client.mjs select <notebook-id>'); process.exit(1); }
      const result = await selectNotebook(id);
      console.log(JSON.stringify(result.body, null, 2));
      break;
    }
    case 'add-source': {
      const type = args[1];
      const content = args[2];
      const title = args[3];
      if (!type || !content) {
        console.error('Usage: node mcp-client.mjs add-source <url|text> <content> [title]');
        process.exit(1);
      }
      const result = await addSource(type, content, title);
      console.log(JSON.stringify(result.body, null, 2));
      break;
    }
    default: {
      const result = await listNotebooks();
      const text = result.body?.result?.content?.[0]?.text || JSON.stringify(result.body);
      console.log(text);
    }
  }
}

if (args.length > 0) {
  cli().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
} else {
  main().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
}

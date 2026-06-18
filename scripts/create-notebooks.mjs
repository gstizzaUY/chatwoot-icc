/**
 * Create notebooks in NotebookLM via browser automation (Patchright)
 * Uses the same authenticated Chrome profile as the MCP server.
 *
 * Usage: node create-notebooks.mjs
 */
import { chromium } from 'patchright';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const CHROME_PROFILE = 'C:\\Users\\Acer\\AppData\\Local\\notebooklm-mcp\\Data\\chrome_profile';
const MCP_URL = 'http://127.0.0.1:3000/mcp';

const CHANNELS = [
  { id: 'ichef-center-wpp',  name: 'iChef Center Wpp',     inboxId: 34 },
  { id: 'ichef-marty-wpp',   name: 'iChef Marty Wpp',      inboxId: 23 },
  { id: 'ichef-comercial-wpp', name: 'iChef Comercial Wpp',  inboxId: 48 },
  { id: 'experiencias-wpp',  name: 'Experiencias iChef Wpp', inboxId: 38 },
  { id: 'ichef-mkt-wpp',     name: 'iChef MKT Wpp',         inboxId: 46 },
  { id: 'ichef-sistemas-wpp', name: 'iChef Sistemas Wpp',   inboxId: 47 },
  { id: 'manual-wpp',        name: 'Manual Wpp',            inboxId: 14 },
  { id: 'correo-marty',      name: 'Correo Marty',          inboxId: 1 },
  { id: 'correo-comercial',  name: 'Correo Comercial',      inboxId: 12 },
  { id: 'correo-marty-mkt',  name: 'Correo Marty MKT-RD',   inboxId: 33 },
  { id: 'preventa-sdr',      name: 'Pre-Venta SDR',         inboxId: 20 },
  { id: 'actualizaciones-fw', name: 'Actualizaciones Firmware', inboxId: 41 },
  { id: 'manual-telefono',   name: 'Manual Teléfono',       inboxId: 13 },
  { id: 'manual-presencial', name: 'Manual Presencial',     inboxId: 15 },
];

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
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw);
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

async function mcpCall(method, params = {}) {
  const raw = await sendRequest(jsonRpc(method, params));
  const parsed = parseSSE(raw);
  if (parsed?.error) throw new Error(`MCP error: ${parsed.error.message}`);
  return parsed;
}

async function registerNotebook(url, name, description, topics) {
  await mcpCall('tools/call', {
    name: 'add_notebook',
    arguments: { url, name, description, topics },
  });
}

async function getCurrentUrl(page) {
  return page.url();
}

async function main() {
  console.log('🚀 Starting notebook creation...\n');

  // 1. Initialize MCP session
  console.log('🔄 Connecting to MCP server...');
  const initRaw = await sendRequest(jsonRpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: { tools: {}, resources: {} },
    clientInfo: { name: 'notebook-creator', version: '1.0.0' },
  }));
  const initParsed = parseSSE(initRaw);
  if (!sessionId) {
    const lines = initRaw.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const d = JSON.parse(line.slice(6));
          // Session ID should be in headers already
        } catch {}
      }
    }
  }
  console.log(`✅ MCP Session: ${sessionId}`);
  await sendRequest(jsonRpc('notifications/initialized'));

  // 2. List existing notebooks
  console.log('\n📋 Checking existing notebooks...');
  const listRaw = await sendRequest(jsonRpc('tools/call', { name: 'list_notebooks', arguments: {} }));
  const listParsed = parseSSE(listRaw);
  const listText = listParsed?.result?.content?.[0]?.text;
  let existingNotebooks = [];
  if (listText) {
    try {
      const data = JSON.parse(listText);
      existingNotebooks = data?.data?.notebooks?.map(n => n.name) || [];
      console.log(`   Found ${existingNotebooks.length} existing notebooks`);
    } catch {}
  }

  // 3. Launch browser
  console.log('\n🌐 Launching browser...');
  const browser = await chromium.launchPersistentContext(CHROME_PROFILE, {
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const pages = browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();

  // 4. Navigate to NotebookLM
  console.log('📱 Navigating to NotebookLM...');
  await page.goto('https://notebooklm.google.com', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  // Check if we need to handle the initial dialog
  try {
    const gotItBtn = page.locator('button:has-text("Got it"), button:has-text("Entendido"), button:has-text("OK")').first();
    if (await gotItBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await gotItBtn.click();
      await page.waitForTimeout(1000);
    }
  } catch {}

  // 5. Create notebooks for channels that don't exist yet
  const created = [];
  const skipped = [];

  for (const channel of CHANNELS) {
    if (existingNotebooks.includes(channel.name)) {
      console.log(`⏭️  Already exists: ${channel.name}`);
      skipped.push(channel.name);
      continue;
    }

    console.log(`\n📓 Creating notebook: ${channel.name}...`);

    try {
      // Click "New Notebook" button
      const newBtn = page.locator('button:has-text("New notebook"), button:has-text("Nuevo notebook"), a:has-text("New notebook"), [href*="new"]').first();
      
      if (await newBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await newBtn.click();
      } else {
        // Try the plus/add icon button
        const addBtn = page.locator('button:has(mat-icon:text-is("add")), button[aria-label*="new" i], button[aria-label*="nuevo" i]').first();
        if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await addBtn.click();
        } else {
          // Try keyboard shortcut or URL approach
          await page.goto('https://notebooklm.google.com/new', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
        }
      }

      await page.waitForTimeout(3000);

      // Check current URL to see if we landed on a notebook
      let currentUrl = page.url();
      console.log(`   URL: ${currentUrl}`);

      if (currentUrl.includes('/notebook/')) {
        // Get the URL and register it
        const notebookUrl = currentUrl.split('?')[0];

        // Rename the notebook if there's a title field
        try {
          const titleInput = page.locator('[contenteditable="true"], input[placeholder*="title" i], input[placeholder*="nombre" i], input[placeholder*="name" i]').first();
          if (await titleInput.isVisible({ timeout: 2000 }).catch(() => false)) {
            await titleInput.click();
            await titleInput.fill('');
            await titleInput.type(channel.name, { delay: 50 });
            await page.keyboard.press('Enter');
            await page.waitForTimeout(1000);
          }
        } catch {}

        // Register in MCP library
        await registerNotebook(notebookUrl, channel.name,
          `Conversaciones de ${channel.name} en Chatwoot`,
          ['chatwoot', 'conversaciones', 'soporte', 'atencion al cliente', channel.name.toLowerCase()]
        );
        console.log(`   ✅ Registered: ${notebookUrl}`);
        created.push(channel.name);
      } else {
        console.log(`   ⚠️  Could not create notebook for ${channel.name}`);
      }

      // Navigate back to main page for next notebook
      await page.goto('https://notebooklm.google.com', { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);

    } catch (err) {
      console.log(`   ❌ Error: ${err.message}`);
      // Try to recover
      await page.goto('https://notebooklm.google.com', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);
    }
  }

  // 6. Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 SUMMARY');
  console.log('='.repeat(50));
  console.log(`✅ Created: ${created.length}`);
  console.log(`⏭️  Skipped (already exist): ${skipped.length}`);
  if (created.length > 0) {
    console.log('\n📓 Created notebooks:');
    created.forEach(n => console.log(`   - ${n}`));
  }

  // Don't close the browser - it's used by the server
  console.log('\n✅ Done! Browser window can be closed manually.');

  // Keep the process alive a bit so user can see the browser
  await new Promise(r => setTimeout(r, 5000));
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Fatal:', err.message);
  process.exit(1);
});

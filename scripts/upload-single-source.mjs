/**
 * Upload a consolidated text document as a single source to NotebookLM
 * using Patchright directly (bypasses MCP tool's slow textarea.fill).
 *
 * Usage: node upload-single-source.mjs <txt-path> [title]
 */
import { chromium } from 'patchright';
import fs from 'node:fs';

const CHROME_PROFILE = 'C:\\Users\\Acer\\AppData\\Local\\notebooklm-mcp\\Data\\chrome_profile';
const NOTEBOOK_URL = 'https://notebooklm.google.com/notebook/4743f15d-7a80-4e22-9b65-5f76806e8ca4';

async function main() {
  const args = process.argv.slice(2);
  const filePath = args[0];
  const title = args[1] || 'Conversaciones iChef - Manual Wpp + Experiencias - Neiff Cardozo';

  if (!filePath || !fs.existsSync(filePath)) {
    console.error('Usage: node upload-single-source.mjs <txt-path> [title]');
    process.exit(1);
  }

  console.log('📖 Reading document...');
  const content = fs.readFileSync(filePath, 'utf-8');
  console.log(`   ${content.length.toLocaleString()} chars (${Math.round(content.length/1024)} KB)`);

  // Stop the MCP server first? No, it might be using the profile.
  // Let's try launching with the same profile - if it fails, we'll handle it.
  console.log('\n🌐 Launching browser...');
  let browser;
  try {
    browser = await chromium.launchPersistentContext(CHROME_PROFILE, {
      headless: false,
      args: ['--disable-blink-features=AutomationControlled'],
    });
  } catch (err) {
    console.error('❌ Could not launch browser. The MCP server may be using the Chrome profile.');
    console.error('   Stop the MCP server (Ctrl+C) and try again.');
    process.exit(1);
  }

  const pages = browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();

  console.log(`📱 Navigating to notebook...`);
  await page.goto(NOTEBOOK_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  // Click "Add source" button
  console.log('📄 Opening Add source dialog...');
  try {
    const addBtn = page.locator('button.add-source-button, button[aria-label*="Add source" i], button[aria-label*="añadir fuente" i]').first();
    await addBtn.click({ timeout: 10000 });
    await page.waitForTimeout(2000);
  } catch {
    // Try URL fallback
    await page.goto(NOTEBOOK_URL + '?addSource=true', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);
  }

  // Wait for dialog
  await page.locator('[role="dialog"]').first().waitFor({ state: 'visible', timeout: 10000 });

  // Click "Pasted text" option
  try {
    const textBtn = page.locator('button.drop-zone-icon-button:has(mat-icon:text-is("content_paste")), button:has-text("Copied text"), button:has-text("Pasted text"), button:has-text("Texto copiado")').first();
    await textBtn.click({ timeout: 5000 });
    await page.waitForTimeout(1000);
  } catch {
    console.log('   (No type selector needed)');
  }

  // Set the textarea value directly via JS (instant, even for large text)
  console.log('✍️  Setting text content via JS...');
  const textarea = page.locator('[role="dialog"] textarea').first();
  await textarea.waitFor({ state: 'visible', timeout: 10000 });

  // Use evaluate to set value directly (much faster than fill)
  await page.evaluate((text) => {
    const ta = document.querySelector('[role="dialog"] textarea');
    if (ta) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      ).set;
      nativeInputValueSetter.call(ta, text);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, content);

  await page.waitForTimeout(1000);

  // Set title if there's a title input
  try {
    const titleInput = page.locator('[role="dialog"] input[placeholder*="title" i], [role="dialog"] input[placeholder*="name" i], [role="dialog"] input[type="text"]:not([readonly])').first();
    if (await titleInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await titleInput.fill(title);
    }
  } catch {}

  // Click Insert button
  console.log('📥 Clicking Insert...');
  const insertBtn = page.locator('[role="dialog"] button.mdc-button--raised, [role="dialog"] button[color="primary"], [role="dialog"] button:has-text("Insert"), [role="dialog"] button:has-text("Einfügen"), [role="dialog"] button:has-text("Insertar")').first();
  await insertBtn.click({ timeout: 5000 });

  // Wait for dialog to close and source to appear
  console.log('⏳ Waiting for source to be indexed...');
  await page.waitForTimeout(5000);

  // Check if source count increased
  const sourcesBefore = 0; // we don't know
  try {
    await page.locator('[role="dialog"]').waitFor({ state: 'hidden', timeout: 60000 });
    console.log('✅ Dialog closed - source being indexed.');
  } catch {
    console.log('⚠️  Dialog may still be open. Check NotebookLM manually.');
  }

  // Verify by checking source count
  try {
    await page.waitForTimeout(3000);
    const sourceText = await page.locator('.cover-subtitle-source-count').first().textContent({ timeout: 5000 }).catch(() => 'unknown');
    console.log(`   Source count indicator: ${sourceText}`);
  } catch {}

  console.log('\n✅ Done! Check your NotebookLM to verify the source.');
  console.log('   You can close the browser window manually.');

  // Don't close - let user see it
  await new Promise(r => setTimeout(r, 10000));
  process.exit(0);
}

main().catch(err => {
  console.error(`\n❌ Error: ${err.message}`);
  process.exit(1);
});

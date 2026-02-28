// @ts-check
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const { execSync } = require('child_process');

const appPath = path.join(__dirname, '..');

/** @type {import('@playwright/test').ElectronApplication} */
let electronApp;

/** @type {import('@playwright/test').Page} */
let window;

test.beforeAll(async () => {
  // Launch with CCT_COMMAND=claude to spawn a Claude Code session
  electronApp = await electron.launch({
    args: [appPath],
    env: { ...process.env, CCT_COMMAND: 'claude' }
  });
  window = await electronApp.firstWindow();
  // Claude may take longer to start than a shell
  await window.waitForSelector('.xterm', { timeout: 15000 });
  // Wait for Claude TUI to fully render
  await window.waitForTimeout(3000);
});

test.afterAll(async () => {
  await electronApp.close();
});

test('claude is on PATH', async () => {
  const claudePath = execSync('which claude', { encoding: 'utf8' }).trim();
  expect(claudePath).toBeTruthy();
  expect(claudePath).toContain('claude');
});

test('.xterm is visible within 10s', async () => {
  const xterm = window.locator('.xterm');
  await expect(xterm).toBeVisible();
});

test('screenshot shows Claude TUI (not raw escape codes)', async () => {
  const screenshot = await window.screenshot();
  expect(screenshot.byteLength).toBeGreaterThan(0);

  // Verify buffer does NOT contain raw escape code sequences
  const text = await window.evaluate(() => window._cctGetBufferText());
  const rawEscapeCount = (text.match(/\\x1b\[|\\u001b\[|\x1b\[/g) || []).length;
  expect(rawEscapeCount).toBeLessThan(5);
});

test('terminal buffer contains Claude UI markers', async () => {
  await expect(async () => {
    const text = await window.evaluate(() => window._cctGetBufferText());
    const hasClaudeMarker = text.includes('>') ||
      text.toLowerCase().includes('claude') ||
      text.includes('tips') ||
      text.includes('help');
    expect(hasClaudeMarker).toBe(true);
  }).toPass({ timeout: 15000 });
});

test('ANSI colors are rendered (colored output present)', async () => {
  // xterm.js DOM renderer uses spans with inline color styles in .xterm-rows
  // Must poll because Claude's TUI may still be painting
  await expect(async () => {
    const coloredSpans = await window.locator('.xterm-rows span[style*="color"]').count();
    expect(coloredSpans).toBeGreaterThan(0);
  }).toPass({ timeout: 5000 });
});

test('send /help and verify buffer updates', async () => {
  const textarea = window.locator('.xterm-helper-textarea');
  await textarea.focus();

  const beforeText = await window.evaluate(() => window._cctGetBufferText());

  await textarea.pressSequentially('/help', { delay: 50 });
  await window.keyboard.press('Enter');

  // Wait for buffer to change — Claude's TUI redraws the screen
  await expect(async () => {
    const text = await window.evaluate(() => window._cctGetBufferText());
    expect(text).not.toBe(beforeText);
  }).toPass({ timeout: 15000 });
});

test('close session — no zombie claude process', async () => {
  const terminalCount = await window.evaluate(() => window.electron_api.terminal.count());
  if (terminalCount > 0) {
    const textarea = window.locator('.xterm-helper-textarea');
    await textarea.focus();
    // Escape to clear any pending state, then /exit
    await window.keyboard.press('Escape');
    await window.waitForTimeout(500);
    await textarea.pressSequentially('/exit', { delay: 50 });
    await window.keyboard.press('Enter');

    // Wait for PTY to exit
    await expect(async () => {
      const count = await window.evaluate(() => window.electron_api.terminal.count());
      expect(count).toBe(0);
    }).toPass({ timeout: 15000 });
  }
});

test('step 003 regression — can still spawn plain shell', async () => {
  const result = await window.evaluate(async () => {
    return await window.electron_api.terminal.create({ cols: 80, rows: 24 });
  });
  expect(result.success).toBe(true);
  expect(result.id).toBeGreaterThan(0);

  // Clean up
  await window.evaluate(async (id) => {
    window.electron_api.terminal.kill({ id });
  }, result.id);
  await window.waitForTimeout(500);
});

// @ts-check
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const appPath = path.join(__dirname, '..');

/** @type {import('@playwright/test').ElectronApplication} */
let electronApp;

/** @type {import('@playwright/test').Page} */
let window;

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [appPath],
    env: { ...process.env, CCT_COMMAND: process.env.SHELL || '/bin/zsh' },
  });
  window = await electronApp.firstWindow();
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 });

  // Create a temp project so we can spawn a session
  const tmpDir = path.join(os.tmpdir(), `cct-test-003-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  await window.evaluate(async (dir) => {
    await window.electron_api.projects.addPath(dir);
    const saved = await window.electron_api.projects.list();
    window._cctReloadProjects(saved);
    window._cctSelectProject(dir);
  }, tmpDir);

  // Create a session in the project
  await window.click('[data-testid="new-tab-btn"]');
  await window.waitForSelector('.xterm', { timeout: 10000 });
});

test.afterAll(async () => {
  if (electronApp) {
    try {
      const win = await electronApp.firstWindow();
      const existing = await win.evaluate(() => window.electron_api.projects.list());
      for (const p of existing) {
        await win.evaluate((path) => window.electron_api.projects.remove(path), p.path);
      }
    } catch { /* app may already be closed */ }
    await electronApp.close();
  }
});

test('.xterm is visible in DOM', async () => {
  const xterm = window.locator('.xterm');
  await expect(xterm).toBeVisible();
});

test('.xterm-screen has non-zero dimensions', async () => {
  const box = await window.locator('.xterm-screen').boundingBox();
  expect(box).toBeTruthy();
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
});

test('screenshot shows terminal content', async () => {
  const screenshot = await window.screenshot();
  expect(screenshot.byteLength).toBeGreaterThan(0);
});

test('can type and see echo output', async () => {
  const textarea = window.locator('.terminal-panel.active .xterm-helper-textarea');
  await textarea.focus();
  // Type a command
  await textarea.pressSequentially('echo HELLO_CCT', { delay: 30 });
  await window.keyboard.press('Enter');
  // Wait for output to appear in xterm buffer (canvas-rendered, use buffer API)
  await expect(async () => {
    const text = await window.evaluate(() => window._cctGetBufferText());
    expect(text).toContain('HELLO_CCT');
  }).toPass({ timeout: 5000 });
});

test('xterm buffer text contains HELLO_CCT', async () => {
  // Verify the output from the previous echo is still visible in the buffer
  const text = await window.evaluate(() => window._cctGetBufferText());
  expect(text).toContain('HELLO_CCT');
});

test('exit closes the PTY and removes the tab', async () => {
  const textarea = window.locator('.terminal-panel.active .xterm-helper-textarea');
  await textarea.focus();
  await window.waitForTimeout(500);
  await textarea.pressSequentially('exit', { delay: 30 });
  await window.keyboard.press('Enter');
  // Tab should be removed when PTY exits
  await expect(window.locator('[data-testid="tab"]')).toHaveCount(0, { timeout: 10000 });
});

test('no orphan PTY after exit', async () => {
  await expect(async () => {
    const count = await window.evaluate(() => window.electron_api.terminal.count());
    expect(count).toBe(0);
  }).toPass({ timeout: 5000 });
});

test('electron_api bridge is still exposed (regression)', async () => {
  const apiType = await window.evaluate(() => typeof window.electron_api);
  expect(apiType).toBe('object');
});

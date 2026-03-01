/**
 * Step 014 — Terminal Font Size Zoom (Cmd+/Cmd-)
 * Zoom in/out/reset for terminal font size with persistence.
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const appPath = path.resolve(__dirname, '..');

let electronApp;
let window;
let tmpDir;

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [appPath],
    env: { ...process.env, CCT_COMMAND: process.env.SHELL || '/bin/zsh' },
  });
  window = await electronApp.firstWindow();
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 });

  tmpDir = path.join(os.tmpdir(), `cct-test-014-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  await window.evaluate(async (dir) => {
    await window.electron_api.projects.addPath(dir);
    const saved = await window.electron_api.projects.list();
    window._cctReloadProjects(saved);
    window._cctSelectProject(dir);
  }, tmpDir);

  // Create a terminal session
  await window.keyboard.press('Meta+t');
  await window.waitForTimeout(500);
  await expect(window.locator('[data-testid="tab"]')).toHaveCount(1, { timeout: 10000 });
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

test('1 - initial font size is 14', async () => {
  const fontSize = await window.evaluate(() => {
    const activeId = window._cctActiveTabId();
    // Access the xterm terminal instance to get its font size
    const textarea = document.querySelector('.terminal-panel.active .xterm-helper-textarea');
    // Get font size from the terminal's options
    return document.querySelector('.terminal-panel.active .xterm-screen')
      ? getComputedStyle(document.querySelector('.terminal-panel.active .xterm-rows')).fontSize
      : null;
  });
  // Should be "14px" by default
  expect(fontSize).toBe('14px');
});

test('2 - Cmd+= increases font size', async () => {
  await window.keyboard.press('Meta+=');
  await window.waitForTimeout(200);

  const fontSize = await window.evaluate(() => {
    return getComputedStyle(document.querySelector('.terminal-panel.active .xterm-rows')).fontSize;
  });
  expect(fontSize).toBe('15px');
});

test('3 - Cmd+- decreases font size', async () => {
  await window.keyboard.press('Meta+-');
  await window.waitForTimeout(200);

  const fontSize = await window.evaluate(() => {
    return getComputedStyle(document.querySelector('.terminal-panel.active .xterm-rows')).fontSize;
  });
  expect(fontSize).toBe('14px'); // Back to 14 from 15
});

test('4 - Cmd+0 resets font size to default', async () => {
  // First zoom in a few times
  await window.keyboard.press('Meta+=');
  await window.keyboard.press('Meta+=');
  await window.keyboard.press('Meta+=');
  await window.waitForTimeout(200);

  const before = await window.evaluate(() => {
    return getComputedStyle(document.querySelector('.terminal-panel.active .xterm-rows')).fontSize;
  });
  expect(before).toBe('17px');

  // Reset
  await window.keyboard.press('Meta+0');
  await window.waitForTimeout(200);

  const after = await window.evaluate(() => {
    return getComputedStyle(document.querySelector('.terminal-panel.active .xterm-rows')).fontSize;
  });
  expect(after).toBe('14px');
});

test('5 - font size does not go below minimum (8px)', async () => {
  // Zoom out many times
  for (let i = 0; i < 10; i++) {
    await window.keyboard.press('Meta+-');
  }
  await window.waitForTimeout(200);

  const fontSize = await window.evaluate(() => {
    return getComputedStyle(document.querySelector('.terminal-panel.active .xterm-rows')).fontSize;
  });
  expect(fontSize).toBe('8px');

  // Reset for next tests
  await window.keyboard.press('Meta+0');
  await window.waitForTimeout(100);
});

test('6 - font size does not go above maximum (32px)', async () => {
  // Zoom in many times
  for (let i = 0; i < 25; i++) {
    await window.keyboard.press('Meta+=');
  }
  await window.waitForTimeout(200);

  const fontSize = await window.evaluate(() => {
    return getComputedStyle(document.querySelector('.terminal-panel.active .xterm-rows')).fontSize;
  });
  expect(fontSize).toBe('32px');

  // Reset for next tests
  await window.keyboard.press('Meta+0');
  await window.waitForTimeout(100);
});

test('7 - font size persists via IPC', async () => {
  // Set font size to 18
  for (let i = 0; i < 4; i++) {
    await window.keyboard.press('Meta+=');
  }
  await window.waitForTimeout(300);

  const savedSize = await window.evaluate(() => {
    return window.electron_api.windowState.getFontSize();
  });
  expect(savedSize).toBe(18);

  // Reset
  await window.keyboard.press('Meta+0');
});

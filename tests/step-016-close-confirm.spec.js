/**
 * Step 016 — Confirm Before Closing with Active Sessions
 * When closing the window with active terminals, a native dialog asks for confirmation.
 * Tests verify the underlying logic since native dialogs can't be tested via Playwright.
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

  tmpDir = path.join(os.tmpdir(), `cct-test-016-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  await window.evaluate(async (dir) => {
    await window.electron_api.projects.addPath(dir);
    const saved = await window.electron_api.projects.list();
    window._cctReloadProjects(saved);
    window._cctSelectProject(dir);
  }, tmpDir);
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

test('1 - terminal count is 0 when no sessions exist', async () => {
  const count = await window.evaluate(() => window.electron_api.terminal.count());
  expect(count).toBe(0);
});

test('2 - terminal count increases when sessions are created', async () => {
  await window.keyboard.press('Meta+t');
  await window.waitForTimeout(500);
  await expect(window.locator('[data-testid="tab"]')).toHaveCount(1, { timeout: 10000 });

  const count = await window.evaluate(() => window.electron_api.terminal.count());
  expect(count).toBe(1);
});

test('3 - terminal count increases with multiple sessions', async () => {
  await window.keyboard.press('Meta+t');
  await window.waitForTimeout(500);
  await expect(window.locator('[data-testid="tab"]')).toHaveCount(2, { timeout: 5000 });

  const count = await window.evaluate(() => window.electron_api.terminal.count());
  expect(count).toBe(2);
});

test('4 - terminal count decreases when session is closed', async () => {
  // Close one tab
  await window.click('[data-testid="tab"]:last-child [data-testid="tab-close"]');
  await window.waitForTimeout(300);

  await expect(window.locator('[data-testid="tab"]')).toHaveCount(1, { timeout: 3000 });
  const count = await window.evaluate(() => window.electron_api.terminal.count());
  expect(count).toBe(1);
});

test('5 - app closes gracefully via app.quit() even with active sessions', async () => {
  // This verifies that forceCloseWindow() is called during before-quit,
  // allowing electronApp.close() (which calls app.quit()) to succeed
  // without the confirmation dialog blocking.
  const count = await window.evaluate(() => window.electron_api.terminal.count());
  expect(count).toBeGreaterThan(0);

  // electronApp.close() calls app.quit() which triggers before-quit → forceClose
  // If this doesn't work, the test will timeout (dialog would block)
  await electronApp.close();
  electronApp = null;

  // If we reach here, the app closed successfully without dialog blocking
  expect(true).toBe(true);
});

test('6 - app relaunches cleanly after force close', async () => {
  // Relaunch app to verify it starts without errors after force close
  electronApp = await electron.launch({
    args: [appPath],
    env: { ...process.env, CCT_COMMAND: process.env.SHELL || '/bin/zsh' },
  });
  window = await electronApp.firstWindow();
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 });

  // App should be responsive — sidebar is visible
  const sidebar = window.locator('[data-testid="sidebar"]');
  await expect(sidebar).toBeVisible();
});

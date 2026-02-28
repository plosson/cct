/**
 * Step 022 — Clear Terminal Buffer (Cmd+K)
 * Cmd+K clears the active terminal's scrollback buffer.
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
    timeout: 60000,
  });
  window = await electronApp.firstWindow({ timeout: 60000 });
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 15000 });

  tmpDir = path.join(os.tmpdir(), `cct-test-022-${Date.now()}`);
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
  await expect(window.locator('[data-testid="tab"]')).toHaveCount(1, { timeout: 5000 });
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

test('1 - terminal has content after typing a command', async () => {
  // Type some output into the terminal
  await window.evaluate(() => {
    const id = window._cctActiveTabId();
    window.electron_api.terminal.input({ id, data: 'echo CLEAR_TEST_CONTENT\n' });
  });
  await window.waitForTimeout(500);

  const text = await window.evaluate(() => window._cctGetBufferText());
  expect(text).toContain('CLEAR_TEST_CONTENT');
});

test('2 - Cmd+K clears the terminal buffer', async () => {
  await window.keyboard.press('Meta+k');
  await window.waitForTimeout(300);

  const text = await window.evaluate(() => window._cctGetBufferText());
  // After clear, the old content should be gone from the scrollback
  expect(text).not.toContain('CLEAR_TEST_CONTENT');
});

test('3 - terminal is still functional after clear', async () => {
  // Type new content to verify terminal works after clear
  await window.evaluate(() => {
    const id = window._cctActiveTabId();
    window.electron_api.terminal.input({ id, data: 'echo AFTER_CLEAR\n' });
  });
  await window.waitForTimeout(500);

  const text = await window.evaluate(() => window._cctGetBufferText());
  expect(text).toContain('AFTER_CLEAR');
});

test('4 - Cmd+K does nothing when no active session', async () => {
  // Close the tab
  await window.keyboard.press('Meta+w');
  await window.waitForTimeout(300);
  await expect(window.locator('[data-testid="tab"]')).toHaveCount(0, { timeout: 3000 });

  // This should not throw
  await window.keyboard.press('Meta+k');
  await window.waitForTimeout(200);

  // App still responsive
  const sidebar = window.locator('[data-testid="sidebar"]');
  await expect(sidebar).toBeVisible();
});

test('5 - shortcut help overlay includes Clear Terminal entry', async () => {
  await window.keyboard.press('Meta+/');
  const overlay = window.locator('[data-testid="shortcut-help-overlay"]');
  await expect(overlay).toBeVisible({ timeout: 3000 });

  const labels = overlay.locator('.shortcut-help-label');
  const allLabels = await labels.allTextContents();
  expect(allLabels).toContain('Clear Terminal');

  await window.keyboard.press('Escape');
});

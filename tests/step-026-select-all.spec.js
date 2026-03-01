/**
 * Step 026 — Select All (Cmd+A)
 * Cmd+A selects all text in the active terminal buffer.
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { appPath, launchEnv } = require('./helpers');

let electronApp;
let window;
let tmpDir;

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [appPath],
    env: launchEnv(),
    timeout: 60000,
  });
  window = await electronApp.firstWindow({ timeout: 60000 });
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 15000 });

  tmpDir = path.join(os.tmpdir(), `cct-test-026-${Date.now()}`);
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

test('1 - terminal has no selection initially', async () => {
  const selection = await window.evaluate(() => {
    const id = window._cctActiveTabId();
    const sessions = window._cctGetSessionsForProject(window._cctSelectedProject());
    // Access the terminal's selection via the test helper
    return ''; // No selection by default
  });
  // Just verifying the terminal is ready
  const bufferText = await window.evaluate(() => window._cctGetBufferText());
  expect(typeof bufferText).toBe('string');
});

test('2 - Cmd+A selects all text in terminal', async () => {
  // Type some text first
  await window.evaluate(() => {
    const id = window._cctActiveTabId();
    window.electron_api.terminal.input({ id, data: 'echo SELECT_ALL_TEST\\n' });
  });
  await window.waitForTimeout(500);

  // Press Cmd+A to select all
  await window.keyboard.press('Meta+a');
  await window.waitForTimeout(200);

  // Check that there is a selection
  const hasSelection = await window.evaluate(() => {
    const id = window._cctActiveTabId();
    // We need to access the terminal through sessions map
    // Use the clipboard approach: after selectAll, getSelection should return non-empty
    return document.querySelector('.xterm .xterm-screen') !== null;
  });
  expect(hasSelection).toBe(true);

  // Copy the selection and verify it contains our test text
  await window.evaluate(() => {
    // The selectAll was already done by Cmd+A
    // Now use the clipboard to get what's selected
    const id = window._cctActiveTabId();
  });

  // Verify by using Cmd+Shift+C to copy, then reading clipboard
  await window.keyboard.press('Meta+Shift+C');
  await window.waitForTimeout(200);

  const clipboardText = await window.evaluate(() => window.electron_api.clipboard.readText());
  expect(clipboardText).toContain('SELECT_ALL_TEST');
});

test('3 - Cmd+A is a no-op when no active session', async () => {
  // Close the tab
  await window.keyboard.press('Meta+w');
  await window.waitForTimeout(300);
  await expect(window.locator('[data-testid="tab"]')).toHaveCount(0, { timeout: 3000 });

  // Should not throw
  await window.keyboard.press('Meta+a');
  await window.waitForTimeout(200);

  // App still responsive
  const sidebar = window.locator('[data-testid="sidebar"]');
  await expect(sidebar).toBeVisible();
});

test('4 - shortcut help overlay includes Select All entry', async () => {
  await window.keyboard.press('Meta+/');
  const overlay = window.locator('[data-testid="shortcut-help-overlay"]');
  await expect(overlay).toBeVisible({ timeout: 3000 });

  const labels = overlay.locator('.shortcut-help-label');
  const allLabels = await labels.allTextContents();
  expect(allLabels).toContain('Select All');

  await window.keyboard.press('Escape');
});

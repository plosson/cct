/**
 * Step 017 — Keyboard Shortcut Help Overlay (Cmd+/)
 * Cmd+/ toggles a modal overlay showing all keyboard shortcuts.
 * Escape or clicking outside closes it.
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

  tmpDir = path.join(os.tmpdir(), `cct-test-017-${Date.now()}`);
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

test('1 - Cmd+/ opens shortcut help overlay', async () => {
  await window.keyboard.press('Meta+/');
  const overlay = window.locator('[data-testid="shortcut-help-overlay"]');
  await expect(overlay).toBeVisible({ timeout: 3000 });
});

test('2 - overlay shows Keyboard Shortcuts title', async () => {
  const title = window.locator('.shortcut-help-title');
  await expect(title).toHaveText('Keyboard Shortcuts');
});

test('3 - overlay lists all registered keybindings', async () => {
  const rows = window.locator('[data-testid="shortcut-help-row"]');
  // At least 13 keybindings (the DEFAULT_KEYBINDINGS map has 13 entries)
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(13);
});

test('4 - key combos use macOS symbols', async () => {
  // Find a row that has the ⌘ symbol (all our shortcuts use Meta)
  const keys = window.locator('.shortcut-help-key');
  const firstKeyText = await keys.first().textContent();
  expect(firstKeyText).toContain('\u2318'); // ⌘
});

test('5 - Escape closes the overlay', async () => {
  // Overlay should still be open from test 1
  const overlay = window.locator('[data-testid="shortcut-help-overlay"]');
  await expect(overlay).toBeVisible();

  await window.keyboard.press('Escape');
  await expect(overlay).not.toBeVisible({ timeout: 3000 });
});

test('6 - Cmd+/ toggles overlay (open then close)', async () => {
  // Open
  await window.keyboard.press('Meta+/');
  const overlay = window.locator('[data-testid="shortcut-help-overlay"]');
  await expect(overlay).toBeVisible({ timeout: 3000 });

  // Toggle close
  await window.keyboard.press('Meta+/');
  await expect(overlay).not.toBeVisible({ timeout: 3000 });
});

test('7 - clicking backdrop closes the overlay', async () => {
  // Open
  await window.keyboard.press('Meta+/');
  const overlay = window.locator('[data-testid="shortcut-help-overlay"]');
  await expect(overlay).toBeVisible({ timeout: 3000 });

  // Click the overlay backdrop (not the panel)
  await overlay.click({ position: { x: 10, y: 10 } });
  await expect(overlay).not.toBeVisible({ timeout: 3000 });
});

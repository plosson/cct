/**
 * Step 031 — Close Other Tabs Shortcut (Cmd+Shift+W)
 * Cmd+Shift+W closes all tabs except the active one.
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
    timeout: 90000,
  });
  window = await electronApp.firstWindow({ timeout: 90000 });
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 15000 });

  tmpDir = path.join(os.tmpdir(), `cct-test-031-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  await window.evaluate(async (dir) => {
    await window.electron_api.projects.addPath(dir);
    const saved = await window.electron_api.projects.list();
    window._cctReloadProjects(saved);
    window._cctSelectProject(dir);
  }, tmpDir);

  // Create 3 terminal sessions
  for (let i = 0; i < 3; i++) {
    await window.keyboard.press('Meta+t');
    await window.waitForTimeout(400);
  }
  await expect(window.locator('[data-testid="tab"]')).toHaveCount(3, { timeout: 5000 });
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

test('1 - three tabs exist initially', async () => {
  await expect(window.locator('[data-testid="tab"]')).toHaveCount(3);
});

test('2 - Cmd+Shift+W closes all tabs except active', async () => {
  // Active tab is the 3rd one (last created)
  const activeId = await window.evaluate(() => window._cctActiveTabId());
  expect(activeId).toBeTruthy();

  await window.keyboard.press('Meta+Shift+W');
  await window.waitForTimeout(500);

  // Only 1 tab should remain
  await expect(window.locator('[data-testid="tab"]')).toHaveCount(1, { timeout: 5000 });

  // The remaining tab should be the one that was active
  const stillActiveId = await window.evaluate(() => window._cctActiveTabId());
  expect(stillActiveId).toBe(activeId);
});

test('3 - Cmd+Shift+W is a no-op with only one tab', async () => {
  await expect(window.locator('[data-testid="tab"]')).toHaveCount(1);

  // Should not throw or close the last tab
  await window.keyboard.press('Meta+Shift+W');
  await window.waitForTimeout(300);

  await expect(window.locator('[data-testid="tab"]')).toHaveCount(1);
});

test('4 - shortcut help overlay includes Close Other Tabs entry', async () => {
  await window.keyboard.press('Meta+/');
  const overlay = window.locator('[data-testid="shortcut-help-overlay"]');
  await expect(overlay).toBeVisible({ timeout: 3000 });

  const labels = overlay.locator('.shortcut-help-label');
  const allLabels = await labels.allTextContents();
  expect(allLabels).toContain('Close Other Tabs');

  await window.keyboard.press('Escape');
});

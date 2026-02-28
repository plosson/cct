/**
 * Step 027 — Toggle Sidebar Visibility (Cmd+B)
 * Cmd+B hides/shows the sidebar.
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

  tmpDir = path.join(os.tmpdir(), `cct-test-027-${Date.now()}`);
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

test('1 - sidebar is visible by default', async () => {
  const sidebar = window.locator('[data-testid="sidebar"]');
  await expect(sidebar).toBeVisible();
  const visible = await window.evaluate(() => window._cctIsSidebarVisible());
  expect(visible).toBe(true);
});

test('2 - Cmd+B hides the sidebar', async () => {
  await window.keyboard.press('Meta+b');
  await window.waitForTimeout(200);

  const sidebar = window.locator('[data-testid="sidebar"]');
  await expect(sidebar).not.toBeVisible();

  const visible = await window.evaluate(() => window._cctIsSidebarVisible());
  expect(visible).toBe(false);
});

test('3 - resize handle is also hidden', async () => {
  const handle = window.locator('[data-testid="sidebar-resize-handle"]');
  await expect(handle).not.toBeVisible();
});

test('4 - Cmd+B shows the sidebar again', async () => {
  await window.keyboard.press('Meta+b');
  await window.waitForTimeout(200);

  const sidebar = window.locator('[data-testid="sidebar"]');
  await expect(sidebar).toBeVisible();

  const visible = await window.evaluate(() => window._cctIsSidebarVisible());
  expect(visible).toBe(true);
});

test('5 - resize handle is visible again', async () => {
  const handle = window.locator('[data-testid="sidebar-resize-handle"]');
  await expect(handle).toBeVisible();
});

test('6 - shortcut help overlay includes Toggle Sidebar entry', async () => {
  await window.keyboard.press('Meta+/');
  const overlay = window.locator('[data-testid="shortcut-help-overlay"]');
  await expect(overlay).toBeVisible({ timeout: 3000 });

  const labels = overlay.locator('.shortcut-help-label');
  const allLabels = await labels.allTextContents();
  expect(allLabels).toContain('Toggle Sidebar');

  await window.keyboard.press('Escape');
});

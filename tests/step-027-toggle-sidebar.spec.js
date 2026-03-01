/**
 * Step 027 — Sidebar Auto-Hide (Dock Mode)
 * Default is autohide. Cmd+B toggles between pinned and autohide.
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

test('1 - sidebar starts in autohide mode', async () => {
  const mode = await window.evaluate(() => window._cctGetSidebarMode());
  expect(mode).toBe('autohide');
  const visible = await window.evaluate(() => window._cctIsSidebarVisible());
  expect(visible).toBe(false);
});

test('2 - Cmd+B pins the sidebar', async () => {
  await window.keyboard.press('Meta+b');
  await window.waitForTimeout(200);

  const mode = await window.evaluate(() => window._cctGetSidebarMode());
  expect(mode).toBe('pinned');

  const sidebar = window.locator('[data-testid="sidebar"]');
  await expect(sidebar).toBeVisible();

  const visible = await window.evaluate(() => window._cctIsSidebarVisible());
  expect(visible).toBe(true);
});

test('3 - resize handle is visible when pinned', async () => {
  const handle = window.locator('[data-testid="sidebar-resize-handle"]');
  await expect(handle).toBeVisible();
});

test('4 - Cmd+B returns to autohide', async () => {
  await window.keyboard.press('Meta+b');
  await window.waitForTimeout(200);

  const mode = await window.evaluate(() => window._cctGetSidebarMode());
  expect(mode).toBe('autohide');

  const visible = await window.evaluate(() => window._cctIsSidebarVisible());
  expect(visible).toBe(false);
});

test('5 - resize handle is hidden in autohide mode', async () => {
  const handle = window.locator('[data-testid="sidebar-resize-handle"]');
  await expect(handle).not.toBeVisible();
});

test('6 - shortcut help overlay includes Pin/Unpin Sidebar entry', async () => {
  await window.keyboard.press('Meta+/');
  const overlay = window.locator('[data-testid="shortcut-help-overlay"]');
  await expect(overlay).toBeVisible({ timeout: 3000 });

  const labels = overlay.locator('.shortcut-help-label');
  const allLabels = await labels.allTextContents();
  expect(allLabels).toContain('Pin/Unpin Sidebar');

  await window.keyboard.press('Escape');
});

test('7 - trigger zone exists and is visible in autohide mode', async () => {
  const triggerZone = window.locator('[data-testid="sidebar-trigger-zone"]');
  await expect(triggerZone).toBeVisible();
});

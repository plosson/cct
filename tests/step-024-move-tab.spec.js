/**
 * Step 024 — Move Tab with Keyboard (Cmd+Shift+Left/Right)
 * Cmd+Shift+Left moves the active tab left in the tab bar.
 * Cmd+Shift+Right moves the active tab right in the tab bar.
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

  tmpDir = path.join(os.tmpdir(), `cct-test-024-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  await window.evaluate(async (dir) => {
    await window.electron_api.projects.addPath(dir);
    const saved = await window.electron_api.projects.list();
    window._cctReloadProjects(saved);
    window._cctSelectProject(dir);
  }, tmpDir);

  // Create 3 terminal sessions to have enough tabs for reordering
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

test('1 - three tabs exist with correct initial order', async () => {
  const order = await window.evaluate(() => window._cctGetTabOrder());
  expect(order).toHaveLength(3);
  // Tab 3 should be active (last created)
  const activeLabel = await window.locator('[data-testid="tab"].active .tab-label').textContent();
  expect(activeLabel).toContain('3');
});

test('2 - Cmd+Shift+Left moves active tab left', async () => {
  // Active tab is tab 3 (index 2). After move left, it should be at index 1.
  const beforeOrder = await window.evaluate(() => window._cctGetTabOrder());
  const activeLabel = beforeOrder[2]; // tab 3

  await window.keyboard.press('Meta+Shift+ArrowLeft');
  await window.waitForTimeout(200);

  const afterOrder = await window.evaluate(() => window._cctGetTabOrder());
  expect(afterOrder[1]).toBe(activeLabel);
  expect(afterOrder).toHaveLength(3);
});

test('3 - Cmd+Shift+Right moves active tab right', async () => {
  // After test 2, active tab is at index 1. Move right puts it back at index 2.
  const beforeOrder = await window.evaluate(() => window._cctGetTabOrder());
  const activeLabel = beforeOrder[1]; // the tab we moved

  await window.keyboard.press('Meta+Shift+ArrowRight');
  await window.waitForTimeout(200);

  const afterOrder = await window.evaluate(() => window._cctGetTabOrder());
  expect(afterOrder[2]).toBe(activeLabel);
});

test('4 - move left wraps first tab to last position', async () => {
  // Activate the first tab
  await window.keyboard.press('Meta+1');
  await window.waitForTimeout(200);

  const beforeOrder = await window.evaluate(() => window._cctGetTabOrder());
  const firstLabel = beforeOrder[0];

  await window.keyboard.press('Meta+Shift+ArrowLeft');
  await window.waitForTimeout(200);

  const afterOrder = await window.evaluate(() => window._cctGetTabOrder());
  // First tab should now be last
  expect(afterOrder[afterOrder.length - 1]).toBe(firstLabel);
});

test('5 - move right wraps last tab to first position', async () => {
  // After test 4, the tab we moved is now last. Move right should wrap to first.
  const beforeOrder = await window.evaluate(() => window._cctGetTabOrder());
  const lastLabel = beforeOrder[beforeOrder.length - 1];

  await window.keyboard.press('Meta+Shift+ArrowRight');
  await window.waitForTimeout(200);

  const afterOrder = await window.evaluate(() => window._cctGetTabOrder());
  expect(afterOrder[0]).toBe(lastLabel);
});

test('6 - shortcut help overlay includes Move Tab entries', async () => {
  await window.keyboard.press('Meta+/');
  const overlay = window.locator('[data-testid="shortcut-help-overlay"]');
  await expect(overlay).toBeVisible({ timeout: 3000 });

  const labels = overlay.locator('.shortcut-help-label');
  const allLabels = await labels.allTextContents();
  expect(allLabels).toContain('Move Tab Left');
  expect(allLabels).toContain('Move Tab Right');

  await window.keyboard.press('Escape');
});

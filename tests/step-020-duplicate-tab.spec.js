/**
 * Step 020 — Duplicate Tab via Context Menu
 * "Duplicate" in the tab context menu creates a new session of the same type
 * in the same project.
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
  });
  window = await electronApp.firstWindow();
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 });

  tmpDir = path.join(os.tmpdir(), `cct-test-020-${Date.now()}`);
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

test('1 - context menu includes Duplicate option', async () => {
  // Create a terminal tab
  await window.keyboard.press('Meta+t');
  await window.waitForTimeout(500);
  await expect(window.locator('[data-testid="tab"]')).toHaveCount(1, { timeout: 5000 });

  const tabId = await window.evaluate(() => window._cctActiveTabId());
  const items = await window.evaluate((id) => window._cctGetTabContextMenuItems(id), tabId);
  const duplicateItem = items.find(i => i.action === 'duplicate');
  expect(duplicateItem).toBeTruthy();
  expect(duplicateItem.label).toBe('Duplicate');
});

test('2 - duplicating a terminal tab creates a new terminal tab', async () => {
  const tabId = await window.evaluate(() => window._cctActiveTabId());
  await window.evaluate((id) => window._cctDuplicateTab(id), tabId);
  await window.waitForTimeout(500);

  await expect(window.locator('[data-testid="tab"]')).toHaveCount(2, { timeout: 5000 });
});

test('3 - duplicated tab is the same type as original', async () => {
  // Both tabs should be terminal type (T icon)
  const icons = window.locator('.tab-icon-terminal');
  await expect(icons).toHaveCount(2);
});

test('4 - duplicated tab becomes the active tab', async () => {
  // The new tab (last one) should be active
  const tabs = window.locator('[data-testid="tab"]');
  await expect(tabs.nth(1)).toHaveClass(/active/);
});

test('5 - session count updates in sidebar after duplicate', async () => {
  const count = await window.locator('[data-testid="session-count"]').first().textContent();
  expect(parseInt(count)).toBe(2);
});

test('6 - duplicate a claude-type tab creates a claude tab', async () => {
  // Create a claude session
  await window.keyboard.press('Meta+n');
  await window.waitForTimeout(500);
  await expect(window.locator('[data-testid="tab"]')).toHaveCount(3, { timeout: 5000 });

  // Duplicate the claude tab
  const claudeTabId = await window.evaluate(() => window._cctActiveTabId());
  await window.evaluate((id) => window._cctDuplicateTab(id), claudeTabId);
  await window.waitForTimeout(500);

  await expect(window.locator('[data-testid="tab"]')).toHaveCount(4, { timeout: 5000 });

  // The new tab should have a CC icon (claude type)
  const claudeIcons = window.locator('.tab-icon-claude');
  await expect(claudeIcons).toHaveCount(2);
});

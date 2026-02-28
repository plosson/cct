/**
 * Step 011 — Tab Context Menu
 * Right-click on a tab shows a native context menu with Close, Close Others, Close All.
 * Tests verify the underlying actions (close, closeOthers, closeAll) via test helpers,
 * since native Electron menus can't be interacted with from Playwright.
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

  // Create a temp project and select it
  tmpDir = path.join(os.tmpdir(), `cct-test-011-${Date.now()}`);
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

async function createTerminalSession() {
  await window.keyboard.press('Meta+t');
  await window.waitForTimeout(500);
  await expect(async () => {
    const count = await window.locator('[data-testid="tab"]').count();
    expect(count).toBeGreaterThan(0);
  }).toPass({ timeout: 10000 });
}

test('1 - tab has contextmenu listener', async () => {
  await createTerminalSession();
  const tabs = window.locator('[data-testid="tab"]');
  await expect(tabs).toHaveCount(1, { timeout: 3000 });

  // Verify context menu items are generated correctly
  const items = await window.evaluate(() => {
    const activeId = window._cctActiveTabId();
    return window._cctGetTabContextMenuItems(activeId);
  });

  expect(items).toHaveLength(3);
  expect(items[0]).toEqual({ label: 'Close', action: 'close' });
  expect(items[1]).toEqual({ label: 'Close Others', action: 'closeOthers', enabled: false });
  expect(items[2]).toEqual({ label: 'Close All', action: 'closeAll' });
});

test('2 - Close Others is disabled with only one tab', async () => {
  const items = await window.evaluate(() => {
    const activeId = window._cctActiveTabId();
    return window._cctGetTabContextMenuItems(activeId);
  });

  const closeOthers = items.find(i => i.action === 'closeOthers');
  expect(closeOthers.enabled).toBe(false);
});

test('3 - Close Others is enabled with multiple tabs', async () => {
  await createTerminalSession();
  const tabs = window.locator('[data-testid="tab"]');
  await expect(tabs).toHaveCount(2, { timeout: 5000 });

  const items = await window.evaluate(() => {
    const activeId = window._cctActiveTabId();
    return window._cctGetTabContextMenuItems(activeId);
  });

  const closeOthers = items.find(i => i.action === 'closeOthers');
  expect(closeOthers.enabled).toBe(true);
});

test('4 - closeOtherTabs keeps only the specified tab', async () => {
  // Create a third session (should have 2 from previous tests)
  await createTerminalSession();
  const tabs = window.locator('[data-testid="tab"]');
  await expect(tabs).toHaveCount(3, { timeout: 5000 });

  // Keep the active tab, close others
  await window.evaluate(() => {
    const keepId = window._cctActiveTabId();
    window._cctCloseOtherTabs(keepId);
  });
  await window.waitForTimeout(500);

  await expect(tabs).toHaveCount(1, { timeout: 3000 });
});

test('5 - closeAllTabs closes every tab in the project', async () => {
  // Create 2 more sessions
  await createTerminalSession();
  await createTerminalSession();
  const tabs = window.locator('[data-testid="tab"]');
  await expect(tabs).toHaveCount(3, { timeout: 5000 });

  await window.evaluate(() => {
    window._cctCloseAllTabs();
  });
  await window.waitForTimeout(500);

  await expect(tabs).toHaveCount(0, { timeout: 3000 });
});

test('6 - empty state shows after Close All', async () => {
  const emptyState = window.locator('[data-testid="empty-state"]');
  await expect(emptyState).toBeVisible({ timeout: 3000 });
});

test('7 - closeOtherTabs activates the kept tab', async () => {
  // Create 3 sessions
  await createTerminalSession();
  await createTerminalSession();
  await createTerminalSession();
  const tabs = window.locator('[data-testid="tab"]');
  await expect(tabs).toHaveCount(3, { timeout: 5000 });

  // Get the first tab's ID
  const firstTabId = await window.evaluate(() => {
    const allTabs = document.querySelectorAll('[data-testid="tab"]');
    return Number(allTabs[0].dataset.tabId);
  });

  // Close others, keeping the first tab
  await window.evaluate((id) => window._cctCloseOtherTabs(id), firstTabId);
  await window.waitForTimeout(500);

  await expect(tabs).toHaveCount(1, { timeout: 3000 });

  // The kept tab should be active
  const activeTabId = await window.evaluate(() => window._cctActiveTabId());
  expect(activeTabId).toBe(firstTabId);

  // Clean up
  await window.evaluate(() => window._cctCloseAllTabs());
  await window.waitForTimeout(300);
});

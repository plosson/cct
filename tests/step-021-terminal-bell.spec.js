/**
 * Step 021 — Terminal Bell Notification (Tab Flash)
 * When a non-active terminal emits a bell character, the tab briefly flashes.
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

  tmpDir = path.join(os.tmpdir(), `cct-test-021-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  await window.evaluate(async (dir) => {
    await window.electron_api.projects.addPath(dir);
    const saved = await window.electron_api.projects.list();
    window._cctReloadProjects(saved);
    window._cctSelectProject(dir);
  }, tmpDir);

  // Create two terminal tabs
  await window.keyboard.press('Meta+t');
  await window.waitForTimeout(500);
  await window.keyboard.press('Meta+t');
  await window.waitForTimeout(500);
  await expect(window.locator('[data-testid="tab"]')).toHaveCount(2, { timeout: 5000 });
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

test('1 - background tab gets tab-bell class when bell is triggered', async () => {
  // Tab 2 is active, send bell to tab 1 (background)
  const tab1Id = await window.evaluate(() => {
    const ids = window._cctGetSessionsForProject(window._cctSelectedProject());
    return ids[0]; // first tab (background since tab 2 is active)
  });

  // Send BEL character to the background terminal
  await window.evaluate((id) => {
    window.electron_api.terminal.input({ id, data: 'printf "\\a"\n' });
  }, tab1Id);

  await window.waitForTimeout(500);

  const tab1 = window.locator('[data-testid="tab"]').nth(0);
  await expect(tab1).toHaveClass(/tab-bell/, { timeout: 3000 });
});

test('2 - tab-bell class is removed after animation', async () => {
  // Wait for the 1-second timeout to remove the class
  await window.waitForTimeout(1200);

  const tab1 = window.locator('[data-testid="tab"]').nth(0);
  await expect(tab1).not.toHaveClass(/tab-bell/);
});

test('3 - active tab does not get tab-bell class on bell', async () => {
  // Tab 2 is active, send bell to tab 2 (active)
  const activeId = await window.evaluate(() => window._cctActiveTabId());

  await window.evaluate((id) => {
    window.electron_api.terminal.input({ id, data: 'printf "\\a"\n' });
  }, activeId);

  await window.waitForTimeout(500);

  const tab2 = window.locator('[data-testid="tab"]').nth(1);
  await expect(tab2).not.toHaveClass(/tab-bell/);
});

test('4 - tab-bell class triggers a CSS animation', async () => {
  // Temporarily add the class and check computed animation-name
  const animName = await window.evaluate(() => {
    const tab = document.querySelector('[data-testid="tab"]');
    tab.classList.add('tab-bell');
    const style = window.getComputedStyle(tab);
    const name = style.animationName;
    tab.classList.remove('tab-bell');
    return name;
  });
  expect(animName).toBe('tab-bell-flash');
});

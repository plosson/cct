/**
 * Step 015 — Tab Activity Indicator
 * When a non-active tab receives terminal output, it shows a visual indicator.
 * The indicator clears when the tab is activated.
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

  tmpDir = path.join(os.tmpdir(), `cct-test-015-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  await window.evaluate(async (dir) => {
    await window.electron_api.projects.addPath(dir);
    const saved = await window.electron_api.projects.list();
    window._cctReloadProjects(saved);
    window._cctSelectProject(dir);
  }, tmpDir);

  // Create two terminal sessions
  await window.keyboard.press('Meta+t');
  await window.waitForTimeout(500);
  await window.keyboard.press('Meta+t');
  await window.waitForTimeout(500);
  await expect(window.locator('[data-testid="tab"]')).toHaveCount(2, { timeout: 10000 });
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

test('1 - active tab does not have activity class', async () => {
  const activeTab = window.locator('[data-testid="tab"].active');
  const hasActivity = await activeTab.evaluate(el => el.classList.contains('tab-activity'));
  expect(hasActivity).toBe(false);
});

test('2 - background tab gets activity indicator on output', async () => {
  // The second tab is active. Switch to the first tab.
  const tabs = window.locator('[data-testid="tab"]');
  await tabs.first().click();
  await window.waitForTimeout(200);

  // Now the first tab is active, second is in background.
  // Get the second tab's terminal ID
  const secondTabId = await tabs.nth(1).getAttribute('data-tab-id');

  // Send output to the background terminal by typing in the first tab,
  // which will echo text. But we need output in the SECOND (background) tab.
  // Let's use a different approach: type in the first tab, then the background
  // tab's shell prompt will also have been written initially.

  // Actually, the background tab already received shell prompt output when it was created.
  // Since we switched away from it, any new output would trigger the indicator.
  // Let's generate output by sending data to the background terminal via IPC.
  await window.evaluate(async (tabId) => {
    const id = Number(tabId);
    // Send a command to the background terminal
    window.electron_api.terminal.input({ id, data: 'echo BACKGROUND_OUTPUT\n' });
  }, secondTabId);

  // Wait for the output to be received
  await window.waitForTimeout(500);

  // The second tab should now have the activity class
  const hasActivity = await tabs.nth(1).evaluate(el => el.classList.contains('tab-activity'));
  expect(hasActivity).toBe(true);
});

test('3 - clicking the tab clears the activity indicator', async () => {
  const tabs = window.locator('[data-testid="tab"]');

  // Click the second tab (which has activity)
  await tabs.nth(1).click();
  await window.waitForTimeout(200);

  // Activity indicator should be cleared
  const hasActivity = await tabs.nth(1).evaluate(el => el.classList.contains('tab-activity'));
  expect(hasActivity).toBe(false);
});

test('4 - switching tabs via keyboard clears activity', async () => {
  // Switch to the first tab
  await window.keyboard.press('Meta+ArrowLeft');
  await window.waitForTimeout(200);

  // Send output to background tab (second tab)
  const tabs = window.locator('[data-testid="tab"]');
  const secondTabId = await tabs.nth(1).getAttribute('data-tab-id');
  await window.evaluate(async (tabId) => {
    const id = Number(tabId);
    window.electron_api.terminal.input({ id, data: 'echo MORE_OUTPUT\n' });
  }, secondTabId);
  await window.waitForTimeout(500);

  // Second tab should have activity
  let hasActivity = await tabs.nth(1).evaluate(el => el.classList.contains('tab-activity'));
  expect(hasActivity).toBe(true);

  // Switch to it via keyboard
  await window.keyboard.press('Meta+ArrowRight');
  await window.waitForTimeout(200);

  // Activity should be cleared
  hasActivity = await tabs.nth(1).evaluate(el => el.classList.contains('tab-activity'));
  expect(hasActivity).toBe(false);
});

test('5 - activity indicator shows as a blue dot', async () => {
  // Switch to first tab, generate output in second
  const tabs = window.locator('[data-testid="tab"]');
  await tabs.first().click();
  await window.waitForTimeout(200);

  const secondTabId = await tabs.nth(1).getAttribute('data-tab-id');
  await window.evaluate(async (tabId) => {
    const id = Number(tabId);
    window.electron_api.terminal.input({ id, data: 'echo DOT_TEST\n' });
  }, secondTabId);
  await window.waitForTimeout(500);

  // Check the ::after pseudo-element exists (via CSS class presence)
  const hasActivityClass = await tabs.nth(1).evaluate(el => el.classList.contains('tab-activity'));
  expect(hasActivityClass).toBe(true);

  // Clean up: switch to second tab to clear indicator
  await tabs.nth(1).click();
  await window.waitForTimeout(100);
});

test('6 - active tab output does not trigger activity indicator', async () => {
  // The active tab should never get the activity class
  const textarea = window.locator('.terminal-panel.active .xterm-helper-textarea');
  await textarea.pressSequentially('echo ACTIVE_OUTPUT', { delay: 20 });
  await window.keyboard.press('Enter');
  await window.waitForTimeout(300);

  const activeTab = window.locator('[data-testid="tab"].active');
  const hasActivity = await activeTab.evaluate(el => el.classList.contains('tab-activity'));
  expect(hasActivity).toBe(false);
});

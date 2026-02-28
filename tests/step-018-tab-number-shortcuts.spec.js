/**
 * Step 018 — Tab Number Shortcuts (Cmd+1-9)
 * Cmd+1-8 switches to the Nth tab, Cmd+9 goes to the last tab.
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

  tmpDir = path.join(os.tmpdir(), `cct-test-018-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  await window.evaluate(async (dir) => {
    await window.electron_api.projects.addPath(dir);
    const saved = await window.electron_api.projects.list();
    window._cctReloadProjects(saved);
    window._cctSelectProject(dir);
  }, tmpDir);

  // Create 3 tabs
  await window.keyboard.press('Meta+t');
  await window.waitForTimeout(500);
  await window.keyboard.press('Meta+t');
  await window.waitForTimeout(500);
  await window.keyboard.press('Meta+t');
  await window.waitForTimeout(500);
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

test('1 - Cmd+1 activates the first tab', async () => {
  await window.keyboard.press('Meta+1');
  await window.waitForTimeout(200);

  const tabs = window.locator('[data-testid="tab"]');
  await expect(tabs.nth(0)).toHaveClass(/active/);
  await expect(tabs.nth(2)).not.toHaveClass(/active/);
});

test('2 - Cmd+3 activates the third tab', async () => {
  await window.keyboard.press('Meta+3');
  await window.waitForTimeout(200);

  const tabs = window.locator('[data-testid="tab"]');
  await expect(tabs.nth(2)).toHaveClass(/active/);
  await expect(tabs.nth(0)).not.toHaveClass(/active/);
});

test('3 - Cmd+9 activates the last tab', async () => {
  // First, activate tab 1 so we know we're switching
  await window.keyboard.press('Meta+1');
  await window.waitForTimeout(200);

  await window.keyboard.press('Meta+9');
  await window.waitForTimeout(200);

  const tabs = window.locator('[data-testid="tab"]');
  const count = await tabs.count();
  await expect(tabs.nth(count - 1)).toHaveClass(/active/);
});

test('4 - Cmd+N beyond tab count goes to last tab', async () => {
  await window.keyboard.press('Meta+1');
  await window.waitForTimeout(200);

  // We have 3 tabs, Cmd+5 should go to last (index clamped)
  await window.keyboard.press('Meta+5');
  await window.waitForTimeout(200);

  const tabs = window.locator('[data-testid="tab"]');
  await expect(tabs.nth(2)).toHaveClass(/active/);
});

test('5 - Cmd+2 activates second tab from first', async () => {
  await window.keyboard.press('Meta+1');
  await window.waitForTimeout(200);
  await expect(window.locator('[data-testid="tab"]').nth(0)).toHaveClass(/active/);

  await window.keyboard.press('Meta+2');
  await window.waitForTimeout(200);
  await expect(window.locator('[data-testid="tab"]').nth(1)).toHaveClass(/active/);
});

test('6 - shortcut help overlay includes Cmd+1 entry', async () => {
  await window.keyboard.press('Meta+/');
  const overlay = window.locator('[data-testid="shortcut-help-overlay"]');
  await expect(overlay).toBeVisible({ timeout: 3000 });

  // Check that "Go to Tab 1" label exists
  const labels = overlay.locator('.shortcut-help-label');
  const allLabels = await labels.allTextContents();
  expect(allLabels).toContain('Go to Tab 1');
  expect(allLabels).toContain('Go to Last Tab');

  await window.keyboard.press('Escape');
});

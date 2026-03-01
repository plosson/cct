/**
 * Step 025 — Session Uptime in Status Bar
 * Displays how long the active session has been running.
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

  tmpDir = path.join(os.tmpdir(), `cct-test-025-${Date.now()}`);
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

test('1 - uptime element exists in status bar', async () => {
  const el = window.locator('[data-testid="status-uptime"]');
  await expect(el).toBeAttached();
});

test('2 - uptime is empty when no active session', async () => {
  // No tabs created yet
  const text = await window.locator('[data-testid="status-uptime"]').textContent();
  expect(text).toBe('');
});

test('3 - uptime shows after creating a session', async () => {
  await window.keyboard.press('Meta+t');
  await window.waitForTimeout(500);
  await expect(window.locator('[data-testid="tab"]')).toHaveCount(1, { timeout: 5000 });

  const text = await window.locator('[data-testid="status-uptime"]').textContent();
  // Should show something like "0s" or "1s"
  expect(text).toMatch(/^\d+s$/);
});

test('4 - uptime updates over time', async () => {
  const before = await window.locator('[data-testid="status-uptime"]').textContent();
  await window.waitForTimeout(2000);
  const after = await window.locator('[data-testid="status-uptime"]').textContent();

  // Both should be valid uptime strings
  expect(before).toMatch(/\d+[smh]/);
  expect(after).toMatch(/\d+[smh]/);

  // The numeric value should have increased (parse the seconds)
  const parseSec = (s) => {
    const m = s.match(/^(\d+)s$/);
    return m ? parseInt(m[1], 10) : -1;
  };
  const beforeSec = parseSec(before);
  const afterSec = parseSec(after);
  if (beforeSec >= 0 && afterSec >= 0) {
    expect(afterSec).toBeGreaterThan(beforeSec);
  }
});

test('5 - uptime clears when tab is closed', async () => {
  await window.keyboard.press('Meta+w');
  await window.waitForTimeout(300);
  await expect(window.locator('[data-testid="tab"]')).toHaveCount(0, { timeout: 3000 });

  const text = await window.locator('[data-testid="status-uptime"]').textContent();
  expect(text).toBe('');
});

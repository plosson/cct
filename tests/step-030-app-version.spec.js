/**
 * Step 030 — App Version in Status Bar
 * Displays the app version from package.json in the status bar.
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');

const appPath = path.resolve(__dirname, '..');
const pkg = require(path.join(appPath, 'package.json'));

let electronApp;
let window;

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [appPath],
    env: { ...process.env, CCT_COMMAND: process.env.SHELL || '/bin/zsh' },
    timeout: 90000,
  });
  window = await electronApp.firstWindow({ timeout: 90000 });
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 15000 });
});

test.afterAll(async () => {
  if (electronApp) await electronApp.close();
});

test('1 - version element exists in status bar', async () => {
  const el = window.locator('[data-testid="status-version"]');
  await expect(el).toBeAttached();
});

test('2 - version matches package.json', async () => {
  // Wait for the async version fetch
  await window.waitForTimeout(500);
  const text = await window.locator('[data-testid="status-version"]').textContent();
  expect(text).toBe(`v${pkg.version}`);
});

test('3 - getVersion IPC returns correct version', async () => {
  const version = await window.evaluate(() => window.electron_api.getVersion());
  expect(version).toBe(pkg.version);
});

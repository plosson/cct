/**
 * Step 013 — Tab Rename via Double-Click
 * Double-click on a tab label enters inline edit mode.
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

  tmpDir = path.join(os.tmpdir(), `cct-test-013-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  await window.evaluate(async (dir) => {
    await window.electron_api.projects.addPath(dir);
    const saved = await window.electron_api.projects.list();
    window._cctReloadProjects(saved);
    window._cctSelectProject(dir);
  }, tmpDir);

  // Create a terminal session
  await window.keyboard.press('Meta+t');
  await window.waitForTimeout(500);
  await expect(window.locator('[data-testid="tab"]')).toHaveCount(1, { timeout: 10000 });
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

test('1 - double-click on tab label shows rename input', async () => {
  const label = window.locator('[data-testid="tab-label"]').first();
  await label.dblclick();
  await window.waitForTimeout(100);

  const input = window.locator('[data-testid="tab-rename-input"]');
  await expect(input).toBeVisible({ timeout: 3000 });
  await expect(input).toBeFocused();
});

test('2 - rename input contains current tab name', async () => {
  const input = window.locator('[data-testid="tab-rename-input"]');
  const value = await input.inputValue();
  expect(value.length).toBeGreaterThan(0);
});

test('3 - pressing Enter confirms the rename', async () => {
  const input = window.locator('[data-testid="tab-rename-input"]');
  await input.fill('My Custom Tab');
  await input.press('Enter');
  await window.waitForTimeout(100);

  // Input should be gone
  await expect(input).not.toBeVisible();

  // Label should show the new name
  const label = window.locator('[data-testid="tab-label"]').first();
  await expect(label).toHaveText('My Custom Tab');
});

test('4 - double-click again shows input with custom name', async () => {
  const label = window.locator('[data-testid="tab-label"]').first();
  await label.dblclick();
  await window.waitForTimeout(100);

  const input = window.locator('[data-testid="tab-rename-input"]');
  await expect(input).toBeVisible();
  const value = await input.inputValue();
  expect(value).toBe('My Custom Tab');
});

test('5 - pressing Escape cancels the rename', async () => {
  const input = window.locator('[data-testid="tab-rename-input"]');
  await input.fill('Should Not Save');
  await input.press('Escape');
  await window.waitForTimeout(100);

  // Input should be gone
  await expect(input).not.toBeVisible();

  // Label should revert to the custom name (not the cancelled value)
  const label = window.locator('[data-testid="tab-label"]').first();
  await expect(label).toHaveText('My Custom Tab');
});

test('6 - blur commits the rename', async () => {
  const label = window.locator('[data-testid="tab-label"]').first();
  await label.dblclick();
  await window.waitForTimeout(100);

  const input = window.locator('[data-testid="tab-rename-input"]');
  await input.fill('Blur Rename');

  // Click elsewhere to blur
  await window.click('.tab-bar');
  await window.waitForTimeout(100);

  await expect(label).toHaveText('Blur Rename');
});

test('7 - empty rename reverts to previous name', async () => {
  const label = window.locator('[data-testid="tab-label"]').first();
  await label.dblclick();
  await window.waitForTimeout(100);

  const input = window.locator('[data-testid="tab-rename-input"]');
  await input.fill('');
  await input.press('Enter');
  await window.waitForTimeout(100);

  // Should revert to previous name
  await expect(label).toHaveText('Blur Rename');
});

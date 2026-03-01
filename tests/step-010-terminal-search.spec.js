/**
 * Step 010 — Terminal Search (Cmd+F)
 * Search within terminal buffer using xterm.js SearchAddon.
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { appPath, launchEnv } = require('./helpers');

let electronApp;
let window;

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [appPath],
    env: launchEnv(),
  });
  window = await electronApp.firstWindow();
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 });

  // Create a temp project, select it, and create a terminal session
  const tmpDir = path.join(os.tmpdir(), `cct-test-010-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  await window.evaluate(async (dir) => {
    await window.electron_api.projects.addPath(dir);
    const saved = await window.electron_api.projects.list();
    window._cctReloadProjects(saved);
    window._cctSelectProject(dir);
  }, tmpDir);

  // Create a terminal session
  await window.keyboard.press('Meta+t');
  await window.waitForSelector('.xterm', { timeout: 10000 });

  // Type some searchable content
  const textarea = window.locator('.terminal-panel.active .xterm-helper-textarea');
  await textarea.pressSequentially('echo SEARCH_TARGET_UNIQUE_42', { delay: 20 });
  await window.keyboard.press('Enter');

  // Wait for output
  await expect(async () => {
    const text = await window.evaluate(() => window._cctGetBufferText());
    expect(text).toContain('SEARCH_TARGET_UNIQUE_42');
  }).toPass({ timeout: 5000 });
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

test('1 - Cmd+F opens the search bar', async () => {
  await window.keyboard.press('Meta+f');
  await window.waitForTimeout(200);

  const searchBar = window.locator('[data-testid="search-bar"]');
  await expect(searchBar).toBeVisible({ timeout: 3000 });

  const input = window.locator('[data-testid="search-bar-input"]');
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
});

test('2 - typing in search finds text in buffer', async () => {
  const input = window.locator('[data-testid="search-bar-input"]');
  await input.fill('SEARCH_TARGET');
  await window.waitForTimeout(300);

  // Should NOT show "No results"
  const count = window.locator('[data-testid="search-bar-count"]');
  const countText = await count.textContent();
  expect(countText).not.toBe('No results');
});

test('3 - searching for non-existent text shows "No results"', async () => {
  const input = window.locator('[data-testid="search-bar-input"]');
  await input.fill('NONEXISTENT_STRING_XYZ');
  await window.waitForTimeout(300);

  const count = window.locator('[data-testid="search-bar-count"]');
  await expect(count).toHaveText('No results', { timeout: 3000 });
});

test('4 - Enter navigates to next match', async () => {
  const input = window.locator('[data-testid="search-bar-input"]');
  await input.fill('SEARCH_TARGET');
  await window.waitForTimeout(200);

  // Press Enter to find next
  await input.press('Enter');
  await window.waitForTimeout(200);

  // Should still not show "No results"
  const count = window.locator('[data-testid="search-bar-count"]');
  const countText = await count.textContent();
  expect(countText).not.toBe('No results');
});

test('5 - Escape closes the search bar', async () => {
  const input = window.locator('[data-testid="search-bar-input"]');
  await input.press('Escape');
  await window.waitForTimeout(200);

  const searchBar = window.locator('[data-testid="search-bar"]');
  await expect(searchBar).not.toBeVisible();
});

test('6 - search bar closes and terminal regains focus', async () => {
  // Open and close search
  await window.keyboard.press('Meta+f');
  await window.waitForTimeout(200);

  const input = window.locator('[data-testid="search-bar-input"]');
  await input.press('Escape');
  await window.waitForTimeout(200);

  // Terminal should have focus
  const termFocused = await window.evaluate(() => {
    const textarea = document.querySelector('.terminal-panel.active .xterm-helper-textarea');
    return document.activeElement === textarea;
  });
  expect(termFocused).toBe(true);
});

test('7 - prev/next buttons navigate matches', async () => {
  await window.keyboard.press('Meta+f');
  await window.waitForTimeout(200);

  const input = window.locator('[data-testid="search-bar-input"]');
  await input.fill('SEARCH_TARGET');
  await window.waitForTimeout(200);

  // Click next
  const nextBtn = window.locator('[data-testid="search-bar-next"]');
  await nextBtn.click();
  await window.waitForTimeout(100);

  // Click prev
  const prevBtn = window.locator('[data-testid="search-bar-prev"]');
  await prevBtn.click();
  await window.waitForTimeout(100);

  // Should still have results
  const count = window.locator('[data-testid="search-bar-count"]');
  const countText = await count.textContent();
  expect(countText).not.toBe('No results');

  // Close
  await input.press('Escape');
});

test('8 - Cmd+F again focuses existing search bar', async () => {
  // Open search
  await window.keyboard.press('Meta+f');
  await window.waitForTimeout(200);

  const input = window.locator('[data-testid="search-bar-input"]');
  await input.fill('hello');
  await window.waitForTimeout(100);

  // Click somewhere else to unfocus
  await window.click('.tab-bar');
  await window.waitForTimeout(100);

  // Press Cmd+F again — should refocus existing search bar
  await window.keyboard.press('Meta+f');
  await window.waitForTimeout(200);

  await expect(input).toBeFocused();

  // Text should still be there and selected
  const value = await input.inputValue();
  expect(value).toBe('hello');

  // Close
  await input.press('Escape');
});

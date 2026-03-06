/**
 * Step 050 — UI polish round 2
 * Verifies:
 *   - Settings opens from empty project state and panel is visible
 *   - Dropdown focus border color is not orange/accent
 *   - Screenshot comparison of settings panel
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { appPath, launchEnv, closeApp } = require('./helpers');

let electronApp;
let window;
let env;
let projectDir;

test.beforeAll(async () => {
  env = launchEnv();
  fs.mkdirSync(env.CLAUDIU_USER_DATA, { recursive: true });

  // Pre-seed a project but don't create any sessions (empty state)
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudiu-test-ui-polish-'));
  const projectsFile = path.join(env.CLAUDIU_USER_DATA, 'projects.json');
  fs.writeFileSync(projectsFile, JSON.stringify({
    projects: [{ path: projectDir, name: path.basename(projectDir) }],
  }));

  electronApp = await electron.launch({
    args: [appPath],
    env,
  });
  window = await electronApp.firstWindow();
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 15000 });
  await window.waitForTimeout(500);
});

test.afterAll(async () => {
  await closeApp(electronApp);
  try { fs.rmSync(projectDir, { recursive: true }); } catch {}
});

test('Settings opens from empty state via Cmd+,', async () => {
  // Verify we are in the empty state (no sessions open)
  const emptyState = window.locator('[data-testid="empty-state"]');
  await expect(emptyState).toBeVisible({ timeout: 5000 });

  // Press Cmd+, to open settings
  await window.keyboard.press('Meta+,');
  await window.waitForTimeout(500);

  // Settings panel should be visible
  const settingsPanel = window.locator('.settings-tab-panel');
  await expect(settingsPanel).toBeVisible({ timeout: 5000 });

  // The empty state should be hidden
  await expect(emptyState).not.toBeVisible({ timeout: 5000 });

  // Settings content should be rendered
  const settingsSection = window.locator('.settings-section');
  await expect(settingsSection).toBeVisible();
});

test('Dropdown focus border is not orange', async () => {
  // Find a select in the settings panel
  const select = window.locator('.settings-select').first();
  await expect(select).toBeVisible({ timeout: 5000 });

  // Focus the select
  await select.focus();
  await window.waitForTimeout(200);

  // Check the border color — should not be the orange accent
  const borderColor = await select.evaluate(el => {
    return globalThis.getComputedStyle(el).borderColor;
  });

  // Orange accent is typically rgb(255, 149, 0) or similar — should NOT match
  expect(borderColor).not.toMatch(/rgb\(255,\s*149,\s*0\)/);
  expect(borderColor).not.toMatch(/rgb\(255,\s*165,\s*0\)/);
});

test('Screenshot of settings panel', async () => {
  const settingsPanel = window.locator('.settings-tab-panel');
  await expect(settingsPanel).toBeVisible({ timeout: 5000 });

  const screenshotsDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

  await settingsPanel.screenshot({
    path: path.join(screenshotsDir, 'settings-panel-polished.png'),
  });
});

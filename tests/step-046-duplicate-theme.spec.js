/**
 * Step 046 — Duplicate Theme UI Test
 * Tests that the "Duplicate" button in Sound settings works end-to-end.
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { appPath, launchEnv } = require('./helpers');

let electronApp;
let window;
let env;
let projectDir;

test.beforeAll(async () => {
  env = launchEnv();
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudiu-test-project-'));

  fs.mkdirSync(env.CLAUDIU_USER_DATA, { recursive: true });
  fs.writeFileSync(
    path.join(env.CLAUDIU_USER_DATA, 'projects.json'),
    JSON.stringify({ projects: [{ path: projectDir, name: path.basename(projectDir) }] })
  );
  // Set soundTheme to 'default' so the Duplicate button is enabled
  fs.writeFileSync(
    path.join(env.CLAUDIU_USER_DATA, 'config.json'),
    JSON.stringify({ soundTheme: 'default' })
  );

  electronApp = await electron.launch({
    args: [appPath],
    env: { ...env, CLAUDIU_HEADLESS: '0' },
    timeout: 90000,
  });
  window = await electronApp.firstWindow({ timeout: 90000 });
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 15000 });
  await window.waitForTimeout(500);
});

test.afterAll(async () => {
  if (electronApp) await electronApp.close();
  try { fs.rmSync(projectDir, { recursive: true }); } catch {}
});

test('Duplicate theme via UI button', async () => {
  // Open settings → Sounds tab
  await window.keyboard.press('Meta+,');
  await window.waitForSelector('[data-testid="settings-nav-sounds"]', { timeout: 5000 });
  await window.locator('[data-testid="settings-nav-sounds"]').click();
  await window.waitForTimeout(500);

  // Verify dropdown has 'default' selected
  const selectedValue = await window.locator('[data-testid="settings-sound-theme-select"]').inputValue();
  expect(selectedValue).toBe('default');

  // Find the Duplicate button and verify it's enabled
  const duplicateBtn = window.locator('button:has-text("Duplicate")');
  await expect(duplicateBtn).toBeVisible();
  await expect(duplicateBtn).toBeEnabled();

  // Click Duplicate — this opens the prompt overlay
  await duplicateBtn.click();

  // Wait for the prompt overlay to appear
  const promptInput = window.locator('[data-testid="prompt-input"]');
  await expect(promptInput).toBeVisible({ timeout: 3000 });

  // Clear the default value and type the new name
  await promptInput.fill('My Duplicate');

  // Press Enter to confirm
  await promptInput.press('Enter');

  // Wait for the UI to re-render with the new theme selected
  await window.waitForTimeout(1000);

  // The dropdown should now show the duplicated theme
  const newValue = await window.locator('[data-testid="settings-sound-theme-select"]').inputValue();
  expect(newValue).toBe('my-duplicate');

  // Verify the theme exists on disk
  const themesDir = path.join(env.CLAUDIU_USER_DATA, 'themes');
  const dupDir = path.join(themesDir, 'my-duplicate');
  expect(fs.existsSync(dupDir)).toBe(true);

  const themeJson = JSON.parse(fs.readFileSync(path.join(dupDir, 'theme.json'), 'utf8'));
  expect(themeJson.name).toBe('My Duplicate');
  expect(themeJson.builtIn).toBeUndefined();
});

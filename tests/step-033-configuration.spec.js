/**
 * Step 033 — Configuration Screen
 * Global and per-project settings for claude and terminal commands.
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
  // Create a temp project directory
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudiu-test-project-'));

  // Pre-seed a project so we have something to configure
  const projectsFile = path.join(env.CLAUDIU_USER_DATA, 'projects.json');
  fs.mkdirSync(env.CLAUDIU_USER_DATA, { recursive: true });
  fs.writeFileSync(projectsFile, JSON.stringify({
    projects: [{ path: projectDir, name: path.basename(projectDir) }]
  }));

  electronApp = await electron.launch({
    args: [appPath],
    env,
    timeout: 90000,
  });
  window = await electronApp.firstWindow({ timeout: 90000 });
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 15000 });
  // Wait for project to load
  await window.waitForTimeout(500);
});

test.afterAll(async () => {
  if (electronApp) await electronApp.close();
  // Clean up temp dirs
  try { fs.rmSync(projectDir, { recursive: true }); } catch {}
});

test('1 - Cmd+, opens settings overlay', async () => {
  await window.keyboard.press('Meta+,');
  const overlay = window.locator('[data-testid="settings-overlay"]');
  await expect(overlay).toBeAttached({ timeout: 3000 });
});

test('2 - settings has Global and Project tabs', async () => {
  const globalTab = window.locator('[data-testid="settings-tab-global"]');
  const projectTab = window.locator('[data-testid="settings-tab-project"]');
  await expect(globalTab).toBeAttached();
  await expect(projectTab).toBeAttached();
  // Global tab is active by default
  const globalClass = await globalTab.getAttribute('class');
  expect(globalClass).toContain('active');
});

test('3 - settings has inputs for claudeCommand and terminalCommand', async () => {
  const claudeInput = window.locator('[data-testid="settings-input-claudeCommand"]');
  const terminalInput = window.locator('[data-testid="settings-input-terminalCommand"]');
  await expect(claudeInput).toBeAttached();
  await expect(terminalInput).toBeAttached();
});

test('4 - default placeholder shows "claude" for claudeCommand', async () => {
  const claudeInput = window.locator('[data-testid="settings-input-claudeCommand"]');
  const placeholder = await claudeInput.getAttribute('placeholder');
  expect(placeholder).toBe('claude');
});

test('5 - Escape closes settings overlay', async () => {
  await window.keyboard.press('Escape');
  const overlay = window.locator('[data-testid="settings-overlay"]');
  await expect(overlay).not.toBeAttached({ timeout: 3000 });
});

test('6 - saving global config persists to config.json', async () => {
  await window.keyboard.press('Meta+,');
  await window.waitForSelector('[data-testid="settings-overlay"]', { timeout: 3000 });

  // Type a custom claude command
  const claudeInput = window.locator('[data-testid="settings-input-claudeCommand"]');
  await claudeInput.fill('my-custom-claude');

  // Click save
  await window.locator('[data-testid="settings-save-btn"]').click();

  // Verify settings overlay is closed
  await expect(window.locator('[data-testid="settings-overlay"]')).not.toBeAttached({ timeout: 3000 });

  // Verify config.json was written
  await window.waitForTimeout(300);
  const configPath = path.join(env.CLAUDIU_USER_DATA, 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  expect(config.claudeCommand).toBe('my-custom-claude');
});

test('7 - re-opening settings shows saved value', async () => {
  await window.keyboard.press('Meta+,');
  await window.waitForSelector('[data-testid="settings-overlay"]', { timeout: 3000 });

  const claudeInput = window.locator('[data-testid="settings-input-claudeCommand"]');
  const value = await claudeInput.inputValue();
  expect(value).toBe('my-custom-claude');

  await window.keyboard.press('Escape');
});

test('8 - project tab shows project-specific settings', async () => {
  await window.keyboard.press('Meta+,');
  await window.waitForSelector('[data-testid="settings-overlay"]', { timeout: 3000 });

  // Switch to project tab
  await window.locator('[data-testid="settings-tab-project"]').click();

  // Claude command input should be empty (no project override)
  const claudeInput = window.locator('[data-testid="settings-input-claudeCommand"]');
  const value = await claudeInput.inputValue();
  expect(value).toBe('');

  // Placeholder should show the global value
  const placeholder = await claudeInput.getAttribute('placeholder');
  expect(placeholder).toBe('my-custom-claude');

  await window.keyboard.press('Escape');
});

test('9 - saving project config persists to .claudiu/config.json', async () => {
  await window.keyboard.press('Meta+,');
  await window.waitForSelector('[data-testid="settings-overlay"]', { timeout: 3000 });

  // Switch to project tab
  await window.locator('[data-testid="settings-tab-project"]').click();

  // Set a project-specific value
  const claudeInput = window.locator('[data-testid="settings-input-claudeCommand"]');
  await claudeInput.fill('project-claude');

  await window.locator('[data-testid="settings-save-btn"]').click();
  await expect(window.locator('[data-testid="settings-overlay"]')).not.toBeAttached({ timeout: 3000 });

  // Verify .claudiu/config.json in project directory
  await window.waitForTimeout(300);
  const configPath = path.join(projectDir, '.claudiu', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  expect(config.claudeCommand).toBe('project-claude');
});

test('10 - config-resolve returns project override over global', async () => {
  const resolved = await window.evaluate(() =>
    window.electron_api.appConfig.resolve('claudeCommand', window._claudiuSelectedProject())
  );
  expect(resolved).toBe('project-claude');
});

test('11 - config-resolve falls back to global when no project override', async () => {
  const resolved = await window.evaluate(() =>
    window.electron_api.appConfig.resolve('terminalCommand', window._claudiuSelectedProject())
  );
  // terminalCommand has no project or global override, should return schema default (empty string)
  expect(resolved).toBe('');
});

test('12 - cancel button closes without saving', async () => {
  await window.keyboard.press('Meta+,');
  await window.waitForSelector('[data-testid="settings-overlay"]', { timeout: 3000 });

  const claudeInput = window.locator('[data-testid="settings-input-claudeCommand"]');
  await claudeInput.fill('should-not-persist');

  await window.locator('[data-testid="settings-cancel-btn"]').click();
  await expect(window.locator('[data-testid="settings-overlay"]')).not.toBeAttached({ timeout: 3000 });

  // Verify global config still has old value
  const config = JSON.parse(fs.readFileSync(path.join(env.CLAUDIU_USER_DATA, 'config.json'), 'utf8'));
  expect(config.claudeCommand).toBe('my-custom-claude');
});

test('13 - clearing a global config value removes it from config.json', async () => {
  // Precondition: claudeCommand is set from test 6
  const configPath = path.join(env.CLAUDIU_USER_DATA, 'config.json');
  let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  expect(config.claudeCommand).toBe('my-custom-claude');

  // Open settings, clear the value, save
  await window.keyboard.press('Meta+,');
  await window.waitForSelector('[data-testid="settings-overlay"]', { timeout: 3000 });

  const claudeInput = window.locator('[data-testid="settings-input-claudeCommand"]');
  await claudeInput.fill('');

  await window.locator('[data-testid="settings-save-btn"]').click();
  await expect(window.locator('[data-testid="settings-overlay"]')).not.toBeAttached({ timeout: 3000 });

  // Verify the key is gone from config.json
  await window.waitForTimeout(300);
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  expect(config).not.toHaveProperty('claudeCommand');
});

test('14 - config schema is available via IPC', async () => {
  const schema = await window.evaluate(() => window.electron_api.appConfig.getSchema());
  expect(schema).toHaveProperty('claudeCommand');
  expect(schema).toHaveProperty('terminalCommand');
  expect(schema.claudeCommand.label).toBe('Claude Code command');
});

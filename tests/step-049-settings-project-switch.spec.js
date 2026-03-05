/**
 * Step 049 — Settings tab adapts when switching projects
 * Verifies that:
 *   - Only one settings tab exists at a time
 *   - Settings tab remains visible when switching projects
 *   - The project scope button updates to show the new project name
 *   - Project-specific config is shown for the newly selected project
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { appPath, launchEnv } = require('./helpers');

let electronApp;
let window;
let env;
const projectDirs = [];

test.beforeAll(async () => {
  env = launchEnv();
  fs.mkdirSync(env.CLAUDIU_USER_DATA, { recursive: true });

  // Create 3 temp project directories
  for (let i = 0; i < 3; i++) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `claudiu-settings-switch-${i}-`));
    projectDirs.push(dir);
  }

  // Pre-seed the 3 projects
  const projectsFile = path.join(env.CLAUDIU_USER_DATA, 'projects.json');
  fs.writeFileSync(projectsFile, JSON.stringify({
    projects: projectDirs.map(dir => ({ path: dir, name: path.basename(dir) })),
  }));

  // Pre-seed project-specific config for project 1
  const proj1ConfigDir = path.join(projectDirs[1], '.claudiu');
  fs.mkdirSync(proj1ConfigDir, { recursive: true });
  fs.writeFileSync(path.join(proj1ConfigDir, 'config.json'), JSON.stringify({
    claudeCommand: 'project-1-claude',
  }));

  // Pre-seed project-specific config for project 2
  const proj2ConfigDir = path.join(projectDirs[2], '.claudiu');
  fs.mkdirSync(proj2ConfigDir, { recursive: true });
  fs.writeFileSync(path.join(proj2ConfigDir, 'config.json'), JSON.stringify({
    claudeCommand: 'project-2-claude',
  }));

  electronApp = await electron.launch({
    args: [appPath],
    env,
    timeout: 90000,
  });
  window = await electronApp.firstWindow({ timeout: 90000 });
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 15000 });
  await window.waitForTimeout(500);
});

test.afterAll(async () => {
  if (electronApp) await electronApp.close();
  for (const dir of projectDirs) {
    try { fs.rmSync(dir, { recursive: true }); } catch {}
  }
});

test('1 - three projects appear in sidebar', async () => {
  const items = window.locator('[data-testid="project-item"]');
  await expect(items).toHaveCount(3, { timeout: 5000 });
});

test('2 - create terminals in each project', async () => {
  // Select project 0, create a terminal
  await window.locator('[data-testid="project-item"]').nth(0).click();
  await window.waitForTimeout(300);
  await window.keyboard.press('Meta+t');
  await window.waitForTimeout(1500);

  // Select project 1, create two terminals
  await window.locator('[data-testid="project-item"]').nth(1).click();
  await window.waitForTimeout(300);
  await window.keyboard.press('Meta+t');
  await window.waitForTimeout(1500);
  await window.keyboard.press('Meta+t');
  await window.waitForTimeout(1500);

  // Select project 2, create a terminal
  await window.locator('[data-testid="project-item"]').nth(2).click();
  await window.waitForTimeout(300);
  await window.keyboard.press('Meta+t');
  await window.waitForTimeout(1500);

  // Verify session counts
  const count0 = window.locator('[data-testid="project-item"]').nth(0).locator('[data-testid="session-count"]');
  const count1 = window.locator('[data-testid="project-item"]').nth(1).locator('[data-testid="session-count"]');
  const count2 = window.locator('[data-testid="project-item"]').nth(2).locator('[data-testid="session-count"]');
  await expect(count0).toHaveText('1', { timeout: 5000 });
  await expect(count1).toHaveText('2', { timeout: 5000 });
  await expect(count2).toHaveText('1', { timeout: 5000 });
});

test('3 - open settings tab while on project 2', async () => {
  // Ensure project 2 is selected
  await window.locator('[data-testid="project-item"]').nth(2).click();
  await window.waitForTimeout(300);

  await window.keyboard.press('Meta+,');
  const nav = window.locator('[data-testid="settings-nav-general"]');
  await expect(nav).toBeAttached({ timeout: 3000 });

  // Settings tab should be visible
  const settingsTab = window.locator('.tab-item .tab-label:text-is("Settings")');
  await expect(settingsTab).toBeVisible();
});

test('4 - project scope button shows project 2 name', async () => {
  const scopeProjectBtn = window.locator('[data-testid="settings-scope-project"]');
  const text = await scopeProjectBtn.textContent();
  expect(text).toContain(path.basename(projectDirs[2]));
});

test('5 - switching to project 1 keeps settings tab in DOM', async () => {
  await window.locator('[data-testid="project-item"]').nth(1).click();
  await window.waitForTimeout(500);

  // Settings tab element should still exist (visible = not display:none)
  const settingsTab = window.locator('.tab-item .tab-label:text-is("Settings")');
  await expect(settingsTab).toBeAttached({ timeout: 3000 });

  // Still only one settings tab
  await expect(settingsTab).toHaveCount(1);
});

test('6 - clicking settings tab re-activates it and shows updated project name', async () => {
  // Click the settings tab to activate it
  const settingsTabItem = window.locator('.tab-item .tab-label:text-is("Settings")').locator('..');
  await settingsTabItem.click();
  await window.waitForTimeout(300);

  // Settings nav should be present (panel is active)
  const nav = window.locator('[data-testid="settings-nav-general"]');
  await expect(nav).toBeAttached({ timeout: 3000 });

  // Scope button should show project 1 name
  const scopeProjectBtn = window.locator('[data-testid="settings-scope-project"]');
  const text = await scopeProjectBtn.textContent();
  expect(text).toContain(path.basename(projectDirs[1]));
});

test('7 - project scope shows project 1 config value', async () => {
  // Switch to project scope
  await window.locator('[data-testid="settings-scope-project"]').click();
  await window.waitForTimeout(300);

  const claudeInput = window.locator('[data-testid="settings-input-claudeCommand"]');
  const value = await claudeInput.inputValue();
  expect(value).toBe('project-1-claude');
});

test('8 - switching to project 0 and activating settings shows no override', async () => {
  await window.locator('[data-testid="project-item"]').nth(0).click();
  await window.waitForTimeout(500);

  // Click settings tab to re-activate it
  const settingsTabItem = window.locator('.tab-item .tab-label:text-is("Settings")').locator('..');
  await settingsTabItem.click();
  await window.waitForTimeout(300);

  // Scope button should show project 0 name
  const scopeProjectBtn = window.locator('[data-testid="settings-scope-project"]');
  const text = await scopeProjectBtn.textContent();
  expect(text).toContain(path.basename(projectDirs[0]));

  // Switch to project scope — project 0 has no config override
  await scopeProjectBtn.click();
  await window.waitForTimeout(300);

  const claudeInput = window.locator('[data-testid="settings-input-claudeCommand"]');
  const value = await claudeInput.inputValue();
  expect(value).toBe('');
});

test('9 - switching back to project 2 and activating settings shows project 2 config', async () => {
  await window.locator('[data-testid="project-item"]').nth(2).click();
  await window.waitForTimeout(500);

  // Click settings tab to re-activate it
  const settingsTabItem = window.locator('.tab-item .tab-label:text-is("Settings")').locator('..');
  await settingsTabItem.click();
  await window.waitForTimeout(300);

  // Scope button should show project 2 name
  const scopeProjectBtn = window.locator('[data-testid="settings-scope-project"]');
  const text = await scopeProjectBtn.textContent();
  expect(text).toContain(path.basename(projectDirs[2]));

  // Switch to project scope
  await scopeProjectBtn.click();
  await window.waitForTimeout(300);

  const claudeInput = window.locator('[data-testid="settings-input-claudeCommand"]');
  const value = await claudeInput.inputValue();
  expect(value).toBe('project-2-claude');
});

test('10 - only one settings tab exists after multiple project switches', async () => {
  // Rapid switches
  await window.locator('[data-testid="project-item"]').nth(0).click();
  await window.waitForTimeout(200);
  await window.locator('[data-testid="project-item"]').nth(1).click();
  await window.waitForTimeout(200);
  await window.locator('[data-testid="project-item"]').nth(2).click();
  await window.waitForTimeout(200);

  const settingsTabs = window.locator('.tab-item .tab-label:text-is("Settings")');
  await expect(settingsTabs).toHaveCount(1);
});

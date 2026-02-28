/**
 * Step 006 — Sidebar with Projects & Sessions
 * Validates sidebar UI, project CRUD, session scoping, and persistence.
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const appPath = path.resolve(__dirname, '..');

let electronApp;
let window;

// Temp dirs created during tests (cleaned up in afterAll)
const tmpDirs = [];

test.beforeAll(async () => {
  electronApp = await electron.launch({ args: [appPath] });
  window = await electronApp.firstWindow();
  await window.waitForSelector('.xterm', { timeout: 10000 });

  // Clean any leftover projects via IPC so we start with a clean slate
  const existing = await window.evaluate(() => window.electron_api.projects.list());
  for (const p of existing) {
    await window.evaluate((path) => window.electron_api.projects.remove(path), p.path);
  }
  await window.evaluate(async () => {
    const saved = await window.electron_api.projects.list();
    window._cctReloadProjects(saved);
  });
});

test.afterAll(async () => {
  if (electronApp) {
    // Clean up projects via IPC
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

/** Helper: create a temp dir and add it as a project */
async function addTempProject(suffix = '') {
  const tmpDir = path.join(os.tmpdir(), `cct-test-project${suffix}-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  tmpDirs.push(tmpDir);

  // Add via IPC (bypasses native dialog) and refresh sidebar
  await window.evaluate(async (dir) => {
    await window.electron_api.projects.addPath(dir);
    const saved = await window.electron_api.projects.list();
    window._cctReloadProjects(saved);
  }, tmpDir);

  return tmpDir;
}

test('1 - sidebar is visible', async () => {
  const sidebar = window.locator('[data-testid="sidebar"]');
  await expect(sidebar).toBeVisible({ timeout: 5000 });
});

test('2 - sidebar initially shows empty project list', async () => {
  const items = window.locator('[data-testid="project-item"]');
  await expect(items).toHaveCount(0);
});

test('3 - add a project and it appears in sidebar', async () => {
  await addTempProject('');

  const items = window.locator('[data-testid="project-item"]');
  await expect(items).toHaveCount(1, { timeout: 5000 });
});

test('4 - click project creates a new session tab in that folder', async () => {
  const projectItem = window.locator('[data-testid="project-item"]').first();
  const projectPath = await projectItem.getAttribute('data-project-path');

  await projectItem.click();
  await window.waitForTimeout(1000);

  // A new tab should exist (initial session + this one)
  const tabs = window.locator('[data-testid="tab"]');
  const tabCount = await tabs.count();
  expect(tabCount).toBeGreaterThanOrEqual(2);

  // Verify terminal working directory
  const textarea = window.locator('.terminal-panel.active .xterm-helper-textarea');
  await textarea.pressSequentially('pwd', { delay: 30 });
  await window.keyboard.press('Enter');

  await expect(async () => {
    const text = await window.evaluate(() => window._cctGetBufferText());
    expect(text).toContain(projectPath);
  }).toPass({ timeout: 5000 });
});

test('5 - project shows 1 active session', async () => {
  const count = window.locator('[data-testid="project-item"]').first()
    .locator('[data-testid="session-count"]');
  await expect(count).toHaveText('1', { timeout: 5000 });
});

test('6 - add a second project, sidebar shows both', async () => {
  await addTempProject('-2');

  const items = window.locator('[data-testid="project-item"]');
  await expect(items).toHaveCount(2, { timeout: 5000 });
});

test('7 - second project shows 0 sessions', async () => {
  const count = window.locator('[data-testid="project-item"]').nth(1)
    .locator('[data-testid="session-count"]');
  await expect(count).toHaveText('0', { timeout: 5000 });
});

test('8 - create second session under first project updates count to 2', async () => {
  const projectItem = window.locator('[data-testid="project-item"]').first();
  await projectItem.click();
  await window.waitForTimeout(1000);

  const count = projectItem.locator('[data-testid="session-count"]');
  await expect(count).toHaveText('2', { timeout: 5000 });
});

test('9 - remove project closes its sessions and removes from sidebar', async () => {
  const tabsBefore = await window.locator('[data-testid="tab"]').count();

  // Remove the first project (which has 2 sessions)
  const removeBtn = window.locator('[data-testid="project-item"]').first()
    .locator('[data-testid="remove-project-btn"]');
  await removeBtn.click();
  await window.waitForTimeout(500);

  // Project removed from sidebar
  const items = window.locator('[data-testid="project-item"]');
  await expect(items).toHaveCount(1, { timeout: 5000 });

  // Tabs decreased (2 project sessions closed)
  await expect(async () => {
    const tabsAfter = await window.locator('[data-testid="tab"]').count();
    expect(tabsAfter).toBe(tabsBefore - 2);
  }).toPass({ timeout: 5000 });
});

test('10 - projects persist across app restart', async () => {
  // We still have 1 project from test 6
  const projectsBefore = await window.evaluate(async () => {
    return await window.electron_api.projects.list();
  });
  expect(projectsBefore.length).toBe(1);

  // Restart the app
  await electronApp.close();
  electronApp = await electron.launch({ args: [appPath] });
  window = await electronApp.firstWindow();
  await window.waitForSelector('.xterm', { timeout: 10000 });

  // Projects should still be there
  const items = window.locator('[data-testid="project-item"]');
  await expect(items).toHaveCount(1, { timeout: 5000 });
});

test('11 - config file contains expected JSON entries', async () => {
  const configPath = await window.evaluate(() => window.electron_api.projects.configPath());
  const configContent = fs.readFileSync(configPath, 'utf8');

  const config = JSON.parse(configContent);
  expect(config).toHaveProperty('projects');
  expect(Array.isArray(config.projects)).toBe(true);
  expect(config.projects.length).toBe(1);
  expect(config.projects[0]).toHaveProperty('path');
  expect(config.projects[0]).toHaveProperty('name');
});

test('12 - all step 005 tab behaviors still work', async () => {
  // New tab via button
  await window.click('[data-testid="new-tab-btn"]');
  await window.waitForTimeout(500);
  const tabs = window.locator('[data-testid="tab"]');
  const countBefore = await tabs.count();
  expect(countBefore).toBeGreaterThanOrEqual(2);

  // Close via close button
  const closeBtn = tabs.last().locator('[data-testid="tab-close"]');
  await closeBtn.click();
  await window.waitForTimeout(500);
  const countAfter = await tabs.count();
  expect(countAfter).toBe(countBefore - 1);
});

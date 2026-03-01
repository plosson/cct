/**
 * Step 009 — Status Bar
 * Bottom status bar shows project name, session type, and terminal dimensions.
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

  // Clean and add a project
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

async function addTempProject(suffix = '') {
  const tmpDir = path.join(os.tmpdir(), `cct-test-status${suffix}-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  await window.evaluate(async (dir) => {
    await window.electron_api.projects.addPath(dir);
    const saved = await window.electron_api.projects.list();
    window._cctReloadProjects(saved);
  }, tmpDir);
  return tmpDir;
}

test('1 - status bar is visible', async () => {
  const statusBar = window.locator('[data-testid="status-bar"]');
  await expect(statusBar).toBeVisible({ timeout: 3000 });
});

test('2 - status bar is initially empty (no project selected)', async () => {
  const project = window.locator('[data-testid="status-project"]');
  const sessionType = window.locator('[data-testid="status-session-type"]');
  const termSize = window.locator('[data-testid="status-terminal-size"]');

  await expect(project).toHaveText('');
  await expect(sessionType).toHaveText('');
  await expect(termSize).toHaveText('');
});

test('3 - selecting project shows project name in status bar', async () => {
  const tmpDir = await addTempProject('');
  const projectName = path.basename(tmpDir);

  // Select the project
  const projectItem = window.locator('[data-testid="project-item"]').first();
  await projectItem.click();
  await window.waitForTimeout(300);

  const statusProject = window.locator('[data-testid="status-project"]');
  await expect(statusProject).toHaveText(projectName, { timeout: 3000 });
});

test('4 - creating a session shows session type and terminal size', async () => {
  // Create a session
  await window.click('[data-testid="new-tab-btn"]');
  await window.waitForSelector('.xterm', { timeout: 10000 });

  // Session type should show "Claude"
  const sessionType = window.locator('[data-testid="status-session-type"]');
  await expect(sessionType).toHaveText('Claude', { timeout: 3000 });

  // Terminal size should show dimensions (e.g., "80×24")
  const termSize = window.locator('[data-testid="status-terminal-size"]');
  await expect(async () => {
    const text = await termSize.textContent();
    expect(text).toMatch(/\d+\u00d7\d+/);
  }).toPass({ timeout: 3000 });
});

test('5 - terminal session shows "Terminal" in status bar', async () => {
  // Create a terminal session
  await window.keyboard.press('Meta+t');
  await window.waitForTimeout(500);

  const sessionType = window.locator('[data-testid="status-session-type"]');
  await expect(sessionType).toHaveText('Terminal', { timeout: 3000 });
});

test('6 - closing all sessions clears session info from status bar', async () => {
  // Close all tabs
  while (await window.locator('[data-testid="tab"]').count() > 0) {
    await window.click('[data-testid="tab"] [data-testid="tab-close"]');
    await window.waitForTimeout(300);
  }

  const sessionType = window.locator('[data-testid="status-session-type"]');
  const termSize = window.locator('[data-testid="status-terminal-size"]');

  await expect(sessionType).toHaveText('', { timeout: 3000 });
  await expect(termSize).toHaveText('', { timeout: 3000 });
});

test('7 - project name persists in status bar after switching tabs', async () => {
  // Create two sessions
  await window.click('[data-testid="new-tab-btn"]');
  await window.waitForSelector('.xterm', { timeout: 10000 });
  await window.keyboard.press('Meta+t');
  await window.waitForTimeout(500);

  const tabs = window.locator('[data-testid="tab"]');
  await expect(tabs).toHaveCount(2, { timeout: 5000 });

  // Switch tabs
  await tabs.first().click();
  await window.waitForTimeout(200);

  // Project name should still be visible
  const statusProject = window.locator('[data-testid="status-project"]');
  const text = await statusProject.textContent();
  expect(text.length).toBeGreaterThan(0);
});

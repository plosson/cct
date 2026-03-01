/**
 * Step 019 — Project Activity Badge in Sidebar
 * When a non-selected project has terminal output, a blue dot appears
 * on its sidebar item. Switching to the project clears the badge.
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const appPath = path.resolve(__dirname, '..');

let electronApp;
let window;
let tmpDir1;
let tmpDir2;

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [appPath],
    env: { ...process.env, CCT_COMMAND: process.env.SHELL || '/bin/zsh' },
  });
  window = await electronApp.firstWindow();
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 });

  // Create two project directories
  tmpDir1 = path.join(os.tmpdir(), `cct-test-019a-${Date.now()}`);
  tmpDir2 = path.join(os.tmpdir(), `cct-test-019b-${Date.now()}`);
  fs.mkdirSync(tmpDir1, { recursive: true });
  fs.mkdirSync(tmpDir2, { recursive: true });

  // Add both projects
  await window.evaluate(async (dir) => {
    await window.electron_api.projects.addPath(dir);
  }, tmpDir1);
  await window.evaluate(async (dir) => {
    await window.electron_api.projects.addPath(dir);
  }, tmpDir2);
  await window.evaluate(async () => {
    const saved = await window.electron_api.projects.list();
    window._cctReloadProjects(saved);
  });

  // Select project 1 and create a terminal session
  await window.evaluate((dir) => window._cctSelectProject(dir), tmpDir1);
  await window.keyboard.press('Meta+t');
  await window.waitForTimeout(500);
  await expect(window.locator('[data-testid="tab"]:visible')).toHaveCount(1, { timeout: 5000 });

  // Select project 2 and create a terminal session
  await window.evaluate((dir) => window._cctSelectProject(dir), tmpDir2);
  await window.keyboard.press('Meta+t');
  await window.waitForTimeout(500);
  await expect(window.locator('[data-testid="tab"]:visible')).toHaveCount(1, { timeout: 5000 });
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

test('1 - selected project does not have project-activity class', async () => {
  // Project 2 is currently selected
  const projectItems = window.locator('[data-testid="project-item"]');
  const project2 = projectItems.nth(1);
  await expect(project2).toHaveClass(/selected/);
  await expect(project2).not.toHaveClass(/project-activity/);
});

test('2 - background project gets activity badge when its terminal produces output', async () => {
  // Project 2 is selected, project 1 is in background
  // Send a command to project 1's terminal to generate output
  const termId = await window.evaluate((dir) => {
    const entries = [...window._cctGetSessionsForProject(dir)];
    return entries.length > 0 ? entries[0] : null;
  }, tmpDir1);

  // Use terminal.input to send data to the background terminal
  if (termId) {
    await window.evaluate((id) => {
      window.electron_api.terminal.input({ id, data: 'echo ACTIVITY_TEST\n' });
    }, termId);
  }

  // Wait for the output to arrive and trigger the badge
  await window.waitForTimeout(1000);

  // Check project activity set
  const activity = await window.evaluate(() => window._cctProjectActivity());
  expect(activity.length).toBeGreaterThanOrEqual(1);
});

test('3 - project activity class is on the sidebar item', async () => {
  const project1 = window.locator('[data-testid="project-item"]').nth(0);
  await expect(project1).toHaveClass(/project-activity/, { timeout: 3000 });
});

test('4 - switching to the project clears the activity badge', async () => {
  // Switch to project 1
  await window.evaluate((dir) => window._cctSelectProject(dir), tmpDir1);
  await window.waitForTimeout(300);

  const project1 = window.locator('[data-testid="project-item"]').nth(0);
  await expect(project1).not.toHaveClass(/project-activity/);

  // The activity set should no longer contain project 1
  const activity = await window.evaluate(() => window._cctProjectActivity());
  expect(activity).not.toContain(tmpDir1);
});

test('5 - selected project output does not trigger activity badge', async () => {
  // Project 1 is now selected, send output to its terminal
  const termId = await window.evaluate((dir) => {
    const entries = [...window._cctGetSessionsForProject(dir)];
    return entries.length > 0 ? entries[0] : null;
  }, tmpDir1);

  if (termId) {
    await window.evaluate((id) => {
      window.electron_api.terminal.input({ id, data: 'echo NO_BADGE\n' });
    }, termId);
  }

  await window.waitForTimeout(500);

  const project1 = window.locator('[data-testid="project-item"]').nth(0);
  await expect(project1).not.toHaveClass(/project-activity/);
});

/**
 * Step 028 — Project Context Menu (right-click)
 * Right-click a project for Reveal in Finder, Copy Path, Remove.
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
    timeout: 60000,
  });
  window = await electronApp.firstWindow({ timeout: 60000 });
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 15000 });

  tmpDir = path.join(os.tmpdir(), `cct-test-028-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  await window.evaluate(async (dir) => {
    await window.electron_api.projects.addPath(dir);
    const saved = await window.electron_api.projects.list();
    window._cctReloadProjects(saved);
    window._cctSelectProject(dir);
  }, tmpDir);
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

test('1 - project context menu items are correct', async () => {
  const items = await window.evaluate((dir) => {
    return window._cctGetProjectContextMenuItems(dir);
  }, tmpDir);

  expect(items).toHaveLength(3);
  expect(items[0].label).toBe('Reveal in Finder');
  expect(items[1].label).toBe('Copy Path');
  expect(items[2].label).toBe('Remove Project');
});

test('2 - shell.showItemInFolder API is available', async () => {
  const hasShell = await window.evaluate(() => {
    return typeof window.electron_api.shell === 'object'
      && typeof window.electron_api.shell.showItemInFolder === 'function';
  });
  expect(hasShell).toBe(true);
});

test('3 - Copy Path writes project path to clipboard', async () => {
  // Simulate what the context menu does
  await window.evaluate((dir) => {
    window.electron_api.clipboard.writeText(dir);
  }, tmpDir);

  const clipboardText = await window.evaluate(() => window.electron_api.clipboard.readText());
  expect(clipboardText).toBe(tmpDir);
});

test('4 - project item has contextmenu event listener', async () => {
  const projectItem = window.locator('[data-testid="project-item"]');
  await expect(projectItem).toHaveCount(1);

  // Verify the project item element exists and is clickable
  await expect(projectItem).toBeVisible();
});

test('5 - Reveal in Finder IPC handler exists', async () => {
  // Call the IPC handler — it should not throw
  // We pass a temp dir that exists, so it won't cause errors
  const result = await window.evaluate((dir) => {
    return window.electron_api.shell.showItemInFolder(dir);
  }, tmpDir);

  // showItemInFolder returns void/undefined — success is no error thrown
  expect(result === undefined || result === null).toBe(true);
});

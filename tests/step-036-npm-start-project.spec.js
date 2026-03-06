/**
 * Step 036 — npm start auto-opens CWD as project
 *
 * When Claudiu is launched via `npm start` from a project directory,
 * the working directory should be auto-added and selected as a project.
 *
 * This mirrors `claudiu .` behaviour but via the npm start script which
 * passes $PWD as an extra arg to electron: `electron . $PWD`
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const { appPath, launchEnv, closeApp } = require('./helpers');

let electronApp;
let window;

test.afterAll(async () => {
  if (electronApp) await closeApp(electronApp);
});

test('1 - launching without a project path arg does NOT auto-select any project', async () => {
  // Simulate plain `electron .` (npm start before the fix) — no project path arg
  const env = launchEnv();
  electronApp = await electron.launch({ args: [appPath], env });
  window = await electronApp.firstWindow();
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 });
  await window.waitForTimeout(600); // give CLI open delay time to fire

  const selected = await window.evaluate(() => window._claudiuSelectedProject());
  // With no arg, nothing should be auto-selected
  expect(selected).toBeFalsy();

  await closeApp(electronApp);
  electronApp = null;
});

test('2 - launching with CWD as extra arg auto-adds and selects the project', async () => {
  // Simulate `electron . $PWD` (npm start after the fix)
  const env = launchEnv();
  const cwd = appPath; // use the Claudiu project itself as the "cwd"

  electronApp = await electron.launch({ args: [appPath, cwd], env });
  window = await electronApp.firstWindow();
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 });
  await window.waitForTimeout(1000); // wait for delayed open-project IPC

  const selected = await window.evaluate(() => window._claudiuSelectedProject());
  expect(selected).toBe(cwd);
});

test('3 - the project appears in the sidebar', async () => {
  const items = window.locator('[data-testid="project-item"]');
  await expect(items).toHaveCount(1, { timeout: 5000 });

  const projectPath = await items.first().getAttribute('data-project-path');
  expect(projectPath).toBe(appPath);
});

test('4 - package.json start script passes $PWD to electron', async () => {
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync(path.join(appPath, 'package.json'), 'utf8'));
  // The start script must pass $PWD (or equivalent) as an extra arg
  expect(pkg.scripts.start).toMatch(/\$PWD|\$\(pwd\)/);
});

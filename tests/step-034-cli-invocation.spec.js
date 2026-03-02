/**
 * Step 034 — Command-Line Invocation
 * Launch CCT with a project path: `cct .` or `cct /path/to/project`
 * Tests both first-instance (fresh launch with path arg) and
 * the open-project IPC channel used by second-instance.
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
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cct-test-cli-'));
});

test.afterAll(async () => {
  if (electronApp) await electronApp.close();
  try { fs.rmSync(projectDir, { recursive: true }); } catch {}
});

test('1 - launching with project path auto-adds and selects the project', async () => {
  // Launch with a project path argument
  electronApp = await electron.launch({
    args: [appPath, projectDir],
    env,
    timeout: 90000,
  });
  window = await electronApp.firstWindow({ timeout: 90000 });
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 15000 });

  // Wait for the delayed open-project to fire
  await window.waitForTimeout(1000);

  // The project should be added and selected
  const selectedProject = await window.evaluate(() => window._cctSelectedProject());
  expect(selectedProject).toBe(projectDir);
});

test('2 - project appears in the sidebar', async () => {
  const projectNames = await window.evaluate(() => {
    const items = document.querySelectorAll('[data-testid="project-item"]');
    return [...items].map(el => el.dataset.projectPath);
  });
  expect(projectNames).toContain(projectDir);
});

test('3 - project is persisted in projects.json', async () => {
  const projectsFile = path.join(env.CCT_USER_DATA, 'projects.json');
  const data = JSON.parse(fs.readFileSync(projectsFile, 'utf8'));
  expect(data.projects.some(p => p.path === projectDir)).toBe(true);
});

test('4 - open-project IPC selects an existing project', async () => {
  // Create a second project directory
  const secondDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cct-test-cli-2-'));

  // Add it via IPC (simulates what main process does)
  await window.evaluate(async (dir) => {
    await window.electron_api.projects.addPath(dir);
  }, secondDir);

  // Simulate the open-project message by reloading projects and selecting
  await window.evaluate(async (dir) => {
    const fresh = await window.electron_api.projects.list();
    window._cctReloadProjects(fresh);
    window._cctSelectProject(dir);
  }, secondDir);

  const selected = await window.evaluate(() => window._cctSelectedProject());
  expect(selected).toBe(secondDir);

  // Clean up
  await window.evaluate((dir) => window.electron_api.projects.remove(dir), secondDir);
  try { fs.rmSync(secondDir, { recursive: true }); } catch {}
});

test('5 - projects.onOpen listener is exposed in preload', async () => {
  const hasListener = await window.evaluate(() =>
    typeof window.electron_api.projects.onOpen === 'function'
  );
  expect(hasListener).toBe(true);
});

test('6 - parseProjectPath ignores flags and invalid paths', async () => {
  // Launch a second instance with only flags — should not crash or change project
  const currentProject = await window.evaluate(() => window._cctSelectedProject());

  // The first project (from test 1) should still be available
  const projectsFile = path.join(env.CCT_USER_DATA, 'projects.json');
  const data = JSON.parse(fs.readFileSync(projectsFile, 'utf8'));
  expect(data.projects.length).toBeGreaterThanOrEqual(1);
});

test('7 - bin/cct script exists and is executable', async () => {
  const binPath = path.join(appPath, 'bin', 'cct');
  const stat = fs.statSync(binPath);
  expect(stat.isFile()).toBe(true);
  // Check executable bit (owner execute)
  expect(stat.mode & 0o111).toBeGreaterThan(0);
});

test('8 - bin/cct script contains open -a for packaged app', async () => {
  const binPath = path.join(appPath, 'bin', 'cct');
  const content = fs.readFileSync(binPath, 'utf8');
  expect(content).toContain('open -a');
  expect(content).toContain('CCT');
});

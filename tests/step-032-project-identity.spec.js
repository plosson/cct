/**
 * Step 032 — Project Visual Identity
 * Each project gets a distinct accent color and prominent name display.
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const appPath = path.resolve(__dirname, '..');

let electronApp;
let window;

const tmpDirs = [];

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [appPath],
    env: { ...process.env, CCT_COMMAND: process.env.SHELL || '/bin/zsh' },
    timeout: 90000,
  });
  window = await electronApp.firstWindow({ timeout: 90000 });
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 15000 });
  await clearAllProjects();
});

test.afterAll(async () => {
  if (electronApp) {
    try { await clearAllProjects(); } catch { /* app may already be closed */ }
    await electronApp.close();
  }
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

async function clearAllProjects() {
  const existing = await window.evaluate(() => window.electron_api.projects.list());
  for (const p of existing) {
    await window.evaluate((path) => window.electron_api.projects.remove(path), p.path);
  }
  await window.evaluate(async () => {
    const saved = await window.electron_api.projects.list();
    window._cctReloadProjects(saved);
  });
}

async function addTempProject(name) {
  const tmpDir = path.join(os.tmpdir(), `cct-test-${name}-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  tmpDirs.push(tmpDir);

  await window.evaluate(async (dir) => {
    await window.electron_api.projects.addPath(dir);
    const saved = await window.electron_api.projects.list();
    window._cctReloadProjects(saved);
  }, tmpDir);

  return tmpDir;
}

test('1 - getProjectColor returns consistent color for same name', async () => {
  const result = await window.evaluate(() => {
    const { getProjectColor } = window._cctProjectColors;
    const c1 = getProjectColor('siteio');
    const c2 = getProjectColor('siteio');
    return { same: c1.hue === c2.hue, hasHue: typeof c1.hue === 'number' };
  });
  expect(result.same).toBe(true);
  expect(result.hasHue).toBe(true);
});

test('2 - different project names get different palette indices', async () => {
  const result = await window.evaluate(() => {
    const { getProjectColor } = window._cctProjectColors;
    const names = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];
    const indices = names.map(n => getProjectColor(n).index);
    // At least 3 distinct indices out of 6 names (with 12-color palette)
    return new Set(indices).size;
  });
  expect(result).toBeGreaterThanOrEqual(3);
});

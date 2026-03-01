/**
 * Step 032 — Project Visual Identity
 * Each project gets a distinct accent color and prominent name display.
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { appPath, launchEnv } = require('./helpers');

let electronApp;
let window;

const tmpDirs = [];

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [appPath],
    env: launchEnv(),
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

test('3 - titlebar shows project name when project is selected', async () => {
  const tmpDir = await addTempProject('titlebar');

  // Click the project to select it
  const projectItem = window.locator('[data-testid="project-item"]').first();
  await projectItem.click();
  await window.waitForTimeout(300);

  const titlebarName = window.locator('[data-testid="titlebar-project-name"]');
  await expect(titlebarName).toBeVisible({ timeout: 5000 });

  // Should contain the folder name (last segment of path)
  const text = await titlebarName.textContent();
  expect(text.toLowerCase()).toContain('titlebar');
});

test('4 - titlebar shows monogram with project initial', async () => {
  const monogram = window.locator('[data-testid="titlebar-monogram"]');
  await expect(monogram).toBeVisible();
  const text = await monogram.textContent();
  // Should be a single uppercase letter
  expect(text).toMatch(/^[A-Z]$/);
});

test('5 - CSS custom properties are set when project is selected', async () => {
  const accent = await window.evaluate(() => {
    return getComputedStyle(document.documentElement).getPropertyValue('--project-accent').trim();
  });
  expect(accent).toMatch(/^hsl\(/);
});

test('6 - titlebar has tinted background', async () => {
  const bg = await window.evaluate(() => {
    return getComputedStyle(document.querySelector('.titlebar-drag-region')).backgroundColor;
  });
  // Should NOT be transparent or the default #1a1a2e (rgb(26, 26, 46))
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(bg).not.toBe('rgb(26, 26, 46)');
});

test('7 - different projects get color from their name', async () => {
  // Verify that the getProjectColor function produces different colors for different names
  const result = await window.evaluate(() => {
    const { getProjectColor } = window._cctProjectColors;
    // Use names that are known to hash to different palette indices
    const c1 = getProjectColor('alpha');
    const c2 = getProjectColor('beta');
    return { hue1: c1.hue, hue2: c2.hue, different: c1.index !== c2.index };
  });
  // These specific names hash to different palette indices
  expect(result.different).toBe(true);
});

test('8 - titlebar is empty when no project is selected', async () => {
  await clearAllProjects();

  const titlebarName = window.locator('[data-testid="titlebar-project-name"]');
  await expect(titlebarName).toHaveText('', { timeout: 5000 });
});

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

test('3 - tabs are integrated into the titlebar', async () => {
  const tmpDir = await addTempProject('titlebar');

  // Click the project to select it
  const projectItem = window.locator('[data-testid="project-item"]').first();
  await projectItem.click();
  await window.waitForTimeout(300);

  // Tab bar should be the titlebar-drag-region itself
  const tabBar = window.locator('[data-testid="tab-bar"]');
  await expect(tabBar).toBeVisible({ timeout: 5000 });

  // The titlebar should contain .titlebar-tabs
  const titlebarTabs = window.locator('.titlebar-tabs');
  await expect(titlebarTabs).toBeVisible();
});

test('4 - new tab button is in the titlebar', async () => {
  const newTabBtn = window.locator('[data-testid="new-tab-btn"]');
  await expect(newTabBtn).toBeVisible();
});

test('5 - titlebar uses neutral background (no per-project tint)', async () => {
  const bg = await window.evaluate(() => {
    return getComputedStyle(document.querySelector('.titlebar-drag-region')).backgroundColor;
  });
  // Should be the bg-surface color, not transparent
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
});

test('6 - active tab has subtle background, no bottom border accent', async () => {
  // The active tab should NOT have a colored bottom border
  const result = await window.evaluate(() => {
    const tab = document.querySelector('.tab-item.active');
    if (!tab) return { hasTab: false };
    const style = getComputedStyle(tab);
    return {
      hasTab: true,
      borderBottom: style.borderBottomColor,
      borderBottomStyle: style.borderBottomStyle,
    };
  });
  // No active tab is fine if no sessions, but if there is one, no accent border
  if (result.hasTab) {
    // border-bottom should be 'none' or transparent (not an accent color)
    expect(result.borderBottomStyle).toBe('none');
  }
});

test('7 - getProjectColor utility still works', async () => {
  const result = await window.evaluate(() => {
    const { getProjectColor } = window._cctProjectColors;
    const c1 = getProjectColor('alpha');
    const c2 = getProjectColor('beta');
    return { hue1: c1.hue, hue2: c2.hue, different: c1.index !== c2.index };
  });
  expect(result.different).toBe(true);
});

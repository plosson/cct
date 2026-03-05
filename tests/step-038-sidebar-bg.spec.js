// @ts-check
const { test, expect, _electron: electron } = require('@playwright/test');
const { appPath, launchEnv } = require('./helpers');

/** @type {import('@playwright/test').ElectronApplication} */
let electronApp;

/** @type {import('@playwright/test').Page} */
let window;

test.beforeAll(async () => {
  electronApp = await electron.launch({ args: [appPath], env: launchEnv() });
  window = await electronApp.firstWindow();
  await window.waitForSelector('.app');
});

test.afterAll(async () => {
  await electronApp.close();
});

test('sidebar background is semi-transparent in dark theme (vibrancy)', async () => {
  await window.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  });

  const sidebarBg = await window.evaluate(() => {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return 'no sidebar';
    return getComputedStyle(sidebar).backgroundColor;
  });

  // Dark --bg-app is rgba(17,17,17,0.85) — semi-transparent for vibrancy
  expect(sidebarBg).toMatch(/rgba\(17,\s*17,\s*17,\s*0\.85\)/);
});

test('sidebar background is opaque in light theme (no black flash)', async () => {
  await window.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light');
  });

  const sidebarBg = await window.evaluate(() => {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return 'no sidebar';
    return getComputedStyle(sidebar).backgroundColor;
  });

  // Light --bg-app is #f5f5f7 = rgb(245, 245, 247) — opaque white
  expect(sidebarBg).toMatch(/rgb\(245,\s*245,\s*247\)/);
});

test('sidebar CSS rule uses var(--bg-app)', async () => {
  const usesBgApp = await window.evaluate(() => {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule instanceof CSSStyleRule && rule.selectorText === '.sidebar') {
            const bg = rule.style.background || rule.style.backgroundColor;
            return bg.includes('--bg-app');
          }
        }
      } catch {}
    }
    return false;
  });
  expect(usesBgApp).toBe(true);
});

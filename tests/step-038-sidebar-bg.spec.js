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

for (const theme of ['dark', 'light']) {
  test(`sidebar background is transparent in ${theme} theme`, async () => {
    await window.evaluate((t) => {
      document.documentElement.setAttribute('data-theme', t);
    }, theme);

    const sidebarBg = await window.evaluate(() => {
      const sidebar = document.querySelector('.sidebar');
      if (!sidebar) return 'no sidebar';
      return getComputedStyle(sidebar).backgroundColor;
    });

    // Sidebar must be fully transparent so it inherits the window
    // vibrancy uniformly — no color mismatch with the main area
    expect(sidebarBg).toBe('rgba(0, 0, 0, 0)');
  });
}

test('sidebar CSS rule uses transparent background', async () => {
  const usesTransparent = await window.evaluate(() => {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule instanceof CSSStyleRule && rule.selectorText === '.sidebar') {
            const bg = rule.style.background || rule.style.backgroundColor;
            return bg === 'transparent';
          }
        }
      } catch {}
    }
    return false;
  });
  expect(usesTransparent).toBe(true);
});

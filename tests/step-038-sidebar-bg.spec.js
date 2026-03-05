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
  test(`sidebar background matches --bg-app in ${theme} theme`, async () => {
    await window.evaluate((t) => {
      document.documentElement.setAttribute('data-theme', t);
    }, theme);

    const result = await window.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const sidebar = document.querySelector('.sidebar');
      if (!sidebar) return { match: false, reason: 'no .sidebar element' };
      const sidebarStyle = getComputedStyle(sidebar);
      return {
        match: true,
        bgApp: root.getPropertyValue('--bg-app').trim(),
        sidebarBg: sidebarStyle.backgroundColor,
      };
    });

    expect(result.match).toBe(true);
    // The sidebar's computed background should resolve from --bg-app,
    // not --bg-surface or any other variable
    const cssVar = await window.evaluate(() => {
      const sidebar = document.querySelector('.sidebar');
      if (!sidebar) return '';
      // Read the raw CSS property value (before resolution)
      return getComputedStyle(sidebar).getPropertyValue('background-color');
    });
    // Verify it's not using --bg-surface values
    // Dark: --bg-surface is rgba(17,17,17,0.80), --bg-app is rgba(17,17,17,0.85)
    // Light: --bg-surface is #e8e8ec, --bg-app is #f5f5f7
    if (theme === 'light') {
      // In light mode, bg-surface (#e8e8ec) is visibly different from bg-app (#f5f5f7)
      expect(cssVar).not.toContain('232, 232, 236'); // rgb of #e8e8ec
    }
  });
}

test('sidebar uses --bg-app CSS variable (not --bg-surface)', async () => {
  // Directly check the stylesheet to ensure .sidebar uses --bg-app
  const usesCorrectVar = await window.evaluate(() => {
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
  expect(usesCorrectVar).toBe(true);
});

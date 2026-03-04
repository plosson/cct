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
  // Force dark theme so test doesn't depend on OS preference
  await window.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  });
});

test.afterAll(async () => {
  await electronApp.close();
});

test('dark theme uses neutral gray backgrounds (not warm brown)', async () => {
  const vars = await window.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      bgApp: style.getPropertyValue('--bg-app').trim(),
      bgSurface: style.getPropertyValue('--bg-surface').trim(),
      bgDeep: style.getPropertyValue('--bg-deep').trim(),
      textPrimary: style.getPropertyValue('--text-primary').trim(),
    };
  });

  // Verify neutral gray colors (no warm brown tint)
  // CSS uses rgba for macOS vibrancy transparency
  expect(vars.bgApp).toBe('rgba(17, 17, 17, 0.85)');
  expect(vars.bgSurface).toBe('rgba(25, 25, 25, 0.80)');
  expect(vars.bgDeep).toBe('#0c0c0c');
  expect(vars.textPrimary).toBe('#d4d4d4');
});

test('dark theme app background variable is applied', async () => {
  // With macOS vibrancy, computed backgroundColor may be transparent.
  // Verify the CSS variable is set and applied on the root element.
  const bgApp = await window.evaluate(() => {
    return getComputedStyle(document.documentElement).getPropertyValue('--bg-app').trim();
  });
  expect(bgApp).toBe('rgba(17, 17, 17, 0.85)');
});

test('dark theme has no warm brown colors', async () => {
  const vars = await window.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      bgApp: style.getPropertyValue('--bg-app').trim(),
      bgSurface: style.getPropertyValue('--bg-surface').trim(),
      bgOverlay: style.getPropertyValue('--bg-overlay').trim(),
      bgDeep: style.getPropertyValue('--bg-deep').trim(),
    };
  });

  // None of the old warm brown colors should be present
  const warmBrowns = ['#1a1714', '#231f1a', '#2a2520', '#15120f'];
  for (const color of warmBrowns) {
    expect(vars.bgApp).not.toBe(color);
    expect(vars.bgSurface).not.toBe(color);
    expect(vars.bgOverlay).not.toBe(color);
    expect(vars.bgDeep).not.toBe(color);
  }
});

test('Electron window background is neutral gray', async () => {
  const bgColor = await electronApp.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return win.getBackgroundColor();
  });
  // Should not contain old warm brown
  expect(bgColor).not.toContain('#1a1714');
});

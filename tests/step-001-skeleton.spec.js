// @ts-check
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const { appPath, launchEnv, closeApp } = require('./helpers');

/** @type {import('@playwright/test').ElectronApplication} */
let electronApp;

/** @type {import('@playwright/test').Page} */
let window;

test.beforeAll(async () => {
  electronApp = await electron.launch({ args: [appPath], env: launchEnv() });
  window = await electronApp.firstWindow();
});

test.afterAll(async () => {
  await closeApp(electronApp);
});

test('app launches without timeout', async () => {
  expect(electronApp).toBeTruthy();
});

test('a window is created', async () => {
  expect(window).toBeTruthy();
});

test('window title contains Claudiu', async () => {
  const title = await window.title();
  expect(title).toContain('Claudiu');
});

test('screenshot is non-empty', async () => {
  const screenshot = await window.screenshot();
  expect(screenshot.byteLength).toBeGreaterThan(0);
});

test('app is not packaged (dev mode)', async () => {
  const isPackaged = await electronApp.evaluate(async ({ app }) => {
    return app.isPackaged;
  });
  expect(isPackaged).toBe(false);
});

test('contextIsolation is true and nodeIntegration is false', async () => {
  const prefs = await electronApp.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return {
      contextIsolation: win.webContents.getLastWebPreferences().contextIsolation,
      nodeIntegration: win.webContents.getLastWebPreferences().nodeIntegration,
    };
  });
  expect(prefs.contextIsolation).toBe(true);
  expect(prefs.nodeIntegration).toBe(false);
});

test('preload bridge is exposed as electron_api', async () => {
  const apiType = await window.evaluate(() => typeof window.electron_api);
  expect(apiType).toBe('object');
});

test('require is not leaked to renderer', async () => {
  const requireType = await window.evaluate(() => typeof window.require);
  expect(requireType).toBe('undefined');
});

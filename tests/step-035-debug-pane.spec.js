/**
 * Step 035 — Debug Pane
 * Tests LogService ring buffer, IPC streaming, renderer pane toggle/resize/clear.
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { appPath, launchEnv } = require('./helpers');

let electronApp;
let window;
let env;

test.beforeAll(async () => {
  env = launchEnv();
  electronApp = await electron.launch({
    args: [appPath],
    env,
    timeout: 90000,
  });
  window = await electronApp.firstWindow({ timeout: 90000 });
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 15000 });
});

test.afterAll(async () => {
  if (electronApp) await electronApp.close();
});

test('1 - log history IPC returns array', async () => {
  const history = await window.evaluate(() => window.electron_api.log.getHistory());
  expect(Array.isArray(history)).toBe(true);
});

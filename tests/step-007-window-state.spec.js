/**
 * Step 007 — Window State Persistence
 * Window position, size, and sidebar width persist across app restarts.
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const appPath = path.resolve(__dirname, '..');

let electronApp;
let window;

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [appPath],
    env: { ...process.env, CCT_COMMAND: process.env.SHELL || '/bin/zsh' },
  });
  window = await electronApp.firstWindow();
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 });
});

test.afterAll(async () => {
  if (electronApp) await electronApp.close();
});

test('1 - window-state.json is created in userData', async () => {
  const statePath = await window.evaluate(() =>
    window.electron_api.windowState.getConfigPath()
  );
  expect(statePath).toBeTruthy();
  expect(fs.existsSync(statePath)).toBe(true);
});

test('2 - window-state.json has expected structure', async () => {
  const statePath = await window.evaluate(() =>
    window.electron_api.windowState.getConfigPath()
  );
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

  expect(typeof state.width).toBe('number');
  expect(typeof state.height).toBe('number');
  expect(state.width).toBeGreaterThanOrEqual(800);
  expect(state.height).toBeGreaterThanOrEqual(500);
  expect(typeof state.isMaximized).toBe('boolean');
  expect(typeof state.sidebarWidth).toBe('number');
});

test('3 - resizing window updates window-state.json', async () => {
  const statePath = await window.evaluate(() =>
    window.electron_api.windowState.getConfigPath()
  );

  // Read initial state
  const before = JSON.parse(fs.readFileSync(statePath, 'utf8'));

  // Resize the window
  const newWidth = before.width + 50;
  const newHeight = before.height + 50;
  await electronApp.evaluate(({ BrowserWindow }, { w, h }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(w, h);
  }, { w: newWidth, h: newHeight });

  // Wait for debounced save (300ms + buffer)
  await window.waitForTimeout(600);

  const after = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  expect(after.width).toBe(newWidth);
  expect(after.height).toBe(newHeight);
});

test('4 - moving window updates position in state', async () => {
  const statePath = await window.evaluate(() =>
    window.electron_api.windowState.getConfigPath()
  );

  // Move the window
  await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setPosition(100, 100);
  });

  await window.waitForTimeout(600);

  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  expect(state.x).toBe(100);
  expect(state.y).toBe(100);
});

test('5 - sidebar width persists via IPC', async () => {
  const statePath = await window.evaluate(() =>
    window.electron_api.windowState.getConfigPath()
  );

  // Set sidebar width
  await window.evaluate(() => window.electron_api.windowState.setSidebarWidth(250));
  await window.waitForTimeout(500);

  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  expect(state.sidebarWidth).toBe(250);

  // Read it back
  const width = await window.evaluate(() => window.electron_api.windowState.getSidebarWidth());
  expect(width).toBe(250);
});

test('6 - window state persists across app restart', async () => {
  const statePath = await window.evaluate(() =>
    window.electron_api.windowState.getConfigPath()
  );

  // Set specific size and position
  await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(1000, 700);
    win.setPosition(200, 150);
  });
  await window.waitForTimeout(600);

  // Verify state before restart
  const before = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  expect(before.width).toBe(1000);
  expect(before.height).toBe(700);

  // Restart the app
  await electronApp.close();
  electronApp = await electron.launch({
    args: [appPath],
    env: { ...process.env, CCT_COMMAND: process.env.SHELL || '/bin/zsh' },
  });
  window = await electronApp.firstWindow();
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 });

  // Window should have restored size
  const size = await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const [w, h] = win.getSize();
    return { w, h };
  });

  expect(size.w).toBe(1000);
  expect(size.h).toBe(700);
});

test('7 - sidebar width is restored on app restart', async () => {
  // Set a specific sidebar width
  await window.evaluate(() => window.electron_api.windowState.setSidebarWidth(280));
  await window.waitForTimeout(500);

  // Restart the app
  await electronApp.close();
  electronApp = await electron.launch({
    args: [appPath],
    env: { ...process.env, CCT_COMMAND: process.env.SHELL || '/bin/zsh' },
  });
  window = await electronApp.firstWindow();
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 });

  // Sidebar width should be restored
  const sidebarWidth = await window.evaluate(() => {
    const sidebar = document.querySelector('[data-testid="sidebar"]');
    return sidebar.getBoundingClientRect().width;
  });

  expect(sidebarWidth).toBe(280);
});

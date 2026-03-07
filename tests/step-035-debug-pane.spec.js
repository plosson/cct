/**
 * Step 035 — Debug Pane
 * Tests LogService ring buffer, IPC streaming, renderer pane toggle/resize/clear.
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { appPath, launchEnv, closeApp } = require('./helpers');

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
  if (electronApp) await closeApp(electronApp);
});

test('1 - log history IPC returns array', async () => {
  const history = await window.evaluate(() => window.electron_api.log.getHistory());
  expect(Array.isArray(history)).toBe(true);
});

test('2 - startup logs appear in history', async () => {
  const history = await window.evaluate(() => window.electron_api.log.getHistory());
  expect(history.length).toBeGreaterThan(0);
  // Check that entries have the expected shape
  const entry = history[0];
  expect(entry).toHaveProperty('timestamp');
  expect(entry).toHaveProperty('level');
  expect(entry).toHaveProperty('source');
  expect(entry).toHaveProperty('message');
});

test('3 - debug pane state defaults are persisted', async () => {
  const height = await window.evaluate(() => window.electron_api.windowState.get('debugPaneHeight'));
  const open = await window.evaluate(() => window.electron_api.windowState.get('debugPaneOpen'));
  expect(height).toBe(200);
  expect(open).toBe(false);
});

test('4 - debug pane exists in DOM and is collapsed by default', async () => {
  const pane = await window.evaluate(() => {
    const el = document.querySelector('[data-testid="debug-pane"]');
    if (!el) return null;
    return {
      exists: true,
      display: getComputedStyle(el).display,
      height: el.offsetHeight,
    };
  });
  expect(pane).not.toBeNull();
  expect(pane.height).toBe(0);
});

test('5 - Cmd+J toggles debug pane open and closed', async () => {
  // Initially collapsed
  let height = await window.evaluate(() => document.querySelector('[data-testid="debug-pane"]').offsetHeight);
  expect(height).toBe(0);

  // Toggle open
  await window.keyboard.press('Meta+j');
  await window.waitForTimeout(100);

  height = await window.evaluate(() => document.querySelector('[data-testid="debug-pane"]').offsetHeight);
  expect(height).toBeGreaterThan(0);

  const handleVisible = await window.evaluate(() =>
    document.querySelector('[data-testid="debug-pane-resize-handle"]').classList.contains('visible')
  );
  expect(handleVisible).toBe(true);

  // Toggle closed
  await window.keyboard.press('Meta+j');
  await window.waitForTimeout(100);

  height = await window.evaluate(() => document.querySelector('[data-testid="debug-pane"]').offsetHeight);
  expect(height).toBe(0);
});

test('6 - debug pane is resizable via drag handle', async () => {
  // Open the pane first
  const isOpen = await window.evaluate(() => document.querySelector('[data-testid="debug-pane"]').classList.contains('open'));
  if (!isOpen) await window.keyboard.press('Meta+j');
  await window.waitForTimeout(100);

  // Simulate drag via dispatching MouseEvents directly (Playwright mouse doesn't reliably trigger in Electron)
  await window.evaluate(() => {
    const handle = document.querySelector('[data-testid="debug-pane-resize-handle"]');
    const rect = handle.getBoundingClientRect();
    const startX = rect.x + rect.width / 2;
    const startY = rect.y + rect.height / 2;
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: startX, clientY: startY, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: startX, clientY: startY - 50, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });

  const newHeight = await window.evaluate(() => document.querySelector('[data-testid="debug-pane"]').offsetHeight);
  expect(newHeight).toBeGreaterThan(200);
});

test('7 - log entries appear in the debug pane', async () => {
  // Make sure pane is open
  const isOpen = await window.evaluate(() => document.querySelector('[data-testid="debug-pane"]').classList.contains('open'));
  if (!isOpen) await window.keyboard.press('Meta+j');
  await window.waitForTimeout(100);

  // Add a test log entry via test helper
  await window.evaluate(() => {
    window._claudiuAddDebugEntry({ timestamp: Date.now(), level: 'info', source: 'test', message: 'Hello from test' });
  });

  const entries = await window.evaluate(() =>
    document.querySelectorAll('[data-testid="debug-pane-entries"] .debug-entry').length
  );
  expect(entries).toBeGreaterThanOrEqual(1);

  const text = await window.evaluate(() =>
    document.querySelector('[data-testid="debug-pane-entries"]').textContent
  );
  expect(text).toContain('Hello from test');
});

test('8 - clear button removes all entries', async () => {
  // Add an entry first
  await window.evaluate(() => {
    window._claudiuAddDebugEntry({ timestamp: Date.now(), level: 'warn', source: 'test', message: 'Warning entry' });
  });

  // Click clear
  await window.click('[data-testid="debug-pane-clear-btn"]');
  await window.waitForTimeout(100);

  const entries = await window.evaluate(() =>
    document.querySelectorAll('[data-testid="debug-pane-entries"] .debug-entry').length
  );
  expect(entries).toBe(0);
});


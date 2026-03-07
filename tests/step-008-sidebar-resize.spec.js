/**
 * Step 008 — Draggable Sidebar Resize
 * Sidebar can be resized by dragging a handle between sidebar and main area.
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { appPath, launchEnv, closeApp } = require('./helpers');

let electronApp;
let window;
const testEnv = launchEnv();

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [appPath],
    env: testEnv,
  });
  window = await electronApp.firstWindow();
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 });
});

test.afterAll(async () => {
  if (electronApp) await closeApp(electronApp);
});

test('1 - resize handle is visible', async () => {
  const handle = window.locator('[data-testid="sidebar-resize-handle"]');
  await expect(handle).toBeVisible({ timeout: 3000 });
});

test('2 - resize handle has col-resize cursor', async () => {
  const cursor = await window.evaluate(() => {
    const handle = document.querySelector('[data-testid="sidebar-resize-handle"]');
    return globalThis.getComputedStyle(handle).cursor;
  });
  expect(cursor).toBe('col-resize');
});

test('3 - dragging the handle resizes the sidebar', async () => {
  const sidebar = window.locator('[data-testid="sidebar"]');

  const initialWidth = await sidebar.evaluate(el => el.getBoundingClientRect().width);

  // Simulate drag via dispatching MouseEvents directly (Playwright mouse doesn't reliably trigger in Electron)
  await window.evaluate((delta) => {
    const handle = document.querySelector('[data-testid="sidebar-resize-handle"]');
    const rect = handle.getBoundingClientRect();
    const startX = rect.x + rect.width / 2;
    const startY = rect.y + rect.height / 2;
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: startX, clientY: startY, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: startX + delta, clientY: startY, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, 80);

  const newWidth = await sidebar.evaluate(el => el.getBoundingClientRect().width);
  expect(newWidth).toBeGreaterThan(initialWidth + 50);
});

test('4 - sidebar has minimum width constraint', async () => {
  const sidebar = window.locator('[data-testid="sidebar"]');

  // Drag handle far to the left via dispatching MouseEvents directly
  await window.evaluate(() => {
    const handle = document.querySelector('[data-testid="sidebar-resize-handle"]');
    const rect = handle.getBoundingClientRect();
    const startX = rect.x + rect.width / 2;
    const startY = rect.y + rect.height / 2;
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: startX, clientY: startY, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: startY, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });

  const width = await sidebar.evaluate(el => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThanOrEqual(140);
});

test('5 - sidebar has maximum width constraint', async () => {
  const sidebar = window.locator('[data-testid="sidebar"]');

  // Drag handle far to the right via dispatching MouseEvents directly
  await window.evaluate(() => {
    const handle = document.querySelector('[data-testid="sidebar-resize-handle"]');
    const rect = handle.getBoundingClientRect();
    const startX = rect.x + rect.width / 2;
    const startY = rect.y + rect.height / 2;
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: startX, clientY: startY, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 600, clientY: startY, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });

  const width = await sidebar.evaluate(el => el.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(500);
});

test('6 - sidebar width persists after resize', async () => {
  const sidebar = window.locator('[data-testid="sidebar"]');

  // Reset to known width
  await window.evaluate(() => {
    document.querySelector('[data-testid="sidebar"]').style.width = '220px';
  });

  // Drag to a specific width via dispatching MouseEvents directly
  await window.evaluate(() => {
    const handle = document.querySelector('[data-testid="sidebar-resize-handle"]');
    const rect = handle.getBoundingClientRect();
    const startX = rect.x + rect.width / 2;
    const startY = rect.y + rect.height / 2;
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: startX, clientY: startY, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: startX + 30, clientY: startY, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });

  await window.waitForTimeout(500);

  // Check that the width was persisted
  const savedWidth = await window.evaluate(() =>
    window.electron_api.windowState.get('sidebarWidth')
  );
  const currentWidth = await sidebar.evaluate(el => Math.round(el.getBoundingClientRect().width));
  expect(savedWidth).toBe(currentWidth);
});

test('7 - resized sidebar width survives app restart', async () => {
  // Set a specific width via drag
  const sidebar = window.locator('[data-testid="sidebar"]');
  await window.evaluate(() => {
    document.querySelector('[data-testid="sidebar"]').style.width = '260px';
    window.electron_api.windowState.set('sidebarWidth', 260);
  });
  await window.waitForTimeout(500);

  // Restart the app
  await closeApp(electronApp);
  electronApp = await electron.launch({
    args: [appPath],
    env: testEnv,
  });
  window = await electronApp.firstWindow();
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 });

  // Sidebar should be 260px
  const width = await window.evaluate(() => {
    return document.querySelector('[data-testid="sidebar"]').getBoundingClientRect().width;
  });
  expect(width).toBe(260);
});

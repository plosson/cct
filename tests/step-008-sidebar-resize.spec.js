/**
 * Step 008 — Draggable Sidebar Resize
 * Sidebar can be resized by dragging a handle between sidebar and main area.
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { appPath, launchEnv } = require('./helpers');

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
  if (electronApp) await electronApp.close();
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
  const handle = window.locator('[data-testid="sidebar-resize-handle"]');

  const initialWidth = await sidebar.evaluate(el => el.getBoundingClientRect().width);
  const handleBox = await handle.boundingBox();

  // Drag handle 80px to the right
  await window.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await window.mouse.down();
  await window.mouse.move(handleBox.x + 80, handleBox.y + handleBox.height / 2, { steps: 5 });
  await window.mouse.up();

  const newWidth = await sidebar.evaluate(el => el.getBoundingClientRect().width);
  expect(newWidth).toBeGreaterThan(initialWidth + 50);
});

test('4 - sidebar has minimum width constraint', async () => {
  const sidebar = window.locator('[data-testid="sidebar"]');
  const handle = window.locator('[data-testid="sidebar-resize-handle"]');
  const handleBox = await handle.boundingBox();

  // Drag handle far to the left
  await window.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await window.mouse.down();
  await window.mouse.move(10, handleBox.y + handleBox.height / 2, { steps: 5 });
  await window.mouse.up();

  const width = await sidebar.evaluate(el => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThanOrEqual(140);
});

test('5 - sidebar has maximum width constraint', async () => {
  const sidebar = window.locator('[data-testid="sidebar"]');
  const handle = window.locator('[data-testid="sidebar-resize-handle"]');
  const handleBox = await handle.boundingBox();

  // Drag handle far to the right
  await window.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await window.mouse.down();
  await window.mouse.move(600, handleBox.y + handleBox.height / 2, { steps: 5 });
  await window.mouse.up();

  const width = await sidebar.evaluate(el => el.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(500);
});

test('6 - sidebar width persists after resize', async () => {
  const sidebar = window.locator('[data-testid="sidebar"]');
  const handle = window.locator('[data-testid="sidebar-resize-handle"]');

  // Reset to known width
  await window.evaluate(() => {
    document.querySelector('[data-testid="sidebar"]').style.width = '220px';
  });

  const handleBox = await handle.boundingBox();

  // Drag to a specific width
  await window.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await window.mouse.down();
  await window.mouse.move(handleBox.x + 30, handleBox.y + handleBox.height / 2, { steps: 5 });
  await window.mouse.up();

  await window.waitForTimeout(500);

  // Check that the width was persisted
  const savedWidth = await window.evaluate(() =>
    window.electron_api.windowState.getSidebarWidth()
  );
  const currentWidth = await sidebar.evaluate(el => Math.round(el.getBoundingClientRect().width));
  expect(savedWidth).toBe(currentWidth);
});

test('7 - resized sidebar width survives app restart', async () => {
  // Set a specific width via drag
  const sidebar = window.locator('[data-testid="sidebar"]');
  await window.evaluate(() => {
    document.querySelector('[data-testid="sidebar"]').style.width = '260px';
    window.electron_api.windowState.setSidebarWidth(260);
  });
  await window.waitForTimeout(500);

  // Restart the app
  await electronApp.close();
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

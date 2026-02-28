// @ts-check
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');

const appPath = path.join(__dirname, '..');

/** @type {import('@playwright/test').ElectronApplication} */
let electronApp;

/** @type {import('@playwright/test').Page} */
let window;

test.beforeAll(async () => {
  electronApp = await electron.launch({ args: [appPath] });
  window = await electronApp.firstWindow();
  await window.waitForSelector('.xterm', { timeout: 10000 });
});

test.afterAll(async () => {
  await electronApp.close();
});

test('1. on launch, one tab exists', async () => {
  const tabs = window.locator('[data-testid="tab"]');
  await expect(tabs).toHaveCount(1);
});

test('2. new session action creates a second tab', async () => {
  await window.click('[data-testid="new-tab-btn"]');
  const tabs = window.locator('[data-testid="tab"]');
  await expect(tabs).toHaveCount(2, { timeout: 10000 });
});

test('3. each tab has a visible label', async () => {
  const labels = window.locator('[data-testid="tab"] .tab-label');
  const count = await labels.count();
  expect(count).toBe(2);
  for (let i = 0; i < count; i++) {
    await expect(labels.nth(i)).toBeVisible();
    const text = await labels.nth(i).textContent();
    expect(text.trim()).toBeTruthy();
  }
});

test('4. click tab 1: its terminal visible, tab 2 hidden', async () => {
  const tabs = window.locator('[data-testid="tab"]');
  await tabs.first().click();

  const panels = window.locator('.terminal-panel');
  await expect(panels.first()).toHaveClass(/active/);
  await expect(panels.nth(1)).not.toHaveClass(/active/);
});

test('5. click tab 2: it becomes visible, tab 1 hidden', async () => {
  const tabs = window.locator('[data-testid="tab"]');
  await tabs.nth(1).click();

  const panels = window.locator('.terminal-panel');
  await expect(panels.nth(1)).toHaveClass(/active/);
  await expect(panels.first()).not.toHaveClass(/active/);
});

test('6. terminal state preserved across tab switches', async () => {
  // Switch to tab 1
  const tabs = window.locator('[data-testid="tab"]');
  await tabs.first().click();
  await window.waitForTimeout(500);

  // Type a unique marker — scope textarea to active panel to avoid strict mode violation
  const textarea = window.locator('.terminal-panel.active .xterm-helper-textarea');
  await textarea.focus();
  await textarea.pressSequentially('echo TAB1_UNIQUE_MARKER_12345', { delay: 30 });
  await window.keyboard.press('Enter');

  // Wait for marker to appear in buffer
  await expect(async () => {
    const text = await window.evaluate(() => window._cctGetBufferText());
    expect(text).toContain('TAB1_UNIQUE_MARKER_12345');
  }).toPass({ timeout: 5000 });

  // Switch to tab 2
  await tabs.nth(1).click();
  await window.waitForTimeout(300);

  // Switch back to tab 1
  await tabs.first().click();
  await window.waitForTimeout(300);

  // Marker should still be in buffer
  const text = await window.evaluate(() => window._cctGetBufferText());
  expect(text).toContain('TAB1_UNIQUE_MARKER_12345');
});

test('7. close tab 2 via close button: tab count back to 1', async () => {
  // Ensure we have 2 tabs (create one if test 6 left us with fewer)
  const tabCount = await window.locator('[data-testid="tab"]').count();
  if (tabCount < 2) {
    await window.click('[data-testid="new-tab-btn"]');
    await expect(window.locator('[data-testid="tab"]')).toHaveCount(2, { timeout: 5000 });
  }

  const closeBtn = window.locator('[data-testid="tab"]').nth(1).locator('[data-testid="tab-close"]');
  await closeBtn.click();

  await expect(window.locator('[data-testid="tab"]')).toHaveCount(1);
});

test('8. closed tab PTY is cleaned up', async () => {
  await expect(async () => {
    const count = await window.evaluate(() => window.electron_api.terminal.count());
    expect(count).toBe(1);
  }).toPass({ timeout: 5000 });
});

test('9. close last tab — app handles gracefully (auto-creates new tab)', async () => {
  const closeBtn = window.locator('[data-testid="tab"]').first().locator('[data-testid="tab-close"]');
  await closeBtn.click();

  // Should still have 1 tab (auto-created)
  await expect(window.locator('[data-testid="tab"]')).toHaveCount(1, { timeout: 5000 });

  // The new tab's terminal panel should be active and contain an xterm
  await expect(window.locator('.terminal-panel.active .xterm')).toBeVisible({ timeout: 10000 });
});

test('10. step 004 regression — terminal-create IPC still works', async () => {
  const result = await window.evaluate(async () => {
    return await window.electron_api.terminal.create({ cols: 80, rows: 24 });
  });
  expect(result.success).toBe(true);
  expect(result.id).toBeGreaterThan(0);

  await window.evaluate(async (id) => {
    window.electron_api.terminal.kill({ id });
  }, result.id);
  await window.waitForTimeout(500);
});

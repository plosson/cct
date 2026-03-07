/**
 * Step 051 — Auto-updater UI
 * Verifies the renderer reacts correctly to updater IPC events:
 *   - "update-downloaded" shows a persistent banner with version
 *   - "update-not-available" shows a temporary info banner that auto-dismisses
 *   - Duplicate banners are prevented
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const { appPath, launchEnv, closeApp } = require('./helpers');

let electronApp;
let window;

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [appPath],
    env: launchEnv(),
    timeout: 90000,
  });
  window = await electronApp.firstWindow({ timeout: 90000 });
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 15000 });
});

test.afterAll(async () => {
  if (electronApp) await closeApp(electronApp);
});

/** Helper: send an IPC event from main to the renderer */
function sendToRenderer(channel, data) {
  return electronApp.evaluate(({ BrowserWindow }, { channel, data }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.webContents.send(channel, data);
  }, { channel, data });
}

/** Helper: remove any existing update banners */
async function clearBanners() {
  await window.evaluate(() => {
    document.querySelectorAll('.update-banner').forEach(el => el.remove());
  });
}

test('1 - update-not-available shows info banner', async () => {
  await clearBanners();
  await sendToRenderer('update-not-available', { version: '0.9.0' });

  const banner = window.locator('[data-testid="update-banner-info"]');
  await expect(banner).toBeVisible({ timeout: 3000 });
  await expect(banner).toHaveText('You are running the latest version');
  await expect(banner).toHaveClass(/update-banner--info/);
});

test('2 - info banner auto-dismisses', async () => {
  // Banner from previous test should still exist or re-create
  await clearBanners();
  await sendToRenderer('update-not-available', { version: '0.9.0' });

  const banner = window.locator('[data-testid="update-banner-info"]');
  await expect(banner).toBeVisible({ timeout: 3000 });

  // Wait for the 4s auto-dismiss timeout
  await expect(banner).toBeHidden({ timeout: 6000 });
});

test('3 - update-downloaded shows persistent banner with version', async () => {
  await clearBanners();
  await sendToRenderer('update-downloaded', { version: '1.2.3' });

  const banner = window.locator('[data-testid="update-banner"]');
  await expect(banner).toBeVisible({ timeout: 3000 });
  await expect(banner).toContainText('v1.2.3');
  await expect(banner).toContainText('click to restart');
});

test('4 - update-downloaded banner persists (does not auto-dismiss)', async () => {
  const banner = window.locator('[data-testid="update-banner"]');
  // Still visible after a short wait (it should not auto-dismiss)
  await window.waitForTimeout(2000);
  await expect(banner).toBeVisible();
});

test('5 - duplicate banners are prevented', async () => {
  // Banner from test 3 should still be present; send another event
  await sendToRenderer('update-downloaded', { version: '1.2.4' });
  await window.waitForTimeout(500);

  const banners = window.locator('.update-banner');
  await expect(banners).toHaveCount(1);
});

test('6 - info banner blocked when download banner is present', async () => {
  // Download banner from test 3 is still visible
  await sendToRenderer('update-not-available', { version: '0.9.0' });
  await window.waitForTimeout(500);

  // Should still only have the download banner, not an info banner
  const banners = window.locator('.update-banner');
  await expect(banners).toHaveCount(1);
  await expect(window.locator('[data-testid="update-banner"]')).toBeVisible();
});

/**
 * Step 048 — Per-project background image
 * Verifies that setting a backgroundImage config applies CSS on .terminals-container.
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { appPath, launchEnv, closeApp } = require('./helpers');

let electronApp;
let window;
let env;
let projectDirA;
let projectDirB;
let testImagePath;

test.beforeAll(async () => {
  env = launchEnv();

  // Create two temp project directories
  projectDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'claudiu-bg-a-'));
  projectDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'claudiu-bg-b-'));

  // Create a tiny 1x1 PNG test image
  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64'
  );
  testImagePath = path.join(projectDirA, 'test-bg.png');
  fs.writeFileSync(testImagePath, pngBuffer);

  // Pre-seed two projects
  fs.mkdirSync(env.CLAUDIU_USER_DATA, { recursive: true });
  fs.writeFileSync(
    path.join(env.CLAUDIU_USER_DATA, 'projects.json'),
    JSON.stringify({
      projects: [
        { path: projectDirA, name: path.basename(projectDirA) },
        { path: projectDirB, name: path.basename(projectDirB) },
      ],
    })
  );

  // Pre-set background image config for project A
  const claudiuDir = path.join(projectDirA, '.claudiu');
  fs.mkdirSync(claudiuDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudiuDir, 'config.json'),
    JSON.stringify({ backgroundImage: testImagePath })
  );

  electronApp = await electron.launch({
    args: [appPath],
    env,
    timeout: 90000,
  });
  window = await electronApp.firstWindow({ timeout: 90000 });
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 15000 });
  await window.waitForTimeout(500);
});

test.afterAll(async () => {
  if (electronApp) await closeApp(electronApp);
  try { fs.rmSync(projectDirA, { recursive: true }); } catch {}
  try { fs.rmSync(projectDirB, { recursive: true }); } catch {}
});

test('1 - project with background image has has-bg-image class', async () => {
  // Project A is selected on launch (first project)
  const container = window.locator('#terminals');
  await expect(container).toHaveClass(/has-bg-image/, { timeout: 5000 });
});

test('2 - --bg-image CSS variable is set with file URL', async () => {
  const bgImage = await window.evaluate(() => {
    const el = document.getElementById('terminals');
    return el.style.getPropertyValue('--bg-image');
  });
  expect(bgImage).toContain('file://');
  expect(bgImage).toContain('test-bg.png');
});

test('3 - switching to project without image removes background', async () => {
  // Select project B (no background image)
  await window.evaluate((dir) => window._claudiuSelectProject(dir), projectDirB);
  await window.waitForTimeout(300);

  const container = window.locator('#terminals');
  await expect(container).not.toHaveClass(/has-bg-image/, { timeout: 3000 });
});

test('4 - switching back to project A restores background', async () => {
  await window.evaluate((dir) => window._claudiuSelectProject(dir), projectDirA);
  await window.waitForTimeout(300);

  const container = window.locator('#terminals');
  await expect(container).toHaveClass(/has-bg-image/, { timeout: 3000 });
});

test('5 - setting background via IPC applies it', async () => {
  // Set background on project B via IPC
  await window.evaluate(async (args) => {
    const { dir, img } = args;
    await window.electron_api.appConfig.setProject(dir, { backgroundImage: img });
  }, { dir: projectDirB, img: testImagePath });

  // Switch to project B
  await window.evaluate((dir) => window._claudiuSelectProject(dir), projectDirB);
  await window.waitForTimeout(300);

  const container = window.locator('#terminals');
  await expect(container).toHaveClass(/has-bg-image/, { timeout: 3000 });
});

test('6 - clearing background image removes it', async () => {
  // Clear background on project B
  await window.evaluate(async (dir) => {
    await window.electron_api.appConfig.setProject(dir, {});
  }, projectDirB);

  // Re-select to trigger refresh
  await window.evaluate((dir) => window._claudiuSelectProject(dir), projectDirB);
  await window.waitForTimeout(300);

  const container = window.locator('#terminals');
  await expect(container).not.toHaveClass(/has-bg-image/, { timeout: 3000 });
});

test('7 - theme tint overlay (::before) exists when background is set', async () => {
  // Switch back to project A which has the image
  await window.evaluate((dir) => window._claudiuSelectProject(dir), projectDirA);
  await window.waitForTimeout(300);

  const beforeOpacity = await window.evaluate(() => {
    const el = document.getElementById('terminals');
    const style = getComputedStyle(el, '::before');
    return style.opacity;
  });
  // ::before is the theme tint overlay at 0.7
  expect(parseFloat(beforeOpacity)).toBeGreaterThan(0);
  expect(parseFloat(beforeOpacity)).toBeLessThanOrEqual(1);
});

test('8 - schema includes backgroundImage with type file', async () => {
  const schema = await window.evaluate(() =>
    window.electron_api.appConfig.getSchema()
  );
  expect(schema).toHaveProperty('backgroundImage');
  expect(schema.backgroundImage.type).toBe('file');
  expect(schema.backgroundImage.label).toBe('Background image');
});

test('9 - settings UI shows background image input', async () => {
  // Open settings and go to project scope
  await window.keyboard.press('Meta+,');
  await window.waitForSelector('[data-testid="settings-nav-general"]', { timeout: 3000 });

  // Switch to project scope
  await window.locator('[data-testid="settings-scope-project"]').click();
  await window.waitForTimeout(300);

  // Should have background image input
  const input = window.locator('[data-testid="settings-input-backgroundImage"]');
  await expect(input).toBeAttached({ timeout: 3000 });

  // Input should show filename
  const value = await input.inputValue();
  expect(value).toBe('test-bg.png');
});

test('10 - settings UI shows thumbnail preview', async () => {
  const thumb = window.locator('.settings-file-thumb');
  await expect(thumb).toBeAttached({ timeout: 3000 });
  const src = await thumb.getAttribute('src');
  expect(src).toContain('test-bg.png');
});

test('11 - background image overlay uses ::after pseudo-element', async () => {
  // Switch to project A which has bg image
  await window.evaluate((dir) => window._claudiuSelectProject(dir), projectDirA);
  await window.waitForTimeout(300);

  // Verify the ::after overlay has the background image
  const afterBgImage = await window.evaluate(() => {
    const container = document.getElementById('terminals');
    if (!container.classList.contains('has-bg-image')) return '';
    return getComputedStyle(container, '::after').backgroundImage;
  });
  expect(afterBgImage).toContain('test-bg.png');
});

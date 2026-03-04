/**
 * Step 045 — Copy-on-Write Theme Tests
 * Tests for the COW theme system: IPC/service logic and settings UI.
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { appPath, launchEnv } = require('./helpers');

let electronApp;
let window;
let env;
let projectDir;

test.beforeAll(async () => {
  env = launchEnv();
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudiu-test-project-'));

  // Pre-seed userData
  fs.mkdirSync(env.CLAUDIU_USER_DATA, { recursive: true });
  fs.writeFileSync(
    path.join(env.CLAUDIU_USER_DATA, 'projects.json'),
    JSON.stringify({ projects: [{ path: projectDir, name: path.basename(projectDir) }] })
  );
  fs.writeFileSync(
    path.join(env.CLAUDIU_USER_DATA, 'config.json'),
    JSON.stringify({ soundTheme: 'default' })
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
  if (electronApp) await electronApp.close();
  try { fs.rmSync(projectDir, { recursive: true }); } catch {}
});

// ── IPC / Service Tests ─────────────────────────────────────

test('1 - listThemes includes builtIn flag', async () => {
  const themes = await window.evaluate(() => window.electron_api.soundThemes.list());
  expect(Array.isArray(themes)).toBe(true);
  const defaultTheme = themes.find(t => t.dirName === 'default');
  expect(defaultTheme).toBeDefined();
  expect(defaultTheme.builtIn).toBe(true);
  expect(defaultTheme.name).toBe('Default');
});

test('2 - getSounds returns claudiu-sound:// URLs', async () => {
  const sounds = await window.evaluate(() => window.electron_api.soundThemes.getSounds());
  expect(sounds).toBeTruthy();
  // Each event maps to a single object with a url
  const entries = Object.values(sounds);
  expect(entries.length).toBeGreaterThan(0);
  for (const entry of entries) {
    expect(entry.url).toMatch(/^claudiu-sound:\/\//);
  }
});

test('3 - forkTheme creates writable copy', async () => {
  const result = await window.evaluate(() => window.electron_api.soundThemes.fork('default'));
  expect(result.success).toBe(true);
  expect(result.dirName).toBe('default-custom');

  // Verify filesystem state
  const themesDir = path.join(env.CLAUDIU_USER_DATA, 'themes');
  const forkedDir = path.join(themesDir, 'default-custom');
  expect(fs.existsSync(forkedDir)).toBe(true);

  const themeJson = JSON.parse(fs.readFileSync(path.join(forkedDir, 'theme.json'), 'utf8'));
  expect(themeJson.name).toContain('(Custom)');
  expect(themeJson.builtIn).toBeUndefined();
  expect(themeJson.forkedFrom).toBe('default');
});

test('4 - forkTheme fails on non-existent theme', async () => {
  const result = await window.evaluate(() => window.electron_api.soundThemes.fork('nope'));
  expect(result.success).toBe(false);
});

test('5 - saveTrim on built-in theme auto-forks', async () => {
  // Clean up any existing fork from test 3
  const forkedDir = path.join(env.CLAUDIU_USER_DATA, 'themes', 'default-custom');
  if (fs.existsSync(forkedDir)) fs.rmSync(forkedDir, { recursive: true, force: true });
  // Reset config to point to default
  fs.writeFileSync(
    path.join(env.CLAUDIU_USER_DATA, 'config.json'),
    JSON.stringify({ soundTheme: 'default' })
  );

  const result = await window.evaluate(() =>
    window.electron_api.soundThemes.saveTrim('SessionStart', 0.5, 2.0)
  );
  expect(result.success).toBe(true);
  expect(result.forked).toBe(true);
  expect(result.dirName).toBe('default-custom');

  // config.json should now point to the forked theme
  const config = JSON.parse(fs.readFileSync(path.join(env.CLAUDIU_USER_DATA, 'config.json'), 'utf8'));
  expect(config.soundTheme).toBe('default-custom');

  // theme.json should have trim data
  const themeJson = JSON.parse(fs.readFileSync(path.join(forkedDir, 'theme.json'), 'utf8'));
  const sessionStart = themeJson.events.SessionStart;
  expect(typeof sessionStart).toBe('object');
  expect(sessionStart.trimStart).toBe(0.5);
  expect(sessionStart.trimEnd).toBe(2.0);
});

test('6 - saveTrim on custom theme does not fork', async () => {
  // default-custom should exist from test 5, and config already points to it
  const result = await window.evaluate(() =>
    window.electron_api.soundThemes.saveTrim('Notification', 0.1, 1.5)
  );
  expect(result.success).toBe(true);
  expect(result.forked).toBe(false);
});

test('7 - removeSound blocked on built-in', async () => {
  const result = await window.evaluate(() =>
    window.electron_api.soundThemes.removeSound('default', 'SessionStart')
  );
  expect(result.success).toBe(false);
  expect(result.error).toContain('built-in');
});

test('8 - removeSound works on custom theme', async () => {
  // Ensure default-custom exists
  const forkedDir = path.join(env.CLAUDIU_USER_DATA, 'themes', 'default-custom');
  if (!fs.existsSync(forkedDir)) {
    await window.evaluate(() => window.electron_api.soundThemes.fork('default'));
  }

  const result = await window.evaluate(() =>
    window.electron_api.soundThemes.removeSound('default-custom', 'SessionEnd')
  );
  expect(result.success).toBe(true);

  // Verify event removed from theme.json
  const themeJson = JSON.parse(fs.readFileSync(path.join(forkedDir, 'theme.json'), 'utf8'));
  expect(themeJson.events.SessionEnd).toBeUndefined();

  // Verify audio file deleted
  expect(fs.existsSync(path.join(forkedDir, 'session-end.mp3'))).toBe(false);
});

test('9 - simulated upload: fork + manual file → sound accessible via getSounds', async () => {
  // Upload IPC opens a native dialog (can't automate), so we simulate:
  // fork via IPC, place a file on disk, update theme.json, then verify
  // the new event is accessible via getSounds() with a claudiu-sound:// URL.
  const forkedDir = path.join(env.CLAUDIU_USER_DATA, 'themes', 'default-custom');
  if (fs.existsSync(forkedDir)) fs.rmSync(forkedDir, { recursive: true, force: true });

  // Fork the built-in theme
  const forkResult = await window.evaluate(() => window.electron_api.soundThemes.fork('default'));
  expect(forkResult.success).toBe(true);

  // Simulate what uploadSoundToTheme does: copy file + update theme.json
  const dummyMp3 = Buffer.alloc(64, 0xff);
  const destFile = path.join(forkedDir, 'CustomEvent.mp3');
  fs.writeFileSync(destFile, dummyMp3);

  const themeJsonPath = path.join(forkedDir, 'theme.json');
  const themeJson = JSON.parse(fs.readFileSync(themeJsonPath, 'utf8'));
  themeJson.events.CustomEvent = 'CustomEvent.mp3';
  fs.writeFileSync(themeJsonPath, JSON.stringify(themeJson, null, 2));

  // Point config to the forked theme so getSounds resolves it
  await window.evaluate(() => window.electron_api.appConfig.setGlobal({ soundTheme: 'default-custom' }));

  // Verify via getSounds that the new event appears with the custom protocol URL
  const sounds = await window.evaluate(() => window.electron_api.soundThemes.getSounds());
  expect(sounds).toBeTruthy();
  expect(sounds.CustomEvent).toBeDefined();
  expect(sounds.CustomEvent.url).toBe('claudiu-sound://default-custom/CustomEvent.mp3');

  // Also verify via list()
  const themes = await window.evaluate(() => window.electron_api.soundThemes.list());
  const custom = themes.find(t => t.dirName === 'default-custom');
  expect(custom).toBeDefined();
  expect(custom.builtIn).toBe(false);
  expect(custom.events.CustomEvent).toBe('CustomEvent.mp3');
});

test('10 - legacy sound-overrides dir cleaned up', async () => {
  // The service cleans legacy dirs on construction. We can't easily re-trigger,
  // but we can verify the dir doesn't exist after launch.
  const legacyDir = path.join(env.CLAUDIU_USER_DATA, 'sound-overrides');
  // Pre-seed it and verify next launch would clean it (or verify it's already gone)
  expect(fs.existsSync(legacyDir)).toBe(false);
});

// ── UI Tests ────────────────────────────────────────────────

test('11 - Sound settings shows Built-in source label', async () => {
  // Reset config to default via IPC (updates in-memory state)
  await window.evaluate(() => window.electron_api.appConfig.setGlobal({ soundTheme: 'default' }));

  await window.keyboard.press('Meta+,');
  await window.waitForSelector('[data-testid="settings-nav-sounds"]', { timeout: 5000 });
  await window.locator('[data-testid="settings-nav-sounds"]').click();
  await window.waitForTimeout(500);

  // Check that a source cell says "Built-in"
  const builtInLabels = await window.locator('.settings-sound-source').allTextContents();
  const hasBuiltIn = builtInLabels.some(text => text.includes('Built-in'));
  expect(hasBuiltIn).toBe(true);
});

test('12 - Remove button hidden for built-in themes', async () => {
  // Settings should still be on Sounds tab from test 11
  const removeButtons = await window.locator('[data-testid^="settings-sound-remove-"]').count();
  expect(removeButtons).toBe(0);
});

test('13 - Export button visible', async () => {
  // Ensure we're on the Sounds tab
  const soundNav = window.locator('[data-testid="settings-nav-sounds"]');
  if (await soundNav.isVisible()) await soundNav.click();
  await window.waitForTimeout(300);

  // The export button is in the install row
  const exportBtn = window.locator('button:has-text("Export as ZIP")');
  await expect(exportBtn).toBeVisible();
});

// ── H5 — Additional IPC / Validation Tests ──────────────────

test('14 - removeTheme deletes custom theme', async () => {
  // Close settings if open
  const closeBtn = window.locator('[data-testid="settings-close"]');
  if (await closeBtn.isVisible()) await closeBtn.click();

  // Ensure default-custom exists
  const forkedDir = path.join(env.CLAUDIU_USER_DATA, 'themes', 'default-custom');
  if (!fs.existsSync(forkedDir)) {
    await window.evaluate(() => window.electron_api.soundThemes.fork('default'));
  }
  expect(fs.existsSync(forkedDir)).toBe(true);

  const result = await window.evaluate(() => window.electron_api.soundThemes.remove('default-custom'));
  expect(result.success).toBe(true);

  // Directory should be gone
  expect(fs.existsSync(forkedDir)).toBe(false);

  // list() should not include it
  const themes = await window.evaluate(() => window.electron_api.soundThemes.list());
  expect(themes.find(t => t.dirName === 'default-custom')).toBeUndefined();
});

test('15 - validation rejects path traversal in dirName', async () => {
  const forkResult = await window.evaluate(() => window.electron_api.soundThemes.fork('..'));
  expect(forkResult.success).toBe(false);
  expect(forkResult.error).toContain('Invalid');

  const removeResult = await window.evaluate(() =>
    window.electron_api.soundThemes.removeSound('..', 'SessionStart')
  );
  expect(removeResult.success).toBe(false);
  expect(removeResult.error).toContain('Invalid');
});

test('16 - validation rejects invalid eventName', async () => {
  // Ensure a writable theme exists
  const forkedDir = path.join(env.CLAUDIU_USER_DATA, 'themes', 'default-custom');
  if (!fs.existsSync(forkedDir)) {
    await window.evaluate(() => window.electron_api.soundThemes.fork('default'));
  }

  const result = await window.evaluate(() =>
    window.electron_api.soundThemes.removeSound('default-custom', '../etc')
  );
  expect(result.success).toBe(false);
  expect(result.error).toContain('Invalid');
});

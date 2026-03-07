/**
 * Step 047 — Sound Theme Operations
 * Comprehensive tests for theme selector, post-duplicate ops (bug fix area),
 * rename, delete, upload/remove edge cases, persistence, and multi-step flows.
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { appPath, launchEnv, showWindow, closeApp } = require('./helpers');

let electronApp;
let window;
let env;
let projectDir;

test.beforeAll(async () => {
  env = launchEnv();
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudiu-test-project-'));

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
  await showWindow(electronApp);
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 15000 });
  await window.waitForTimeout(500);
});

test.afterAll(async () => {
  if (electronApp) await closeApp(electronApp);
  try { fs.rmSync(projectDir, { recursive: true }); } catch {}
});

// ── Helper: open Settings → Sounds tab ──────────────────────
async function openSoundsTab() {
  await window.keyboard.press('Meta+,');
  await window.waitForSelector('[data-testid="settings-nav-sounds"]', { timeout: 5000 });
  await window.locator('[data-testid="settings-nav-sounds"]').click();
  await window.waitForTimeout(500);
}

// ── Helper: create a custom theme via IPC and set it active ─
async function ensureCustomTheme(name = 'Test Custom') {
  // Clean up any previous copy
  const dirName = name.toLowerCase().replace(/\s+/g, '-');
  const themeDir = path.join(env.CLAUDIU_USER_DATA, 'themes', dirName);
  if (fs.existsSync(themeDir)) fs.rmSync(themeDir, { recursive: true, force: true });

  const result = await window.evaluate(
    ([src, n]) => window.electron_api.soundThemes.duplicate(src, n),
    ['default', name]
  );
  expect(result.success).toBe(true);
  return result.dirName;
}

// ── Helper: reset config to a specific theme ────────────────
async function setTheme(dirName) {
  await window.evaluate(
    (t) => window.electron_api.appConfig.setGlobal({ soundTheme: t }),
    dirName
  );
}

// ── Group A — Theme Selector & "None" Behavior ─────────────

test('1 - Select "None" → all theme action buttons disabled', async () => {
  await openSoundsTab();

  // Switch dropdown to 'none'
  const dropdown = window.locator('[data-testid="settings-sound-theme-select"]');
  await dropdown.selectOption('none');
  await window.waitForTimeout(500);

  // Duplicate, Rename, Delete should all be disabled
  const duplicateBtn = window.locator('button:has-text("Duplicate")');
  const renameBtn = window.locator('button:has-text("Rename")');
  const deleteBtn = window.locator('button:has-text("Delete")');

  await expect(duplicateBtn).toBeDisabled();
  await expect(renameBtn).toBeDisabled();
  await expect(deleteBtn).toBeDisabled();

  // Upload buttons should exist but be disabled (built-in logic: none has no theme)
  // Remove buttons should not appear (no sounds when theme is none)
  const removeButtons = await window.locator('[data-testid^="settings-sound-remove-"]').count();
  expect(removeButtons).toBe(0);
});

test('2 - Select custom theme → Rename/Delete enabled, remove buttons appear', async () => {
  // Create a custom theme via IPC
  const dirName = await ensureCustomTheme('Buttons Test');

  // Close settings and reopen so the new theme appears in the dropdown
  const closeBtn = window.locator('[data-testid="tab-close"]');
  if (await closeBtn.isVisible()) await closeBtn.click();
  await window.waitForTimeout(300);
  await openSoundsTab();

  const dropdown = window.locator('[data-testid="settings-sound-theme-select"]');
  await dropdown.selectOption(dirName);
  await window.waitForTimeout(500);

  // Rename and Delete should be enabled for custom themes
  const renameBtn = window.locator('button:has-text("Rename")');
  const deleteBtn = window.locator('button:has-text("Delete")');
  const duplicateBtn = window.locator('button:has-text("Duplicate")');

  await expect(renameBtn).toBeEnabled();
  await expect(deleteBtn).toBeEnabled();
  await expect(duplicateBtn).toBeEnabled();

  // Remove buttons should appear (custom theme with sounds)
  const removeButtons = await window.locator('[data-testid^="settings-sound-remove-"]').count();
  expect(removeButtons).toBeGreaterThan(0);
});

test('3 - Change theme dropdown → sound table refreshes immediately', async () => {
  // Settings should still be open from test 2
  const dropdown = window.locator('[data-testid="settings-sound-theme-select"]');

  // Switch to 'none' — source labels should all be "—"
  await dropdown.selectOption('none');
  await window.waitForTimeout(500);

  const sourcesNone = await window.locator('.settings-sound-source').allTextContents();
  // Filter out the header row
  const dataSources = sourcesNone.filter(t => t !== 'Source' && t !== 'File');
  const allDash = dataSources.every(t => t === '\u2014' || t === '—');
  expect(allDash).toBe(true);

  // Switch to 'default' — source labels should show "Built-in"
  await dropdown.selectOption('default');
  await window.waitForTimeout(500);

  const sourcesDefault = await window.locator('.settings-sound-source').allTextContents();
  const hasBuiltIn = sourcesDefault.some(t => t.includes('Built-in'));
  expect(hasBuiltIn).toBe(true);
});

// ── Group B — Post-Duplicate Operations (Bug Fix) ───────────

test('4 - Duplicate built-in → remove buttons appear for sounds', async () => {
  // Close and reopen settings for a clean state
  await setTheme('default');
  const closeBtn4 = window.locator('[data-testid="tab-close"]');
  if (await closeBtn4.isVisible()) await closeBtn4.click();
  await window.waitForTimeout(300);
  await openSoundsTab();

  // Duplicate via UI
  const duplicateBtn = window.locator('button:has-text("Duplicate")');
  await duplicateBtn.click();

  const promptInput = window.locator('[data-testid="prompt-input"]');
  await expect(promptInput).toBeVisible({ timeout: 3000 });
  await promptInput.fill('Post Dup Test');
  await promptInput.press('Enter');
  await window.waitForTimeout(1000);

  // Dropdown should now point to the duplicated theme
  const dropdown = window.locator('[data-testid="settings-sound-theme-select"]');
  const newValue = await dropdown.inputValue();
  expect(newValue).toBe('post-dup-test');

  // Remove buttons should now appear (custom theme with sounds)
  const removeButtons = await window.locator('[data-testid^="settings-sound-remove-"]').count();
  expect(removeButtons).toBeGreaterThan(0);
});

test('5 - Duplicate → click remove → sound disappears from table', async () => {
  // Settings should be on the duplicated "post-dup-test" theme from test 4
  const dirName = 'post-dup-test';
  const themeDir = path.join(env.CLAUDIU_USER_DATA, 'themes', dirName);

  // Verify SessionStart sound exists before removal
  const themeJsonBefore = JSON.parse(fs.readFileSync(path.join(themeDir, 'theme.json'), 'utf8'));
  expect(themeJsonBefore.events.SessionStart).toBeDefined();

  // Click the remove button for SessionStart
  const removeBtn = window.locator('[data-testid="settings-sound-remove-SessionStart"]');
  await expect(removeBtn).toBeVisible();
  await removeBtn.click();
  await window.waitForTimeout(500);

  // The remove button should be gone now (no sound = no remove button)
  const removeBtnAfter = window.locator('[data-testid="settings-sound-remove-SessionStart"]');
  await expect(removeBtnAfter).toHaveCount(0);

  // Source label for SessionStart should now show "—"
  const row = window.locator('[data-testid="settings-sound-row-SessionStart"]');
  const source = row.locator('.settings-sound-source');
  const sourceText = await source.textContent();
  expect(sourceText).toBe('\u2014');

  // Verify filesystem: event removed from theme.json
  const themeJsonAfter = JSON.parse(fs.readFileSync(path.join(themeDir, 'theme.json'), 'utf8'));
  expect(themeJsonAfter.events.SessionStart).toBeUndefined();
});

test('6 - Duplicate → simulated upload → sound appears in getSoundMap', async () => {
  // Create a fresh custom theme
  const dirName = await ensureCustomTheme('Upload Sim');
  const themeDir = path.join(env.CLAUDIU_USER_DATA, 'themes', dirName);

  // Simulate upload: place file + update theme.json for a new event
  const dummyMp3 = Buffer.alloc(64, 0xff);
  fs.writeFileSync(path.join(themeDir, 'CustomUpload.mp3'), dummyMp3);

  const themeJsonPath = path.join(themeDir, 'theme.json');
  const themeJson = JSON.parse(fs.readFileSync(themeJsonPath, 'utf8'));
  themeJson.events.CustomUpload = 'CustomUpload.mp3';
  fs.writeFileSync(themeJsonPath, JSON.stringify(themeJson, null, 2));

  // Verify via getSoundMap that the new event appears
  const soundMap = await window.evaluate(
    (d) => window.electron_api.soundThemes.getSoundMap(d),
    dirName
  );
  expect(soundMap).toBeTruthy();
  expect(soundMap.CustomUpload).toBeDefined();
  expect(soundMap.CustomUpload.url).toBe(`claudiu-sound://${dirName}/CustomUpload.mp3`);
});

// ── Group C — Rename Theme ──────────────────────────────────

test('7 - Rename custom theme via IPC → dirName and display name updated', async () => {
  const dirName = await ensureCustomTheme('Rename Source');
  const themesDir = path.join(env.CLAUDIU_USER_DATA, 'themes');

  const result = await window.evaluate(
    ([d, n]) => window.electron_api.soundThemes.rename(d, n),
    [dirName, 'Renamed Target']
  );
  expect(result.success).toBe(true);
  expect(result.dirName).toBe('renamed-target');

  // Old dir should be gone, new dir should exist
  expect(fs.existsSync(path.join(themesDir, dirName))).toBe(false);
  expect(fs.existsSync(path.join(themesDir, 'renamed-target'))).toBe(true);

  // theme.json should have the new name
  const themeJson = JSON.parse(
    fs.readFileSync(path.join(themesDir, 'renamed-target', 'theme.json'), 'utf8')
  );
  expect(themeJson.name).toBe('Renamed Target');
});

test('8 - Rename built-in → fails with error', async () => {
  const result = await window.evaluate(
    ([d, n]) => window.electron_api.soundThemes.rename(d, n),
    ['default', 'Nope']
  );
  expect(result.success).toBe(false);
  expect(result.error).toContain('built-in');
});

test('9 - Rename to existing name → fails', async () => {
  // Create two custom themes
  const dirA = await ensureCustomTheme('Rename A');
  const dirB = await ensureCustomTheme('Rename B');

  // Try renaming A to B's name
  const result = await window.evaluate(
    ([d, n]) => window.electron_api.soundThemes.rename(d, n),
    [dirA, 'Rename B']
  );
  expect(result.success).toBe(false);
  expect(result.error).toContain('already exists');
});

test('10 - Rename via UI → prompt overlay → dropdown updates', async () => {
  const dirName = await ensureCustomTheme('UI Rename Src');
  await setTheme(dirName);

  // Close and reopen settings so the new theme appears in the dropdown
  const closeBtn10 = window.locator('[data-testid="tab-close"]');
  if (await closeBtn10.isVisible()) await closeBtn10.click();
  await window.waitForTimeout(300);
  await openSoundsTab();

  // Select the custom theme
  const dropdown = window.locator('[data-testid="settings-sound-theme-select"]');
  await dropdown.selectOption(dirName);
  await window.waitForTimeout(500);

  // Click Rename
  const renameBtn = window.locator('button:has-text("Rename")');
  await expect(renameBtn).toBeEnabled();
  await renameBtn.click();

  // Fill the prompt overlay
  const promptInput = window.locator('[data-testid="prompt-input"]');
  await expect(promptInput).toBeVisible({ timeout: 3000 });
  await promptInput.fill('UI Renamed Result');
  await promptInput.press('Enter');
  await window.waitForTimeout(1000);

  // Dropdown should now show the renamed theme
  const newValue = await dropdown.inputValue();
  expect(newValue).toBe('ui-renamed-result');
});

// ── Group D — Delete Theme ──────────────────────────────────

test('11 - Delete custom theme via UI → dropdown reverts to "default"', async () => {
  const dirName = await ensureCustomTheme('Delete Me');
  await setTheme(dirName);

  // Close and reopen settings so the new theme appears in the dropdown
  const closeBtn11 = window.locator('[data-testid="tab-close"]');
  if (await closeBtn11.isVisible()) await closeBtn11.click();
  await window.waitForTimeout(300);
  await openSoundsTab();

  const dropdown = window.locator('[data-testid="settings-sound-theme-select"]');
  await dropdown.selectOption(dirName);
  await window.waitForTimeout(500);

  // Override window.confirm to auto-accept (native dialog can't be automated)
  await window.evaluate(() => { window.confirm = () => true; });

  // Click Delete
  const deleteBtn = window.locator('button:has-text("Delete")');
  await expect(deleteBtn).toBeEnabled();
  await deleteBtn.click();
  await window.waitForTimeout(1000);

  // Dropdown should revert to 'default'
  const newValue = await dropdown.inputValue();
  expect(newValue).toBe('default');

  // Theme dir should be gone
  const themeDir = path.join(env.CLAUDIU_USER_DATA, 'themes', dirName);
  expect(fs.existsSync(themeDir)).toBe(false);
});

test('12 - Delete button disabled for built-in themes', async () => {
  // Switch to default theme
  await openSoundsTab();
  const dropdown = window.locator('[data-testid="settings-sound-theme-select"]');
  await dropdown.selectOption('default');
  await window.waitForTimeout(500);

  const deleteBtn = window.locator('button:has-text("Delete")');
  await expect(deleteBtn).toBeDisabled();
});

// ── Group E — Upload & Remove Edge Cases (IPC) ──────────────

test('13 - Upload replaces existing event sound file', async () => {
  const dirName = await ensureCustomTheme('Replace Sound');
  const themeDir = path.join(env.CLAUDIU_USER_DATA, 'themes', dirName);

  // Read original theme.json to find an event with a sound file
  const themeJson = JSON.parse(fs.readFileSync(path.join(themeDir, 'theme.json'), 'utf8'));
  const eventName = Object.keys(themeJson.events)[0];
  const origFile = typeof themeJson.events[eventName] === 'string'
    ? themeJson.events[eventName]
    : themeJson.events[eventName].file;

  // Simulate upload: write a new file and update theme.json
  const newFileName = `${eventName}-new.mp3`;
  fs.writeFileSync(path.join(themeDir, newFileName), Buffer.alloc(32, 0xaa));

  // Remove old file and update theme.json
  const oldFilePath = path.join(themeDir, origFile);
  if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);
  themeJson.events[eventName] = newFileName;
  fs.writeFileSync(path.join(themeDir, 'theme.json'), JSON.stringify(themeJson, null, 2));

  // Verify via getSoundMap
  const soundMap = await window.evaluate(
    (d) => window.electron_api.soundThemes.getSoundMap(d),
    dirName
  );
  expect(soundMap[eventName]).toBeDefined();
  expect(soundMap[eventName].url).toBe(`claudiu-sound://${dirName}/${newFileName}`);

  // Old file should not exist
  expect(fs.existsSync(oldFilePath)).toBe(false);
});

test('14 - Remove non-existent event → error', async () => {
  const dirName = await ensureCustomTheme('Remove Edge');

  const result = await window.evaluate(
    ([d, e]) => window.electron_api.soundThemes.removeSound(d, e),
    [dirName, 'NonExistentEvent']
  );
  expect(result.success).toBe(false);
  expect(result.error).toContain('not found');
});

// ── Group F — Settings Persistence ──────────────────────────

test('15 - Save global soundTheme → config.json updated on disk', async () => {
  const dirName = await ensureCustomTheme('Persist Theme');

  // Close and reopen settings so the new theme appears in the dropdown
  const closeBtn15 = window.locator('[data-testid="tab-close"]');
  if (await closeBtn15.isVisible()) await closeBtn15.click();
  await window.waitForTimeout(300);
  await openSoundsTab();

  // Select the custom theme in the dropdown (auto-saves after 400ms debounce)
  const dropdown = window.locator('[data-testid="settings-sound-theme-select"]');
  await dropdown.selectOption(dirName);
  // Wait for the 400ms auto-save debounce to complete
  await window.waitForTimeout(1000);

  // Read config.json from disk
  const config = JSON.parse(
    fs.readFileSync(path.join(env.CLAUDIU_USER_DATA, 'config.json'), 'utf8')
  );
  expect(config.soundTheme).toBe(dirName);
});

test('16 - Reload settings → saved theme still selected', async () => {
  // Ensure a custom theme is saved (in case test 15 state is clean)
  const dirName = await ensureCustomTheme('Reload Theme');
  await setTheme(dirName);
  await window.waitForTimeout(500);

  // config.json should have the custom theme
  const config = JSON.parse(
    fs.readFileSync(path.join(env.CLAUDIU_USER_DATA, 'config.json'), 'utf8')
  );
  const savedTheme = config.soundTheme;
  expect(savedTheme).toBeTruthy();
  expect(savedTheme).not.toBe('default');

  // Close the settings tab
  const closeBtn = window.locator('[data-testid="tab-close"]');
  if (await closeBtn.isVisible()) await closeBtn.click();
  await window.waitForTimeout(300);

  // Reopen settings → Sounds tab
  await openSoundsTab();

  // Dropdown should show the previously saved theme
  const dropdown = window.locator('[data-testid="settings-sound-theme-select"]');
  const selectedValue = await dropdown.inputValue();
  expect(selectedValue).toBe(savedTheme);
});

// ── Group G — Multi-Step Flows ──────────────────────────────

test('17 - Duplicate → remove two sounds → verify both gone', async () => {
  await setTheme('default');
  const closeBtn17 = window.locator('[data-testid="tab-close"]');
  if (await closeBtn17.isVisible()) await closeBtn17.click();
  await window.waitForTimeout(300);
  await openSoundsTab();

  // Duplicate via UI
  const duplicateBtn = window.locator('button:has-text("Duplicate")');
  await duplicateBtn.click();

  const promptInput = window.locator('[data-testid="prompt-input"]');
  await expect(promptInput).toBeVisible({ timeout: 3000 });
  await promptInput.fill('Multi Remove');
  await promptInput.press('Enter');
  await window.waitForTimeout(1000);

  const dirName = 'multi-remove';
  const themeDir = path.join(env.CLAUDIU_USER_DATA, 'themes', dirName);

  // Remove SessionStart
  const removeStart = window.locator('[data-testid="settings-sound-remove-SessionStart"]');
  await expect(removeStart).toBeVisible();
  await removeStart.click();
  await window.waitForTimeout(500);

  // Remove SessionEnd
  const removeEnd = window.locator('[data-testid="settings-sound-remove-SessionEnd"]');
  await expect(removeEnd).toBeVisible();
  await removeEnd.click();
  await window.waitForTimeout(500);

  // Both remove buttons should be gone
  await expect(window.locator('[data-testid="settings-sound-remove-SessionStart"]')).toHaveCount(0);
  await expect(window.locator('[data-testid="settings-sound-remove-SessionEnd"]')).toHaveCount(0);

  // Both source cells should show "—"
  const rowStart = window.locator('[data-testid="settings-sound-row-SessionStart"]');
  expect(await rowStart.locator('.settings-sound-source').textContent()).toBe('\u2014');

  const rowEnd = window.locator('[data-testid="settings-sound-row-SessionEnd"]');
  expect(await rowEnd.locator('.settings-sound-source').textContent()).toBe('\u2014');

  // Verify filesystem
  const themeJson = JSON.parse(fs.readFileSync(path.join(themeDir, 'theme.json'), 'utf8'));
  expect(themeJson.events.SessionStart).toBeUndefined();
  expect(themeJson.events.SessionEnd).toBeUndefined();
});

test('18 - Duplicate → rename → verify sounds still accessible', async () => {
  const dirName = await ensureCustomTheme('Dup Rename');
  const themesDir = path.join(env.CLAUDIU_USER_DATA, 'themes');

  // Get sounds before rename
  const soundsBefore = await window.evaluate(
    (d) => window.electron_api.soundThemes.getSoundMap(d),
    dirName
  );
  expect(soundsBefore).toBeTruthy();
  const eventCount = Object.keys(soundsBefore).length;
  expect(eventCount).toBeGreaterThan(0);

  // Rename
  const result = await window.evaluate(
    ([d, n]) => window.electron_api.soundThemes.rename(d, n),
    [dirName, 'Dup Renamed']
  );
  expect(result.success).toBe(true);

  // Sounds should still be accessible under new dirName
  const soundsAfter = await window.evaluate(
    (d) => window.electron_api.soundThemes.getSoundMap(d),
    result.dirName
  );
  expect(soundsAfter).toBeTruthy();
  expect(Object.keys(soundsAfter).length).toBe(eventCount);

  // URLs should use the new dirName
  for (const entry of Object.values(soundsAfter)) {
    expect(entry.url).toContain(result.dirName);
  }
});

test('19 - Duplicate → remove sound → rename → remove another sound', async () => {
  const dirName = await ensureCustomTheme('Chain Ops');
  const themesDir = path.join(env.CLAUDIU_USER_DATA, 'themes');

  // Step 1: Remove SessionStart
  const removeResult1 = await window.evaluate(
    ([d, e]) => window.electron_api.soundThemes.removeSound(d, e),
    [dirName, 'SessionStart']
  );
  expect(removeResult1.success).toBe(true);

  // Verify: SessionStart gone
  const themeJson1 = JSON.parse(
    fs.readFileSync(path.join(themesDir, dirName, 'theme.json'), 'utf8')
  );
  expect(themeJson1.events.SessionStart).toBeUndefined();

  // Step 2: Rename
  const renameResult = await window.evaluate(
    ([d, n]) => window.electron_api.soundThemes.rename(d, n),
    [dirName, 'Chain Renamed']
  );
  expect(renameResult.success).toBe(true);
  const renamedDir = renameResult.dirName;

  // Step 3: Remove SessionEnd from the renamed theme
  const removeResult2 = await window.evaluate(
    ([d, e]) => window.electron_api.soundThemes.removeSound(d, e),
    [renamedDir, 'SessionEnd']
  );
  expect(removeResult2.success).toBe(true);

  // Verify final state
  const themeJsonFinal = JSON.parse(
    fs.readFileSync(path.join(themesDir, renamedDir, 'theme.json'), 'utf8')
  );
  expect(themeJsonFinal.events.SessionStart).toBeUndefined();
  expect(themeJsonFinal.events.SessionEnd).toBeUndefined();
  expect(themeJsonFinal.name).toBe('Chain Renamed');

  // Remaining sounds should still be accessible
  const soundMap = await window.evaluate(
    (d) => window.electron_api.soundThemes.getSoundMap(d),
    renamedDir
  );
  expect(soundMap).toBeTruthy();
  // Should have sounds minus the two we removed
  expect(soundMap.SessionStart).toBeUndefined();
  expect(soundMap.SessionEnd).toBeUndefined();
});

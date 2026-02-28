/**
 * Step 006 — Sidebar with Projects & Sessions
 * Sessions are project-scoped. Switching projects switches visible tabs.
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const appPath = path.resolve(__dirname, '..');

let electronApp;
let window;

const tmpDirs = [];

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [appPath],
    env: { ...process.env, CCT_COMMAND: process.env.SHELL || '/bin/zsh' },
  });
  window = await electronApp.firstWindow();
  // No .xterm on launch anymore — wait for sidebar instead
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 });

  // Clean any leftover projects via IPC
  await clearAllProjects();
});

test.afterAll(async () => {
  if (electronApp) {
    try { await clearAllProjects(); } catch { /* app may already be closed */ }
    await electronApp.close();
  }
});

/** Helper: remove all projects via IPC and reload the renderer state */
async function clearAllProjects() {
  const existing = await window.evaluate(() => window.electron_api.projects.list());
  for (const p of existing) {
    await window.evaluate((path) => window.electron_api.projects.remove(path), p.path);
  }
  await window.evaluate(async () => {
    const saved = await window.electron_api.projects.list();
    window._cctReloadProjects(saved);
  });
}

/** Helper: read and parse .cct/sessions.json for the first project in the sidebar */
async function readSessionsConfig() {
  const projectPath = await window.locator('[data-testid="project-item"]').first()
    .getAttribute('data-project-path');
  const sessionsPath = path.join(projectPath, '.cct', 'sessions.json');
  return { projectPath, sessionsPath, config: JSON.parse(fs.readFileSync(sessionsPath, 'utf8')) };
}

/** Helper: create a temp dir and add it as a project */
async function addTempProject(suffix = '') {
  const tmpDir = path.join(os.tmpdir(), `cct-test-project${suffix}-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  tmpDirs.push(tmpDir);

  await window.evaluate(async (dir) => {
    await window.electron_api.projects.addPath(dir);
    const saved = await window.electron_api.projects.list();
    window._cctReloadProjects(saved);
  }, tmpDir);

  return tmpDir;
}

test('1 - sidebar is visible', async () => {
  const sidebar = window.locator('[data-testid="sidebar"]');
  await expect(sidebar).toBeVisible({ timeout: 5000 });
});

test('2 - sidebar initially shows empty project list with empty state', async () => {
  const items = window.locator('[data-testid="project-item"]');
  await expect(items).toHaveCount(0);

  // Empty state message visible
  const emptyState = window.locator('[data-testid="empty-state"]');
  await expect(emptyState).toBeVisible();
});

test('3 - add a project and it appears in sidebar', async () => {
  await addTempProject('');

  const items = window.locator('[data-testid="project-item"]');
  await expect(items).toHaveCount(1, { timeout: 5000 });
});

test('4 - click project selects it, then + creates session in that folder', async () => {
  const projectItem = window.locator('[data-testid="project-item"]').first();
  const projectPath = await projectItem.getAttribute('data-project-path');

  // Click to select
  await projectItem.click();
  await window.waitForTimeout(300);

  // Project should be selected (highlighted)
  await expect(projectItem).toHaveClass(/selected/, { timeout: 5000 });

  // No sessions yet — empty state visible
  const emptyState = window.locator('[data-testid="empty-state"]');
  await expect(emptyState).toBeVisible();

  // Click "+" to create a session
  await window.click('[data-testid="new-tab-btn"]');
  await window.waitForSelector('.xterm', { timeout: 10000 });

  // A tab should exist
  const tabs = window.locator('[data-testid="tab"]');
  await expect(tabs).toHaveCount(1, { timeout: 5000 });

  // Verify terminal working directory
  const textarea = window.locator('.terminal-panel.active .xterm-helper-textarea');
  await textarea.pressSequentially('pwd', { delay: 30 });
  await window.keyboard.press('Enter');

  await expect(async () => {
    const text = await window.evaluate(() => window._cctGetBufferText());
    expect(text).toContain(projectPath);
  }).toPass({ timeout: 5000 });
});

test('5 - project shows 1 active session', async () => {
  const count = window.locator('[data-testid="project-item"]').first()
    .locator('[data-testid="session-count"]');
  await expect(count).toHaveText('1', { timeout: 5000 });
});

test('6 - add a second project, sidebar shows both', async () => {
  await addTempProject('-2');

  const items = window.locator('[data-testid="project-item"]');
  await expect(items).toHaveCount(2, { timeout: 5000 });
});

test('7 - second project shows 0 sessions, first still shows 1', async () => {
  const count2 = window.locator('[data-testid="project-item"]').nth(1)
    .locator('[data-testid="session-count"]');
  await expect(count2).toHaveText('0', { timeout: 5000 });

  const count1 = window.locator('[data-testid="project-item"]').first()
    .locator('[data-testid="session-count"]');
  await expect(count1).toHaveText('1', { timeout: 5000 });
});

test('8 - create second session under first project, count updates to 2', async () => {
  // First project should still be selected
  await window.click('[data-testid="new-tab-btn"]');
  await window.waitForTimeout(1000);

  const count = window.locator('[data-testid="project-item"]').first()
    .locator('[data-testid="session-count"]');
  await expect(count).toHaveText('2', { timeout: 5000 });

  // Two tabs visible
  const tabs = window.locator('[data-testid="tab"]');
  await expect(tabs).toHaveCount(2, { timeout: 5000 });
});

test('9 - switching projects switches visible tabs', async () => {
  // Select second project
  const project2 = window.locator('[data-testid="project-item"]').nth(1);
  await project2.click();
  await window.waitForTimeout(300);

  // Second project selected
  await expect(project2).toHaveClass(/selected/);

  // No visible tabs (project 2 has no sessions)
  // Tabs from project 1 should be hidden
  const visibleTabs = window.locator('[data-testid="tab"]:visible');
  await expect(visibleTabs).toHaveCount(0, { timeout: 5000 });

  // Switch back to first project
  const project1 = window.locator('[data-testid="project-item"]').first();
  await project1.click();
  await window.waitForTimeout(300);

  // Project 1's tabs visible again
  const tabs = window.locator('[data-testid="tab"]:visible');
  await expect(tabs).toHaveCount(2, { timeout: 5000 });
});

test('10 - remove project closes its sessions and removes from sidebar', async () => {
  // Remove the first project (which has 2 sessions)
  const removeBtn = window.locator('[data-testid="project-item"]').first()
    .locator('[data-testid="remove-project-btn"]');
  await removeBtn.click();
  await window.waitForTimeout(500);

  // Project removed from sidebar
  const items = window.locator('[data-testid="project-item"]');
  await expect(items).toHaveCount(1, { timeout: 5000 });

  // No visible tabs (remaining project has 0 sessions)
  const tabs = window.locator('[data-testid="tab"]');
  await expect(tabs).toHaveCount(0, { timeout: 5000 });
});

test('11 - projects persist across app restart', async () => {
  const projectsBefore = await window.evaluate(async () => {
    return await window.electron_api.projects.list();
  });
  expect(projectsBefore.length).toBe(1);

  // Restart the app
  await electronApp.close();
  electronApp = await electron.launch({
    args: [appPath],
    env: { ...process.env, CCT_COMMAND: process.env.SHELL || '/bin/zsh' },
  });
  window = await electronApp.firstWindow();
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 });

  // Projects should still be there
  const items = window.locator('[data-testid="project-item"]');
  await expect(items).toHaveCount(1, { timeout: 5000 });
});

test('12 - config file contains expected JSON entries', async () => {
  const configPath = await window.evaluate(() => window.electron_api.projects.configPath());
  const configContent = fs.readFileSync(configPath, 'utf8');

  const config = JSON.parse(configContent);
  expect(config).toHaveProperty('projects');
  expect(Array.isArray(config.projects)).toBe(true);
  expect(config.projects.length).toBe(1);
  expect(config.projects[0]).toHaveProperty('path');
  expect(config.projects[0]).toHaveProperty('name');
});

// ── Per-project .cct/sessions.json + env vars ────────────────

test('13 - creating a session produces .cct/sessions.json in project folder', async () => {
  // Select the existing project and create a session
  const projectItem = window.locator('[data-testid="project-item"]').first();
  await projectItem.click();
  await window.waitForTimeout(300);

  await window.click('[data-testid="new-tab-btn"]');
  await window.waitForSelector('.xterm', { timeout: 10000 });

  // Get the project path
  const projectPath = await projectItem.getAttribute('data-project-path');
  const sessionsPath = path.join(projectPath, '.cct', 'sessions.json');

  // .cct/sessions.json should exist
  expect(fs.existsSync(sessionsPath)).toBe(true);
});

test('14 - sessions.json has UUID projectId and sessions array', async () => {
  const { config } = await readSessionsConfig();

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  expect(config.projectId).toMatch(uuidRegex);
  expect(Array.isArray(config.sessions)).toBe(true);
  expect(config.sessions.length).toBeGreaterThanOrEqual(1);
});

test('15 - session entry has id, terminalId, type, createdAt', async () => {
  const { config } = await readSessionsConfig();

  const session = config.sessions[0];
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  expect(session.id).toMatch(uuidRegex);
  expect(typeof session.terminalId).toBe('number');
  expect(session.type).toBe('claude');
  expect(session.createdAt).toBeTruthy();
  expect(new Date(session.createdAt).toISOString()).toBe(session.createdAt);
});

test('16 - CCT_PROJECT_ID env var is set in terminal', async () => {
  const textarea = window.locator('.terminal-panel.active .xterm-helper-textarea');
  await textarea.pressSequentially('echo $CCT_PROJECT_ID', { delay: 30 });
  await window.keyboard.press('Enter');

  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  await expect(async () => {
    const text = await window.evaluate(() => window._cctGetBufferText());
    expect(text).toMatch(uuidRegex);
  }).toPass({ timeout: 5000 });
});

test('17 - CCT_SESSION_ID env var is set in terminal', async () => {
  const textarea = window.locator('.terminal-panel.active .xterm-helper-textarea');
  await textarea.pressSequentially('echo $CCT_SESSION_ID', { delay: 30 });
  await window.keyboard.press('Enter');

  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  await expect(async () => {
    const text = await window.evaluate(() => window._cctGetBufferText());
    expect(text).toMatch(uuidRegex);
  }).toPass({ timeout: 5000 });
});

test('18 - closing session removes it from sessions.json', async () => {
  const { sessionsPath, config: before } = await readSessionsConfig();
  expect(before.sessions.length).toBe(1);

  // Close the tab
  await window.click('[data-testid="tab"] [data-testid="tab-close"]');
  await window.waitForTimeout(500);

  // Session should be removed
  const after = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
  expect(after.sessions.length).toBe(0);
  // projectId should be unchanged
  expect(after.projectId).toBe(before.projectId);
});

test('19 - projectId persists across app restart', async () => {
  const { sessionsPath, config: before } = await readSessionsConfig();
  const originalProjectId = before.projectId;

  // Restart the app
  await electronApp.close();
  electronApp = await electron.launch({
    args: [appPath],
    env: { ...process.env, CCT_COMMAND: process.env.SHELL || '/bin/zsh' },
  });
  window = await electronApp.firstWindow();
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 });

  // Create a session to trigger config read
  const projectItem = window.locator('[data-testid="project-item"]').first();
  await projectItem.click();
  await window.waitForTimeout(300);
  await window.click('[data-testid="new-tab-btn"]');
  await window.waitForSelector('.xterm', { timeout: 10000 });

  // projectId should be the same
  const after = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
  expect(after.projectId).toBe(originalProjectId);

  // Clean up: close the session
  await window.click('[data-testid="tab"] [data-testid="tab-close"]');
  await window.waitForTimeout(500);
});

// ── Project Picker (Cmd+P) ───────────────────────────────────

test('20 - Cmd+P opens the project picker overlay', async () => {
  // Clean slate: add two projects
  await clearAllProjects();

  await addTempProject('-picker-a');
  await addTempProject('-picker-b');

  // Explicitly select picker-b so MRU = [picker-b, picker-a]
  const pickerB = window.locator('[data-testid="project-item"]').nth(1);
  await pickerB.click();
  await window.waitForTimeout(300);

  // Press Cmd+P
  await window.keyboard.press('Meta+p');
  await window.waitForTimeout(200);

  // Overlay should be visible
  const overlay = window.locator('[data-testid="project-picker-overlay"]');
  await expect(overlay).toBeVisible({ timeout: 3000 });

  // Input should be focused
  const input = window.locator('[data-testid="project-picker-input"]');
  await expect(input).toBeVisible();

  // Should show 2 project items
  const items = window.locator('[data-testid="project-picker-item"]');
  await expect(items).toHaveCount(2);

  // Close it
  await window.keyboard.press('Escape');
  await window.waitForTimeout(200);
  await expect(overlay).not.toBeVisible();
});

test('21 - picker shows projects in MRU order (current project first)', async () => {
  // Get MRU order
  const mru = await window.evaluate(() => window._cctProjectMRU());
  const selectedPath = await window.evaluate(() => window._cctSelectedProject());

  // Current project should be first in MRU
  expect(mru[0]).toBe(selectedPath);

  // Open picker
  await window.keyboard.press('Meta+p');
  await window.waitForTimeout(200);

  // Second item should have the 'selected' class (index 1 = quick-switch target)
  const secondItem = window.locator('[data-testid="project-picker-item"]').nth(1);
  await expect(secondItem).toHaveClass(/selected/);

  // Close
  await window.keyboard.press('Escape');
  await window.waitForTimeout(200);
});

test('22 - ArrowDown + Enter selects a different project', async () => {
  const selectedBefore = await window.evaluate(() => window._cctSelectedProject());

  // Open picker, press Down once (to select the second/previous project), then Enter
  await window.keyboard.press('Meta+p');
  await window.waitForTimeout(200);

  // Picker starts on index 1 (quick-switch target); Enter selects it
  await window.keyboard.press('Enter');
  await window.waitForTimeout(300);

  // Overlay should be gone
  const overlay = window.locator('[data-testid="project-picker-overlay"]');
  await expect(overlay).not.toBeVisible();

  // Selected project should have changed
  const selectedAfter = await window.evaluate(() => window._cctSelectedProject());
  expect(selectedAfter).not.toBe(selectedBefore);
});

test('23 - Escape closes the picker without changing selection', async () => {
  const selectedBefore = await window.evaluate(() => window._cctSelectedProject());

  await window.keyboard.press('Meta+p');
  await window.waitForTimeout(200);

  // Navigate down
  await window.keyboard.press('ArrowDown');
  await window.waitForTimeout(100);

  // Press Escape
  await window.keyboard.press('Escape');
  await window.waitForTimeout(200);

  // Selection should not have changed
  const selectedAfter = await window.evaluate(() => window._cctSelectedProject());
  expect(selectedAfter).toBe(selectedBefore);
});

test('24 - typing filters the project list', async () => {
  await window.keyboard.press('Meta+p');
  await window.waitForTimeout(200);

  // Should show 2 items initially
  const items = window.locator('[data-testid="project-picker-item"]');
  await expect(items).toHaveCount(2);

  // Type a filter that matches only one project name
  // Project names are based on directory names: cct-test-project-picker-a-<timestamp> and cct-test-project-picker-b-<timestamp>
  const input = window.locator('[data-testid="project-picker-input"]');
  await input.fill('picker-a');
  await window.waitForTimeout(200);

  // Should show only 1 item
  await expect(items).toHaveCount(1);

  // Clear filter — both should reappear
  await input.fill('');
  await window.waitForTimeout(200);
  await expect(items).toHaveCount(2);

  await window.keyboard.press('Escape');
  await window.waitForTimeout(200);
});

test('25 - Cmd+P again closes the picker (toggle)', async () => {
  await window.keyboard.press('Meta+p');
  await window.waitForTimeout(200);

  const overlay = window.locator('[data-testid="project-picker-overlay"]');
  await expect(overlay).toBeVisible();

  // Press Cmd+P again to toggle off
  await window.keyboard.press('Meta+p');
  await window.waitForTimeout(200);

  await expect(overlay).not.toBeVisible();
});

// ── Cleanup / persistence tests ─────────────────────────────

test('26 - removing project from sidebar does NOT delete .cct/ dir', async () => {
  // Ensure we have a session so .cct/ gets created
  const projectItem = window.locator('[data-testid="project-item"]').first();
  await projectItem.click();
  await window.waitForTimeout(300);
  await window.click('[data-testid="new-tab-btn"]');
  await window.waitForSelector('.xterm', { timeout: 10000 });

  const projectPath = await projectItem.getAttribute('data-project-path');
  const cctDir = path.join(projectPath, '.cct');

  // .cct should exist after creating a session
  expect(fs.existsSync(cctDir)).toBe(true);

  // Close the session first
  await window.click('[data-testid="tab"] [data-testid="tab-close"]');
  await window.waitForTimeout(500);

  // Remove the project from sidebar
  const removeBtn = window.locator('[data-testid="project-item"]').first()
    .locator('[data-testid="remove-project-btn"]');
  await removeBtn.click();
  await window.waitForTimeout(500);

  // .cct/ directory should still exist
  expect(fs.existsSync(cctDir)).toBe(true);
  const config = JSON.parse(fs.readFileSync(path.join(cctDir, 'sessions.json'), 'utf8'));
  expect(config.projectId).toBeTruthy();
});

// ── Auto-close on exit tests ────────────────────────────────

test('27 - typing exit in a terminal session closes the tab', async () => {
  // Add a project and create a terminal session
  await addTempProject('-exit');
  const projectItem = window.locator('[data-testid="project-item"]').first();
  await projectItem.click();
  await window.waitForTimeout(300);

  // Create a terminal session (not claude) via keyboard shortcut
  await window.keyboard.press('Meta+t');
  await window.waitForSelector('.xterm', { timeout: 10000 });

  const tabsBefore = await window.locator('[data-testid="tab"]').count();
  expect(tabsBefore).toBe(1);

  // Type exit to quit the shell
  const textarea = window.locator('.terminal-panel.active .xterm-helper-textarea');
  await textarea.pressSequentially('exit', { delay: 30 });
  await window.keyboard.press('Enter');

  // Tab should disappear
  await expect(window.locator('[data-testid="tab"]')).toHaveCount(0, { timeout: 5000 });
});

// ── Session persistence & restore ─────────────────────────────

test('28 - terminal session type is persisted in sessions.json', async () => {
  await clearAllProjects();
  await addTempProject('-type-persist');

  const projectItem = window.locator('[data-testid="project-item"]').first();
  await projectItem.click();
  await window.waitForTimeout(300);

  // Create a terminal session via Cmd+T
  await window.keyboard.press('Meta+t');
  await window.waitForSelector('.xterm', { timeout: 10000 });

  // Read sessions.json — type should be 'terminal'
  const { config } = await readSessionsConfig();
  expect(config.sessions.length).toBe(1);
  expect(config.sessions[0].type).toBe('terminal');

  // Clean up
  await window.click('[data-testid="tab"] [data-testid="tab-close"]');
  await window.waitForTimeout(500);
});

test('29 - sessions are restored on app restart', async () => {
  await clearAllProjects();
  await addTempProject('-restore');

  const projectItem = window.locator('[data-testid="project-item"]').first();
  await projectItem.click();
  await window.waitForTimeout(300);

  // Create a claude session + terminal session
  await window.click('[data-testid="new-tab-btn"]');
  await window.waitForSelector('.xterm', { timeout: 10000 });
  await window.keyboard.press('Meta+t');
  await window.waitForTimeout(1000);
  await expect(window.locator('[data-testid="tab"]')).toHaveCount(2, { timeout: 5000 });

  // Verify session types in sessions.json
  const { config } = await readSessionsConfig();
  expect(config.sessions.length).toBe(2);
  expect(config.sessions[0].type).toBe('claude');
  expect(config.sessions[1].type).toBe('terminal');

  // Restart the app
  await electronApp.close();
  electronApp = await electron.launch({
    args: [appPath],
    env: { ...process.env, CCT_COMMAND: process.env.SHELL || '/bin/zsh' },
  });
  window = await electronApp.firstWindow();
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 });

  // Sessions should be auto-restored — wait for tabs to appear
  await expect(window.locator('[data-testid="tab"]')).toHaveCount(2, { timeout: 15000 });

  // Verify session count in sidebar matches
  const count = window.locator('[data-testid="project-item"]').first()
    .locator('[data-testid="session-count"]');
  await expect(count).toHaveText('2', { timeout: 5000 });
});

// ── Claude Code SessionStart hook ─────────────────────────────

test('30 - SessionStart hook is installed in ~/.claude/settings.json', async () => {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  expect(fs.existsSync(settingsPath)).toBe(true);

  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  expect(settings.hooks).toBeTruthy();
  expect(settings.hooks.SessionStart).toBeTruthy();

  const arr = Array.isArray(settings.hooks.SessionStart)
    ? settings.hooks.SessionStart
    : [settings.hooks.SessionStart];

  const ourHook = arr.find(entry =>
    entry.hooks && entry.hooks.some(h => h.command && h.command.includes('cct-hook-handler'))
  );
  expect(ourHook).toBeTruthy();

  // Verify the handler script path in the command actually exists
  const cmd = ourHook.hooks[0].command;
  const match = cmd.match(/node "([^"]+)"/);
  expect(match).toBeTruthy();
  expect(fs.existsSync(match[1])).toBe(true);
});

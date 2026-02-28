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
  electronApp = await electron.launch({ args: [appPath] });
  window = await electronApp.firstWindow();
  // No .xterm on launch anymore — wait for sidebar instead
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 });

  // Clean any leftover projects via IPC
  const existing = await window.evaluate(() => window.electron_api.projects.list());
  for (const p of existing) {
    await window.evaluate((path) => window.electron_api.projects.remove(path), p.path);
  }
  await window.evaluate(async () => {
    const saved = await window.electron_api.projects.list();
    window._cctReloadProjects(saved);
  });
});

test.afterAll(async () => {
  if (electronApp) {
    try {
      const win = await electronApp.firstWindow();
      const existing = await win.evaluate(() => window.electron_api.projects.list());
      for (const p of existing) {
        await win.evaluate((path) => window.electron_api.projects.remove(path), p.path);
      }
    } catch { /* app may already be closed */ }
    await electronApp.close();
  }
});

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
  electronApp = await electron.launch({ args: [appPath] });
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
  const projectPath = await window.locator('[data-testid="project-item"]').first()
    .getAttribute('data-project-path');
  const sessionsPath = path.join(projectPath, '.cct', 'sessions.json');
  const config = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));

  // projectId should be a UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  expect(config.projectId).toMatch(uuidRegex);
  expect(Array.isArray(config.sessions)).toBe(true);
  expect(config.sessions.length).toBeGreaterThanOrEqual(1);
});

test('15 - session entry has id, terminalId, createdAt', async () => {
  const projectPath = await window.locator('[data-testid="project-item"]').first()
    .getAttribute('data-project-path');
  const sessionsPath = path.join(projectPath, '.cct', 'sessions.json');
  const config = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));

  const session = config.sessions[0];
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  expect(session.id).toMatch(uuidRegex);
  expect(typeof session.terminalId).toBe('number');
  expect(session.createdAt).toBeTruthy();
  // createdAt should be a valid ISO date
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
  const projectPath = await window.locator('[data-testid="project-item"]').first()
    .getAttribute('data-project-path');
  const sessionsPath = path.join(projectPath, '.cct', 'sessions.json');

  // Verify session is currently tracked
  const before = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
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
  const projectPath = await window.locator('[data-testid="project-item"]').first()
    .getAttribute('data-project-path');
  const sessionsPath = path.join(projectPath, '.cct', 'sessions.json');
  const before = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
  const originalProjectId = before.projectId;

  // Restart the app
  await electronApp.close();
  electronApp = await electron.launch({ args: [appPath] });
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

test('20 - removing project from sidebar does NOT delete .cct/ dir', async () => {
  const projectPath = await window.locator('[data-testid="project-item"]').first()
    .getAttribute('data-project-path');
  const cctDir = path.join(projectPath, '.cct');

  // .cct should exist from earlier tests
  expect(fs.existsSync(cctDir)).toBe(true);

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

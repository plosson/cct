/**
 * Verify settings tab UI polish — centering, scope underline, project colors.
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

  // Pre-seed a project
  const projectsFile = path.join(env.CLAUDIU_USER_DATA, 'projects.json');
  fs.mkdirSync(env.CLAUDIU_USER_DATA, { recursive: true });
  fs.writeFileSync(projectsFile, JSON.stringify({
    projects: [{ path: projectDir, name: 'TestProject' }]
  }));

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

test('1 - settings content is centered (margin auto)', async () => {
  // Make window wide enough to test centering
  await electronApp.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1200, 800);
  });
  await window.waitForTimeout(500);

  await window.keyboard.press('Meta+,');
  await window.waitForSelector('[data-testid="settings-nav-general"]', { timeout: 3000 });
  await window.waitForTimeout(300);

  const layout = await window.evaluate(() => {
    const names = ['settings-tab-panel', 'settings-container', 'settings-layout', 'settings-content', 'settings-section'];
    const result = {};
    for (const cls of names) {
      const el = document.querySelector('.' + cls);
      if (!el) { result[cls] = 'NOT FOUND'; continue; }
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      result[cls] = { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), display: s.display, flex: s.flex, position: s.position, margin: s.margin, maxWidth: s.maxWidth };
    }
    return result;
  });

  console.log('Full layout chain:', JSON.stringify(layout, null, 2));

  // The section should be centered within the content area
  const contentW = layout['settings-content']?.w || 0;
  const sectionW = layout['settings-section']?.w || 0;
  console.log('Content width:', contentW, 'Section width:', sectionW);

  expect(layout['settings-section']?.maxWidth).toBe('480px');

  // If content is wide enough, section should be centered
  if (contentW > 620) {
    const contentLeft = layout['settings-content'].left;
    const sectionLeft = layout['settings-section'].left;
    const sectionOffsetLeft = sectionLeft - contentLeft;
    const sectionOffsetRight = contentW - sectionOffsetLeft - sectionW;
    console.log('Offset left:', sectionOffsetLeft, 'Offset right:', sectionOffsetRight);
    expect(Math.abs(sectionOffsetLeft - sectionOffsetRight)).toBeLessThan(10);
  }
});

test('2 - scope underline uses ::after pseudo-element (not border-bottom)', async () => {
  // Ensure settings is open
  const navVisible = await window.locator('[data-testid="settings-nav-general"]').isVisible().catch(() => false);
  if (!navVisible) {
    await window.keyboard.press('Meta+,');
    await window.waitForSelector('[data-testid="settings-nav-general"]', { timeout: 3000 });
    await window.waitForTimeout(300);
  }

  // Wait for scope button to appear
  await window.waitForSelector('.settings-scope-btn.active', { timeout: 3000 });

  // Active scope button should NOT have a visible border-bottom
  const borderBottom = await window.evaluate(() => {
    const btn = document.querySelector('.settings-scope-btn.active');
    if (!btn) return 'NOT FOUND';
    const style = window.getComputedStyle(btn);
    return style.borderBottomStyle;
  });
  expect(borderBottom).toBe('none');

  // The ::after should be positioned (we can check the button has position: relative)
  const position = await window.evaluate(() => {
    const btn = document.querySelector('.settings-scope-btn');
    return window.getComputedStyle(btn).position;
  });
  expect(position).toBe('relative');
});

test('3 - project scope button gets project color when active', async () => {
  // Ensure a project is selected in the sidebar first
  await window.locator('.sidebar-project').first().click();
  await window.waitForTimeout(300);

  // Close settings if open and reopen (to pick up selected project)
  const navVisible = await window.locator('[data-testid="settings-nav-general"]').isVisible().catch(() => false);
  if (navVisible) {
    const settingsTabClose = window.locator('.tab-item .tab-label:has-text("Settings")').locator('..').locator('.tab-close');
    if (await settingsTabClose.isVisible().catch(() => false)) {
      await settingsTabClose.click();
      await window.waitForTimeout(200);
    }
  }
  await window.keyboard.press('Meta+,');
  await window.waitForSelector('[data-testid="settings-scope-project"]', { timeout: 3000 });
  await window.waitForTimeout(300);

  // Click on project scope
  await window.locator('[data-testid="settings-scope-project"]').click();
  await window.waitForTimeout(200);

  // The project scope button should have an inline color style (project color)
  const projectBtnColor = await window.evaluate(() => {
    const btn = document.querySelector('[data-testid="settings-scope-project"]');
    return btn ? btn.style.color : '';
  });

  // Browser resolves hsl to rgb — just verify a color was applied
  expect(projectBtnColor).toBeTruthy();
  expect(projectBtnColor).not.toBe('');

  // Switch back to global — project button should lose its color
  await window.locator('[data-testid="settings-scope-global"]').click();
  await window.waitForTimeout(200);

  const projectBtnColorAfter = await window.evaluate(() => {
    const btn = document.querySelector('[data-testid="settings-scope-project"]');
    return btn ? btn.style.color : '';
  });
  expect(projectBtnColorAfter).toBe('');
});

test('4 - settings tab icon uses project color when project selected', async () => {
  // Close current settings tab if open
  const settingsTabClose = window.locator('.tab-item .tab-label:has-text("Settings")').locator('..').locator('.tab-close');
  if (await settingsTabClose.isVisible().catch(() => false)) {
    await settingsTabClose.click();
    await window.waitForTimeout(200);
  }

  // Select the project in sidebar first
  await window.locator('.sidebar-project').first().click();
  await window.waitForTimeout(300);

  // Now open settings — tab icon should use project color
  await window.keyboard.press('Meta+,');
  await window.waitForSelector('[data-testid="settings-nav-general"]', { timeout: 3000 });

  const iconStyle = await window.evaluate(() => {
    const icon = document.querySelector('.tab-icon-settings');
    return icon ? icon.getAttribute('style') : '';
  });

  console.log('Tab icon style:', iconStyle);
  // Should contain hsl (project color), not var(--accent)
  expect(iconStyle).toMatch(/hsl/);
  expect(iconStyle).not.toContain('var(--accent)');
});

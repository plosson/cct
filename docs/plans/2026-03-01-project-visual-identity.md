# Project Visual Identity — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give each project a distinct visual identity via a big project name in the titlebar and auto-assigned accent colors across the full top band (titlebar + tab bar + sidebar).

**Architecture:** A curated 12-color palette assigned deterministically by hashing the project name. Colors are applied via CSS custom properties set on `document.documentElement` when switching projects. All themed UI elements (titlebar, tab bar, sidebar) reference these variables.

**Tech Stack:** Vanilla JS, CSS custom properties, no new dependencies.

---

### Task 1: Color Palette Module

**Files:**
- Create: `src/renderer/projectColors.js`
- Test: `tests/step-032-project-identity.spec.js`

**Step 1: Write the failing test**

Create the test file with a basic test that imports the color module:

```js
/**
 * Step 032 — Project Visual Identity
 * Each project gets a distinct accent color and prominent name display.
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
    env: { ...process.env, CLAUDIU_COMMAND: process.env.SHELL || '/bin/zsh' },
  });
  window = await electronApp.firstWindow();
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 });
  await clearAllProjects();
});

test.afterAll(async () => {
  if (electronApp) {
    try { await clearAllProjects(); } catch { /* app may already be closed */ }
    await electronApp.close();
  }
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

async function clearAllProjects() {
  const existing = await window.evaluate(() => window.electron_api.projects.list());
  for (const p of existing) {
    await window.evaluate((path) => window.electron_api.projects.remove(path), p.path);
  }
  await window.evaluate(async () => {
    const saved = await window.electron_api.projects.list();
    window._claudiuReloadProjects(saved);
  });
}

async function addTempProject(name) {
  const tmpDir = path.join(os.tmpdir(), `claudiu-test-${name}-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  tmpDirs.push(tmpDir);

  await window.evaluate(async (dir) => {
    await window.electron_api.projects.addPath(dir);
    const saved = await window.electron_api.projects.list();
    window._claudiuReloadProjects(saved);
  }, tmpDir);

  return tmpDir;
}

test('1 - getProjectColor returns consistent color for same name', async () => {
  const result = await window.evaluate(() => {
    const { getProjectColor } = window._claudiuProjectColors;
    const c1 = getProjectColor('siteio');
    const c2 = getProjectColor('siteio');
    return { same: c1.hue === c2.hue, hasHue: typeof c1.hue === 'number' };
  });
  expect(result.same).toBe(true);
  expect(result.hasHue).toBe(true);
});

test('2 - different project names get different palette indices', async () => {
  const result = await window.evaluate(() => {
    const { getProjectColor } = window._claudiuProjectColors;
    const names = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];
    const indices = names.map(n => getProjectColor(n).index);
    // At least 3 distinct indices out of 6 names (with 12-color palette)
    return new Set(indices).size;
  });
  expect(result).toBeGreaterThanOrEqual(3);
});
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/step-032-project-identity.spec.js --timeout 30000 2>&1 | tail -20`
Expected: FAIL — `_claudiuProjectColors` is not defined

**Step 3: Write the color palette module**

Create `src/renderer/projectColors.js`:

```js
/**
 * Project color palette — deterministic accent colors per project name.
 */

const PALETTE = [
  { name: 'red',    hue: 0,   s: 70, l: 55 },
  { name: 'orange', hue: 25,  s: 80, l: 55 },
  { name: 'amber',  hue: 45,  s: 80, l: 50 },
  { name: 'lime',   hue: 85,  s: 60, l: 45 },
  { name: 'green',  hue: 140, s: 60, l: 45 },
  { name: 'teal',   hue: 175, s: 60, l: 45 },
  { name: 'cyan',   hue: 195, s: 70, l: 50 },
  { name: 'blue',   hue: 215, s: 70, l: 55 },
  { name: 'indigo', hue: 245, s: 60, l: 60 },
  { name: 'purple', hue: 270, s: 60, l: 60 },
  { name: 'pink',   hue: 330, s: 65, l: 55 },
  { name: 'rose',   hue: 350, s: 70, l: 55 },
];

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function getProjectColor(projectName) {
  const index = hashString(projectName) % PALETTE.length;
  const { hue, s, l, name } = PALETTE[index];
  return { index, hue, s, l, name };
}
```

Expose it in `src/renderer/index.js` for testability — add near the top after imports:

```js
import { getProjectColor } from './projectColors.js';

// Expose for testing
window._claudiuProjectColors = { getProjectColor };
```

**Step 4: Rebuild and run test to verify it passes**

Run: `npm run build && npx playwright test tests/step-032-project-identity.spec.js --timeout 30000 2>&1 | tail -20`
Expected: 2 tests PASS

**Step 5: Commit**

```bash
git add src/renderer/projectColors.js tests/step-032-project-identity.spec.js src/renderer/index.js
git commit -m "feat: add project color palette module with deterministic hash assignment"
```

---

### Task 2: Titlebar Project Name Display

**Files:**
- Modify: `index.html:13` (add content inside `.titlebar-drag-region`)
- Modify: `styles/base.css:21-25` (style the titlebar content)
- Modify: `src/renderer/index.js` (`selectProject` function, ~line 161)
- Test: `tests/step-032-project-identity.spec.js` (add tests)

**Step 1: Write the failing tests**

Append to the test file:

```js
test('3 - titlebar shows project name when project is selected', async () => {
  const tmpDir = await addTempProject('titlebar');

  // Click the project to select it
  const projectItem = window.locator('[data-testid="project-item"]').first();
  await projectItem.click();
  await window.waitForTimeout(300);

  const titlebarName = window.locator('[data-testid="titlebar-project-name"]');
  await expect(titlebarName).toBeVisible({ timeout: 5000 });

  // Should contain the folder name (last segment of path)
  const text = await titlebarName.textContent();
  expect(text.toLowerCase()).toContain('titlebar');
});

test('4 - titlebar shows monogram with project initial', async () => {
  const monogram = window.locator('[data-testid="titlebar-monogram"]');
  await expect(monogram).toBeVisible();
  const text = await monogram.textContent();
  // Should be a single uppercase letter
  expect(text).toMatch(/^[A-Z]$/);
});
```

**Step 2: Run test to verify it fails**

Run: `npm run build && npx playwright test tests/step-032-project-identity.spec.js -g "titlebar shows project name" --timeout 30000 2>&1 | tail -20`
Expected: FAIL — `[data-testid="titlebar-project-name"]` not found

**Step 3: Add titlebar HTML structure**

In `index.html`, replace line 13:

```html
    <div class="titlebar-drag-region">
      <div class="titlebar-project" data-testid="titlebar-project">
        <span class="titlebar-monogram" data-testid="titlebar-monogram"></span>
        <span class="titlebar-project-name" data-testid="titlebar-project-name"></span>
      </div>
    </div>
```

**Step 4: Add titlebar CSS**

In `styles/base.css`, replace the `.titlebar-drag-region` block (lines 21-25) and add new rules:

```css
.titlebar-drag-region {
  height: 38px;
  -webkit-app-region: drag;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding-left: 80px; /* clear macOS traffic lights */
  transition: background-color 0.2s ease;
}

.titlebar-project {
  display: flex;
  align-items: center;
  gap: 8px;
  -webkit-app-region: no-drag;
  pointer-events: none; /* not interactive, just display */
}

.titlebar-monogram {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: var(--project-accent, #555);
  flex-shrink: 0;
}

.titlebar-project-name {
  font-size: 13px;
  font-weight: 600;
  color: #e0e0e0;
  letter-spacing: 0.3px;
}
```

**Step 5: Wire up in renderer**

In `src/renderer/index.js`, add DOM references in `init()` (after line ~1284):

```js
const titlebarMonogram = document.querySelector('[data-testid="titlebar-monogram"]');
const titlebarProjectName = document.querySelector('[data-testid="titlebar-project-name"]');
```

Add a new function `updateProjectIdentity()`:

```js
function updateProjectIdentity() {
  if (!selectedProjectPath) {
    titlebarMonogram.style.display = 'none';
    titlebarProjectName.textContent = '';
    document.documentElement.removeAttribute('style');
    return;
  }

  const project = projects.find(p => p.path === selectedProjectPath);
  if (!project) return;

  const color = getProjectColor(project.name);
  const accent = `hsl(${color.hue}, ${color.s}%, ${color.l}%)`;

  // Set CSS custom properties
  const root = document.documentElement;
  root.style.setProperty('--project-accent', accent);
  root.style.setProperty('--project-accent-bg', `hsl(${color.hue}, 40%, 15%)`);
  root.style.setProperty('--project-accent-dim', `hsla(${color.hue}, ${color.s}%, ${color.l}%, 0.15)`);
  root.style.setProperty('--project-accent-border', `hsla(${color.hue}, ${color.s}%, ${color.l}%, 0.3)`);

  // Update titlebar
  titlebarMonogram.style.display = '';
  titlebarMonogram.textContent = project.name.charAt(0).toUpperCase();
  titlebarProjectName.textContent = project.name;
}
```

Call `updateProjectIdentity()` at the end of `selectProject()` (after `updateStatusBar()` on line 192).

**Step 6: Rebuild and run tests**

Run: `npm run build && npx playwright test tests/step-032-project-identity.spec.js --timeout 30000 2>&1 | tail -20`
Expected: 4 tests PASS

**Step 7: Commit**

```bash
git add index.html styles/base.css src/renderer/index.js
git commit -m "feat: display project name and colored monogram in titlebar"
```

---

### Task 3: Full Top Band Accent Coloring

**Files:**
- Modify: `styles/base.css` (titlebar bg, tab-bar bg, sidebar selected project)
- Test: `tests/step-032-project-identity.spec.js` (add color tests)

**Step 1: Write the failing tests**

Append to the test file:

```js
test('5 - CSS custom properties are set when project is selected', async () => {
  const accent = await window.evaluate(() => {
    return getComputedStyle(document.documentElement).getPropertyValue('--project-accent').trim();
  });
  // Should be an hsl() value
  expect(accent).toMatch(/^hsl\(/);
});

test('6 - titlebar has tinted background', async () => {
  const bg = await window.evaluate(() => {
    return getComputedStyle(document.querySelector('.titlebar-drag-region')).backgroundColor;
  });
  // Should NOT be transparent or the default #1a1a2e (rgb(26, 26, 46))
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(bg).not.toBe('rgb(26, 26, 46)');
});

test('7 - switching projects changes accent color', async () => {
  const firstAccent = await window.evaluate(() => {
    return getComputedStyle(document.documentElement).getPropertyValue('--project-accent').trim();
  });

  // Add a second project
  await addTempProject('other-project');
  const items = window.locator('[data-testid="project-item"]');
  await expect(items).toHaveCount(2, { timeout: 5000 });

  // Click the second project
  await items.nth(1).click();
  await window.waitForTimeout(300);

  const secondAccent = await window.evaluate(() => {
    return getComputedStyle(document.documentElement).getPropertyValue('--project-accent').trim();
  });

  // The two projects should have different accent colors (different names → different hues)
  expect(secondAccent).not.toBe(firstAccent);
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run build && npx playwright test tests/step-032-project-identity.spec.js -g "titlebar has tinted" --timeout 30000 2>&1 | tail -20`
Expected: FAIL — titlebar background is still transparent/default

**Step 3: Update CSS to use accent variables**

In `styles/base.css`, update these rules:

Titlebar — add background:
```css
.titlebar-drag-region {
  /* ... existing ... */
  background: var(--project-accent-dim, transparent);
}
```

Tab bar — replace the fixed `#16162a` background:
```css
.tab-bar {
  /* ... existing ... */
  background: var(--project-accent-bg, #16162a);
  border-bottom: 1px solid var(--project-accent-border, #2a2a4a);
}
```

Sidebar header — tint it too:
```css
.sidebar-header {
  /* ... existing ... */
  background: var(--project-accent-bg, transparent);
  border-bottom: 1px solid var(--project-accent-border, #2a2a4a);
}
```

Selected sidebar project — accent left border:
```css
.sidebar-project.selected {
  background: var(--project-accent-dim, rgba(255, 255, 255, 0.1));
  color: #e0e0e0;
  border-left: 3px solid var(--project-accent, #58a6ff);
}
```

**Step 4: Rebuild and run all tests**

Run: `npm run build && npx playwright test tests/step-032-project-identity.spec.js --timeout 30000 2>&1 | tail -20`
Expected: 7 tests PASS

**Step 5: Run the full test suite to verify no regressions**

Run: `npx playwright test --timeout 30000 2>&1 | tail -30`
Expected: All existing tests pass

**Step 6: Commit**

```bash
git add styles/base.css
git commit -m "feat: apply project accent color to titlebar, tab bar, and sidebar"
```

---

### Task 4: Polish and Edge Cases

**Files:**
- Modify: `src/renderer/index.js` (clear identity on no project, handle removal)
- Modify: `styles/base.css` (transitions, no-project fallback)
- Test: `tests/step-032-project-identity.spec.js` (edge case tests)

**Step 1: Write the failing tests**

Append to the test file:

```js
test('8 - titlebar is empty when no project is selected', async () => {
  // Remove all projects
  await clearAllProjects();

  const titlebarName = window.locator('[data-testid="titlebar-project-name"]');
  await expect(titlebarName).toHaveText('', { timeout: 5000 });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run build && npx playwright test tests/step-032-project-identity.spec.js -g "titlebar is empty" --timeout 30000 2>&1 | tail -20`
Expected: May pass or fail depending on current cleanup behavior. If it passes, good — the `updateProjectIdentity()` already handles null path.

**Step 3: Ensure identity clears on project removal**

In `src/renderer/index.js`, in the `removeProject()` function, after `selectedProjectPath = null` (or wherever project removal clears the selection), call `updateProjectIdentity()`.

Also ensure the CSS variables are cleared by updating `updateProjectIdentity()` to remove properties when no project:

```js
if (!selectedProjectPath) {
  titlebarMonogram.style.display = 'none';
  titlebarProjectName.textContent = '';
  const root = document.documentElement;
  root.style.removeProperty('--project-accent');
  root.style.removeProperty('--project-accent-bg');
  root.style.removeProperty('--project-accent-dim');
  root.style.removeProperty('--project-accent-border');
  return;
}
```

**Step 4: Run full test suite**

Run: `npm run build && npx playwright test --timeout 30000 2>&1 | tail -30`
Expected: ALL tests pass (including all pre-existing step-001 through step-031)

**Step 5: Commit**

```bash
git add src/renderer/index.js styles/base.css tests/step-032-project-identity.spec.js
git commit -m "feat: clear project identity on deselection, add edge case tests"
```

---

### Task 5: Step Journal

**Files:**
- Create: `notes/STEP_NOTES_032.md`

**Step 1: Write the step journal entry**

Document what was done, choices made, architecture decisions, testing, and lessons.

**Step 2: Commit**

```bash
git add notes/STEP_NOTES_032.md
git commit -m "docs: add step 032 journal entry for project visual identity"
```

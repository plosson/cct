# Step 006 — Sidebar with Projects & Sessions

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a left sidebar where users manage projects (folders on disk) and spawn sessions scoped to each project, with persistence across app restarts.

**Architecture:** New `ProjectStore` service in main process handles CRUD + JSON persistence in Electron's `userData`. Project IPC handlers bridge to renderer. Renderer renders sidebar, tracks which sessions belong to which project, and shows per-project session counts. Existing `TerminalService.create()` already accepts `cwd` — no changes needed there.

**Tech Stack:** Electron IPC, `app.getPath('userData')`, vanilla JS DOM, Playwright e2e tests.

---

### Task 1: Create feature branch

**Step 1: Create and switch to branch**

Run: `git checkout -b step-006-sidebar-projects`

**Step 2: Verify clean state**

Run: `git status`
Expected: On branch step-006-sidebar-projects, nothing to commit

---

### Task 2: ProjectStore service

**Files:**
- Create: `src/main/services/ProjectStore.js`

**Step 1: Write ProjectStore**

```javascript
/**
 * ProjectStore — manages project list with JSON persistence
 * Stores projects in userData/projects.json
 */

const fs = require('fs');
const path = require('path');
const { app, dialog } = require('electron');

class ProjectStore {
  constructor() {
    this._filePath = path.join(app.getPath('userData'), 'projects.json');
    this._projects = [];
    this._load();
  }

  _load() {
    try {
      const data = JSON.parse(fs.readFileSync(this._filePath, 'utf8'));
      this._projects = Array.isArray(data.projects) ? data.projects : [];
    } catch {
      this._projects = [];
    }
  }

  _save() {
    const dir = path.dirname(this._filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this._filePath, JSON.stringify({ projects: this._projects }, null, 2));
  }

  list() {
    return [...this._projects];
  }

  async add() {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Add Project Folder'
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const folderPath = result.filePaths[0];

    // Don't add duplicates
    if (this._projects.some(p => p.path === folderPath)) {
      return this._projects.find(p => p.path === folderPath);
    }

    const project = {
      path: folderPath,
      name: path.basename(folderPath)
    };
    this._projects.push(project);
    this._save();
    return project;
  }

  addPath(folderPath) {
    if (this._projects.some(p => p.path === folderPath)) {
      return this._projects.find(p => p.path === folderPath);
    }
    const project = {
      path: folderPath,
      name: path.basename(folderPath)
    };
    this._projects.push(project);
    this._save();
    return project;
  }

  remove(folderPath) {
    this._projects = this._projects.filter(p => p.path !== folderPath);
    this._save();
  }

  get configPath() {
    return this._filePath;
  }
}

module.exports = { ProjectStore };
```

Notes:
- `add()` opens the native dialog (for real user interaction)
- `addPath(folderPath)` adds directly by path (for tests and programmatic use)
- Duplicate detection by path
- `configPath` getter exposed so tests can verify the JSON file

**Step 2: Commit**

```bash
git add src/main/services/ProjectStore.js
git commit -m "feat(step-006): add ProjectStore service with JSON persistence"
```

---

### Task 3: Project IPC handlers + preload bridge

**Files:**
- Create: `src/main/ipc/project.ipc.js`
- Modify: `src/main/preload.js`
- Modify: `main.js`

**Step 1: Write project IPC handlers**

Create `src/main/ipc/project.ipc.js`:

```javascript
/**
 * Project IPC handlers
 * Bridges renderer ↔ ProjectStore via Electron IPC
 */

const { ipcMain } = require('electron');

/**
 * Register all project-related IPC handlers
 * @param {import('../services/ProjectStore').ProjectStore} projectStore
 */
function registerProjectIPC(projectStore) {
  ipcMain.handle('project-list', () => {
    return projectStore.list();
  });

  ipcMain.handle('project-add', () => {
    return projectStore.add();
  });

  ipcMain.handle('project-add-path', (_event, { folderPath }) => {
    return projectStore.addPath(folderPath);
  });

  ipcMain.handle('project-remove', (_event, { path }) => {
    projectStore.remove(path);
  });

  ipcMain.handle('project-config-path', () => {
    return projectStore.configPath;
  });
}

module.exports = { registerProjectIPC };
```

**Step 2: Extend preload bridge**

Add to `src/main/preload.js` inside the `contextBridge.exposeInMainWorld` call, after the `terminal` namespace:

```javascript
  projects: {
    list: () => ipcRenderer.invoke('project-list'),
    add: () => ipcRenderer.invoke('project-add'),
    addPath: (folderPath) => ipcRenderer.invoke('project-add-path', { folderPath }),
    remove: (path) => ipcRenderer.invoke('project-remove', { path }),
    configPath: () => ipcRenderer.invoke('project-config-path')
  }
```

**Step 3: Wire up in main.js**

In `main.js`, after `registerTerminalIPC(terminalService)`:

```javascript
const { ProjectStore } = require('./src/main/services/ProjectStore');
const { registerProjectIPC } = require('./src/main/ipc/project.ipc');

// Inside app.whenReady():
const projectStore = new ProjectStore();
registerProjectIPC(projectStore);
```

**Step 4: Build and verify app launches**

Run: `npm run build && npx electron .`
Expected: App launches without errors, existing tabs still work.

**Step 5: Commit**

```bash
git add src/main/ipc/project.ipc.js src/main/preload.js main.js
git commit -m "feat(step-006): add project IPC handlers and preload bridge"
```

---

### Task 4: HTML sidebar structure + CSS

**Files:**
- Modify: `index.html`
- Modify: `styles/base.css`

**Step 1: Add sidebar to HTML**

In `index.html`, replace the `.app` div contents with:

```html
<div class="app">
  <div class="titlebar-drag-region"></div>
  <div class="app-body">
    <div class="sidebar" data-testid="sidebar">
      <div class="sidebar-header">
        <span class="sidebar-title">Projects</span>
        <button class="sidebar-add-btn" data-testid="add-project-btn">+</button>
      </div>
      <div class="sidebar-projects" data-testid="project-list"></div>
    </div>
    <div class="main-area">
      <div class="tab-bar" data-testid="tab-bar">
        <div class="tab-bar-tabs"></div>
        <button class="tab-new-btn" data-testid="new-tab-btn">+</button>
      </div>
      <div id="terminals" class="terminals-container"></div>
    </div>
  </div>
</div>
```

**Step 2: Add sidebar CSS**

Add to `styles/base.css`:

```css
/* App body — horizontal split */
.app-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* Sidebar */
.sidebar {
  width: 220px;
  min-width: 180px;
  flex-shrink: 0;
  background: #16162a;
  border-right: 1px solid #2a2a4a;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid #2a2a4a;
  flex-shrink: 0;
}

.sidebar-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #888;
  font-weight: 600;
}

.sidebar-add-btn {
  background: none;
  border: none;
  color: #888;
  font-size: 16px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}

.sidebar-add-btn:hover {
  color: #e0e0e0;
}

.sidebar-projects {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.sidebar-project {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
  color: #ccc;
  user-select: none;
}

.sidebar-project:hover {
  background: rgba(255, 255, 255, 0.05);
}

.sidebar-project-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-project-count {
  font-size: 11px;
  color: #666;
  margin: 0 8px;
  min-width: 16px;
  text-align: center;
}

.sidebar-project-remove {
  background: none;
  border: none;
  color: #666;
  font-size: 12px;
  cursor: pointer;
  padding: 0 2px;
  opacity: 0;
  transition: opacity 0.15s;
}

.sidebar-project:hover .sidebar-project-remove {
  opacity: 1;
}

.sidebar-project-remove:hover {
  color: #ff6b6b;
}

/* Main area — right side of sidebar */
.main-area {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}
```

Also update `.app` to remove the old `flex-direction: column` from `.app` since `.app-body` now handles the layout:

```css
.app {
  height: 100%;
  display: flex;
  flex-direction: column;
}
```

(This stays the same — `.app` is column for titlebar + app-body.)

**Step 3: Build and verify layout**

Run: `npm run build && npx electron .`
Expected: Sidebar visible on the left, terminal area on the right.

**Step 4: Commit**

```bash
git add index.html styles/base.css
git commit -m "feat(step-006): add sidebar HTML structure and CSS"
```

---

### Task 5: Renderer sidebar logic

**Files:**
- Modify: `src/renderer/index.js`

**Step 1: Add sidebar rendering to renderer**

Add project-related state and functions to `src/renderer/index.js`:

```javascript
// New state
let sidebarProjectsEl;
const projects = []; // { path, name }

// In init():
sidebarProjectsEl = document.querySelector('[data-testid="project-list"]');

document.querySelector('[data-testid="add-project-btn"]')
  .addEventListener('click', addProject);

// Load persisted projects on startup
const savedProjects = await api.projects.list();
for (const p of savedProjects) {
  projects.push(p);
}
renderSidebar();
```

Sidebar rendering function:

```javascript
function renderSidebar() {
  sidebarProjectsEl.innerHTML = '';
  for (const project of projects) {
    const el = document.createElement('div');
    el.className = 'sidebar-project';
    el.dataset.testid = 'project-item';
    el.dataset.projectPath = project.path;

    const sessionCount = countSessionsForProject(project.path);

    el.innerHTML = `
      <span class="sidebar-project-name">${project.name}</span>
      <span class="sidebar-project-count" data-testid="session-count">${sessionCount}</span>
      <button class="sidebar-project-remove" data-testid="remove-project-btn">&times;</button>
    `;

    el.addEventListener('click', (e) => {
      if (!e.target.closest('.sidebar-project-remove')) {
        createSession({ cwd: project.path, projectPath: project.path, label: project.name });
      }
    });

    el.querySelector('.sidebar-project-remove').addEventListener('click', () => {
      removeProject(project.path);
    });

    sidebarProjectsEl.appendChild(el);
  }
}

function countSessionsForProject(projectPath) {
  let count = 0;
  for (const s of sessions.values()) {
    if (s.projectPath === projectPath) count++;
  }
  return count;
}

async function addProject() {
  const project = await api.projects.add();
  if (!project) return; // dialog canceled
  if (!projects.some(p => p.path === project.path)) {
    projects.push(project);
  }
  renderSidebar();
}

async function removeProject(projectPath) {
  await api.projects.remove(projectPath);

  // Close all sessions for this project
  const toClose = [];
  for (const [id, s] of sessions.entries()) {
    if (s.projectPath === projectPath) toClose.push(id);
  }
  for (const id of toClose) closeTab(id);

  // Remove from local list
  const idx = projects.findIndex(p => p.path === projectPath);
  if (idx !== -1) projects.splice(idx, 1);

  renderSidebar();
}
```

**Step 2: Extend createSession to accept cwd and project info**

Modify the `createSession` function signature and body:

```javascript
async function createSession({ cwd, projectPath, label } = {}) {
  sessionCounter++;
  const displayLabel = label ? `${label} ${countSessionsForProject(projectPath) + 1}` : `Session ${sessionCounter}`;

  // ... existing panelEl, terminal, fitAddon setup ...

  const { id } = await api.terminal.create({
    command: api.config?.spawnCommand,
    cols: terminal.cols,
    rows: terminal.rows,
    cwd  // pass cwd to TerminalService
  });

  // ... existing tabEl setup, using displayLabel instead of label ...

  // Store projectPath in session data
  sessions.set(id, { terminal, fitAddon, panelEl, tabEl, cleanup, projectPath });

  // Re-render sidebar to update session counts
  renderSidebar();
}
```

**Step 3: Update closeTab to re-render sidebar**

At the end of `closeTab()`, after the existing logic, add:

```javascript
renderSidebar();
```

**Step 4: Build and manually verify**

Run: `npm run build && npx electron .`
Expected: Sidebar shows, "+" button would open folder dialog, existing tab creation still works.

**Step 5: Commit**

```bash
git add src/renderer/index.js
git commit -m "feat(step-006): add sidebar rendering and project management in renderer"
```

---

### Task 6: Write Playwright e2e tests

**Files:**
- Create: `tests/step-006-sidebar-projects.spec.js`

**Step 1: Write the test file**

```javascript
/**
 * Step 006 — Sidebar with Projects & Sessions
 * Validates sidebar UI, project CRUD, session scoping, and persistence.
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const appPath = path.resolve(__dirname, '..');

let electronApp;
let window;

test.beforeAll(async () => {
  electronApp = await electron.launch({ args: [appPath] });
  window = await electronApp.firstWindow();
  await window.waitForSelector('.xterm', { timeout: 10000 });
});

test.afterAll(async () => {
  if (electronApp) await electronApp.close();
});

test('1 - sidebar is visible', async () => {
  const sidebar = window.locator('[data-testid="sidebar"]');
  await expect(sidebar).toBeVisible({ timeout: 5000 });
});

test('2 - sidebar initially shows empty project list', async () => {
  const items = window.locator('[data-testid="project-item"]');
  await expect(items).toHaveCount(0);
});

test('3 - add a project via IPC and it appears in sidebar', async () => {
  // Use addPath IPC to avoid native dialog in tests
  const tmpDir = await electronApp.evaluate(async ({ app }) => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const dir = path.join(os.tmpdir(), `cct-test-project-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  });

  await window.evaluate(async (dir) => {
    await window.electron_api.projects.addPath(dir);
  }, tmpDir);

  // Re-render sidebar (trigger reload)
  await window.evaluate(async () => {
    // projects list was updated server-side, trigger re-render
    const saved = await window.electron_api.projects.list();
    window._cctReloadProjects && window._cctReloadProjects(saved);
  });

  const items = window.locator('[data-testid="project-item"]');
  await expect(items).toHaveCount(1, { timeout: 5000 });
});

test('4 - click project creates a new session tab in that folder', async () => {
  const projectItem = window.locator('[data-testid="project-item"]').first();
  const projectPath = await projectItem.getAttribute('data-project-path');

  await projectItem.click();
  await window.waitForTimeout(1000);

  // A new tab should exist
  const tabs = window.locator('[data-testid="tab"]');
  const tabCount = await tabs.count();
  expect(tabCount).toBeGreaterThanOrEqual(2); // initial + new

  // Type pwd to verify working directory
  const textarea = window.locator('.terminal-panel.active .xterm-helper-textarea');
  await textarea.pressSequentially('pwd', { delay: 30 });
  await window.keyboard.press('Enter');
  await window.waitForTimeout(1000);

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
  const tmpDir2 = await electronApp.evaluate(async ({ app }) => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const dir = path.join(os.tmpdir(), `cct-test-project2-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  });

  await window.evaluate(async (dir) => {
    await window.electron_api.projects.addPath(dir);
  }, tmpDir2);

  await window.evaluate(async () => {
    const saved = await window.electron_api.projects.list();
    window._cctReloadProjects && window._cctReloadProjects(saved);
  });

  const items = window.locator('[data-testid="project-item"]');
  await expect(items).toHaveCount(2, { timeout: 5000 });
});

test('7 - second project shows 0 sessions', async () => {
  const count = window.locator('[data-testid="project-item"]').nth(1)
    .locator('[data-testid="session-count"]');
  await expect(count).toHaveText('0', { timeout: 5000 });
});

test('8 - create second session under first project updates count to 2', async () => {
  const projectItem = window.locator('[data-testid="project-item"]').first();
  await projectItem.click();
  await window.waitForTimeout(1000);

  const count = projectItem.locator('[data-testid="session-count"]');
  await expect(count).toHaveText('2', { timeout: 5000 });
});

test('9 - remove project closes its sessions and removes from sidebar', async () => {
  const tabsBefore = await window.locator('[data-testid="tab"]').count();

  // Remove the first project (which has 2 sessions)
  const removeBtn = window.locator('[data-testid="project-item"]').first()
    .locator('[data-testid="remove-project-btn"]');
  await removeBtn.click();
  await window.waitForTimeout(500);

  // Project removed from sidebar
  const items = window.locator('[data-testid="project-item"]');
  await expect(items).toHaveCount(1, { timeout: 5000 });

  // Tabs decreased (2 project sessions closed)
  await expect(async () => {
    const tabsAfter = await window.locator('[data-testid="tab"]').count();
    expect(tabsAfter).toBe(tabsBefore - 2);
  }).toPass({ timeout: 5000 });
});

test('10 - projects persist across app restart', async () => {
  // Remember what we have before restart
  const projectsBefore = await window.evaluate(async () => {
    return await window.electron_api.projects.list();
  });
  expect(projectsBefore.length).toBe(1);

  // Restart the app
  await electronApp.close();
  electronApp = await electron.launch({ args: [appPath] });
  window = await electronApp.firstWindow();
  await window.waitForSelector('.xterm', { timeout: 10000 });

  // Projects should still be there
  const items = window.locator('[data-testid="project-item"]');
  await expect(items).toHaveCount(1, { timeout: 5000 });
});

test('11 - config file contains expected JSON entries', async () => {
  const configContent = await electronApp.evaluate(async ({ app }) => {
    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(app.getPath('userData'), 'projects.json');
    return fs.readFileSync(configPath, 'utf8');
  });

  const config = JSON.parse(configContent);
  expect(config).toHaveProperty('projects');
  expect(Array.isArray(config.projects)).toBe(true);
  expect(config.projects.length).toBe(1);
  expect(config.projects[0]).toHaveProperty('path');
  expect(config.projects[0]).toHaveProperty('name');
});

test('12 - all step 005 tab behaviors still work', async () => {
  // New tab via button
  await window.click('[data-testid="new-tab-btn"]');
  await window.waitForTimeout(500);
  const tabs = window.locator('[data-testid="tab"]');
  const count = await tabs.count();
  expect(count).toBeGreaterThanOrEqual(2);

  // Close via close button
  const closeBtn = tabs.last().locator('[data-testid="tab-close"]');
  await closeBtn.click();
  await window.waitForTimeout(500);
  const countAfter = await tabs.count();
  expect(countAfter).toBe(count - 1);
});
```

Note: Tests 3, 6 use `addPath` IPC (bypasses native dialog) + a `_cctReloadProjects` helper exposed from the renderer. This helper must be added to `src/renderer/index.js`:

```javascript
// Test helper: reload projects from store and re-render sidebar
window._cctReloadProjects = (projectList) => {
  projects.length = 0;
  projects.push(...projectList);
  renderSidebar();
};
```

**Step 2: Run tests**

Run: `npx playwright test tests/step-006-sidebar-projects.spec.js`
Expected: All 12 tests pass.

**Step 3: Run step 005 regression**

Run: `npx playwright test tests/step-005-tabbed-terminals.spec.js`
Expected: All 10 tests still pass.

**Step 4: Commit**

```bash
git add tests/step-006-sidebar-projects.spec.js
git commit -m "test(step-006): add Playwright e2e tests for sidebar projects"
```

---

### Task 7: Cleanup test temp dirs + final verification

**Step 1: Add test cleanup**

In the test `afterAll`, clean up temp directories:

```javascript
test.afterAll(async () => {
  // Clean up config to not pollute future runs
  await electronApp.evaluate(async ({ app }) => {
    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(app.getPath('userData'), 'projects.json');
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
  });
  if (electronApp) await electronApp.close();
});
```

**Step 2: Run full test suite**

Run: `npx playwright test`
Expected: All tests pass (steps 001–006).

**Step 3: Commit**

```bash
git add -A
git commit -m "chore(step-006): test cleanup"
```

---

### Task 8: Write step journal

**Files:**
- Create: `notes/STEP_NOTES_006.md`

Write journal entry covering: what was done, choices made, architecture decisions, testing, lessons.

**Step 1: Write and commit**

```bash
git add notes/STEP_NOTES_006.md
git commit -m "docs(step-006): add step journal"
```

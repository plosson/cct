# Step 005 — Tabbed Terminal Area Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a tab bar supporting multiple concurrent Claude Code sessions with tab switching, closing, and state preservation.

**Architecture:** Show/hide approach — each tab owns an xterm.js Terminal instance in its own `<div>`. Switching tabs toggles `display: none/flex`. No main process changes needed; the existing TerminalService + IPC API already supports multi-terminal. All changes are in HTML, CSS, and the renderer.

**Tech Stack:** Electron (unchanged), xterm.js 6, node-pty (unchanged), vanilla JS, Playwright e2e tests

---

### Task 1: Create branch and update HTML structure

**Files:**
- Modify: `index.html`

**Step 1: Create feature branch**

```bash
git checkout -b step-005-tabbed-terminal-area
```

**Step 2: Update `index.html` — add tab bar container**

Replace the current body content:

```html
<body>
  <div class="app">
    <div class="titlebar-drag-region"></div>
    <div class="tab-bar" data-testid="tab-bar">
      <div class="tab-bar-tabs"></div>
      <button class="tab-new-btn" data-testid="new-tab-btn">+</button>
    </div>
    <div id="terminals" class="terminals-container"></div>
  </div>
  <script src="dist/renderer.bundle.js"></script>
</body>
```

Key changes vs current:
- Removed `<div id="terminal-container" class="terminal-container">` — terminals are now created dynamically
- Added `.tab-bar` with a `.tab-bar-tabs` container and a `+` button
- Added `#terminals.terminals-container` — terminal panels go here

**Step 3: Commit**

```bash
git add index.html
git commit -m "step 005: add tab bar and terminals container to HTML"
```

---

### Task 2: Add tab bar and terminal panel CSS

**Files:**
- Modify: `styles/base.css`

**Step 1: Add CSS for tab bar and terminal panels**

Remove the `.terminal-container` rule. Add these rules to `styles/base.css`:

```css
/* Tab bar */
.tab-bar {
  display: flex;
  align-items: center;
  height: 36px;
  background: #16162a;
  border-bottom: 1px solid #2a2a4a;
  flex-shrink: 0;
  padding: 0 8px;
  -webkit-app-region: drag;
}

.tab-bar-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  flex: 1;
  -webkit-app-region: no-drag;
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  color: #888;
  white-space: nowrap;
  user-select: none;
  -webkit-app-region: no-drag;
}

.tab-item:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #bbb;
}

.tab-item.active {
  background: rgba(255, 255, 255, 0.1);
  color: #e0e0e0;
}

.tab-close {
  background: none;
  border: none;
  color: inherit;
  font-size: 14px;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
  opacity: 0.5;
  -webkit-app-region: no-drag;
}

.tab-close:hover {
  opacity: 1;
  color: #ff6b6b;
}

.tab-new-btn {
  background: none;
  border: none;
  color: #888;
  font-size: 18px;
  cursor: pointer;
  padding: 2px 8px;
  line-height: 1;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}

.tab-new-btn:hover {
  color: #e0e0e0;
}

/* Terminal panels */
.terminals-container {
  position: relative;
  flex: 1;
  overflow: hidden;
}

.terminal-panel {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: none;
}

.terminal-panel.active {
  display: flex;
}
```

**Step 2: Commit**

```bash
git add styles/base.css
git commit -m "step 005: add tab bar and terminal panel CSS"
```

---

### Task 3: Rewrite renderer as tab manager

**Files:**
- Modify: `src/renderer/index.js`

**Step 1: Rewrite `src/renderer/index.js`**

Complete replacement of the file. The new renderer manages a `sessions` Map and provides `createSession()`, `activateTab()`, and `closeTab()` functions.

```javascript
/**
 * Renderer — tabbed terminal manager
 * Creates and manages multiple xterm.js sessions connected to PTYs via IPC
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

const api = window.electron_api;

// State
const sessions = new Map(); // id → { terminal, fitAddon, panelEl, tabEl, cleanup }
let activeId = null;
let sessionCounter = 0;

/**
 * Create a new terminal session: PTY + xterm + tab + panel
 */
async function createSession() {
  const terminalsContainer = document.getElementById('terminals');
  const tabBarTabs = document.querySelector('.tab-bar-tabs');

  sessionCounter++;
  const label = `Session ${sessionCounter}`;

  // Create terminal panel
  const panelEl = document.createElement('div');
  panelEl.className = 'terminal-panel';
  terminalsContainer.appendChild(panelEl);

  // Create xterm instance
  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
    theme: {
      background: '#1a1a2e',
      foreground: '#e0e0e0',
      cursor: '#e0e0e0',
      selectionBackground: 'rgba(255, 255, 255, 0.2)'
    }
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(panelEl);

  // Create PTY
  const { id } = await api.terminal.create({
    command: api.config?.spawnCommand,
    cols: terminal.cols,
    rows: terminal.rows
  });

  // Create tab element
  const tabEl = document.createElement('div');
  tabEl.className = 'tab-item';
  tabEl.dataset.testid = 'tab';
  tabEl.dataset.tabId = String(id);
  tabEl.innerHTML = `<span class="tab-label">${label}</span><button class="tab-close" data-testid="tab-close">&times;</button>`;
  tabBarTabs.appendChild(tabEl);

  // Tab click → activate
  tabEl.addEventListener('click', (e) => {
    if (e.target.closest('.tab-close')) return;
    activateTab(id);
  });

  // Close button
  tabEl.querySelector('.tab-close').addEventListener('click', () => {
    closeTab(id);
  });

  // Wire terminal input → PTY
  const onDataDisposable = terminal.onData((data) => {
    api.terminal.input({ id, data });
  });

  // Wire PTY output → terminal
  const unsubData = api.terminal.onData(({ id: termId, data }) => {
    if (termId === id) terminal.write(data);
  });

  // Handle PTY exit
  const unsubExit = api.terminal.onExit(({ id: termId }) => {
    if (termId === id) {
      panelEl.setAttribute('data-terminal-exited', 'true');
    }
  });

  // Resize handling
  const resizeObserver = new ResizeObserver(() => {
    if (activeId === id) {
      fitAddon.fit();
      api.terminal.resize({ id, cols: terminal.cols, rows: terminal.rows });
    }
  });
  resizeObserver.observe(panelEl);

  // Cleanup function
  const cleanup = () => {
    onDataDisposable.dispose();
    unsubData();
    unsubExit();
    resizeObserver.disconnect();
    terminal.dispose();
  };

  sessions.set(id, { terminal, fitAddon, panelEl, tabEl, cleanup });
  activateTab(id);
}

/**
 * Switch visible tab
 */
function activateTab(id) {
  const session = sessions.get(id);
  if (!session) return;

  // Deactivate all
  for (const s of sessions.values()) {
    s.panelEl.classList.remove('active');
    s.tabEl.classList.remove('active');
  }

  // Activate target
  session.panelEl.classList.add('active');
  session.tabEl.classList.add('active');
  activeId = id;

  // Re-fit after becoming visible
  session.fitAddon.fit();
  api.terminal.resize({ id, cols: session.terminal.cols, rows: session.terminal.rows });
  session.terminal.focus();
}

/**
 * Close a tab: kill PTY, dispose xterm, remove DOM, handle last-tab
 */
function closeTab(id) {
  const session = sessions.get(id);
  if (!session) return;

  // Kill PTY
  api.terminal.kill({ id });

  // Cleanup resources
  session.cleanup();

  // Remove DOM
  session.panelEl.remove();
  session.tabEl.remove();

  // Remove from state
  sessions.delete(id);

  // If this was the active tab, activate a neighbor
  if (activeId === id) {
    activeId = null;
    const remaining = [...sessions.keys()];
    if (remaining.length > 0) {
      activateTab(remaining[remaining.length - 1]);
    }
  }

  // Always keep at least one tab
  if (sessions.size === 0) {
    createSession();
  }
}

// Expose buffer text for test assertions
window._cctGetBufferText = (targetId) => {
  const id = targetId || activeId;
  const session = sessions.get(id);
  if (!session) return '';
  const buf = session.terminal.buffer.active;
  let text = '';
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (line) text += line.translateToString(true) + '\n';
  }
  return text;
};

// Expose active tab ID for tests
window._cctActiveTabId = () => activeId;

/**
 * Init: create first session + wire keyboard shortcuts
 */
async function init() {
  // Keyboard shortcut: Cmd+T → new tab
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 't') {
      e.preventDefault();
      createSession();
    }
  });

  // + button
  document.querySelector('[data-testid="new-tab-btn"]').addEventListener('click', () => {
    createSession();
  });

  // Create first session
  await createSession();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
```

**Step 2: Build renderer bundle to verify no syntax errors**

```bash
npm run build:renderer
```

**Step 3: Commit**

```bash
git add src/renderer/index.js
git commit -m "step 005: rewrite renderer as tabbed session manager"
```

---

### Task 4: Write step 005 Playwright tests

**Files:**
- Create: `tests/step-005-tabbed-terminals.spec.js`

**Step 1: Write the test file**

```javascript
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
  await window.waitForSelector('.xterm', { timeout: 10000 });
  const tabs = window.locator('[data-testid="tab"]');
  await expect(tabs).toHaveCount(2);
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
  // Click first tab
  const tabs = window.locator('[data-testid="tab"]');
  await tabs.first().click();

  // First tab's panel should be active (visible)
  const firstTabId = await tabs.first().getAttribute('data-tab-id');
  const panels = window.locator('.terminal-panel');
  const firstPanel = panels.first();
  await expect(firstPanel).toHaveClass(/active/);

  // Second panel should NOT be active
  const secondPanel = panels.nth(1);
  await expect(secondPanel).not.toHaveClass(/active/);
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

  // Type a unique marker
  const textarea = window.locator('.xterm-helper-textarea');
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
  // Make sure we have 2 tabs
  const tabsBefore = window.locator('[data-testid="tab"]');
  await expect(tabsBefore).toHaveCount(2);

  // Close tab 2 (the second tab's close button)
  const closeBtn = tabsBefore.nth(1).locator('[data-testid="tab-close"]');
  await closeBtn.click();

  // Should be back to 1 tab
  await expect(window.locator('[data-testid="tab"]')).toHaveCount(1);
});

test('8. closed tab PTY is cleaned up', async () => {
  // After closing tab 2, only 1 PTY should remain
  await expect(async () => {
    const count = await window.evaluate(() => window.electron_api.terminal.count());
    expect(count).toBe(1);
  }).toPass({ timeout: 5000 });
});

test('9. close last tab — app handles gracefully (auto-creates new tab)', async () => {
  // Close the only remaining tab
  const closeBtn = window.locator('[data-testid="tab"]').first().locator('[data-testid="tab-close"]');
  await closeBtn.click();

  // Should auto-create a new tab — still 1 tab, no crash
  await expect(async () => {
    const count = await window.locator('[data-testid="tab"]').count();
    expect(count).toBe(1);
  }).toPass({ timeout: 5000 });

  // New tab should have a working terminal
  await window.waitForSelector('.xterm', { timeout: 10000 });
  const xterm = window.locator('.xterm');
  await expect(xterm).toBeVisible();
});

test('10. step 004 regression — terminal-create IPC still works', async () => {
  const result = await window.evaluate(async () => {
    return await window.electron_api.terminal.create({ cols: 80, rows: 24 });
  });
  expect(result.success).toBe(true);
  expect(result.id).toBeGreaterThan(0);

  // Clean up
  await window.evaluate(async (id) => {
    window.electron_api.terminal.kill({ id });
  }, result.id);
  await window.waitForTimeout(500);
});
```

**Step 2: Commit**

```bash
git add tests/step-005-tabbed-terminals.spec.js
git commit -m "step 005: add Playwright tests for tabbed terminals"
```

---

### Task 5: Run tests, fix failures, verify all pass

**Step 1: Build the renderer**

```bash
npm run build:renderer
```

**Step 2: Run step 005 tests**

```bash
npx playwright test tests/step-005-tabbed-terminals.spec.js
```

Expected: All 10 tests pass. If any fail, debug and fix.

**Step 3: Run step 003 regression tests**

```bash
npx playwright test tests/step-003-xterm-shell.spec.js
```

Note: Step 003 tests reference `#terminal-container` which no longer exists. These tests will need adjustment — the `.xterm` selector still works, but the exit test checks `#terminal-container[data-terminal-exited]` which needs to be updated to check the panel element instead. Fix any failures.

**Step 4: Run full test suite**

```bash
npm test
```

Expected: All 30+ tests pass (steps 001-005).

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "step 005: fix test failures and regressions"
```

---

### Task 6: Update step 003 tests for new DOM structure

**Files:**
- Modify: `tests/step-003-xterm-shell.spec.js`

The step 003 `exit` test checks `#terminal-container[data-terminal-exited="true"]` which no longer exists. The terminal panel now uses `.terminal-panel` and the `data-terminal-exited` attribute is set on it.

**Step 1: Update the exit test selector**

In `tests/step-003-xterm-shell.spec.js`, change:
```javascript
await window.waitForSelector('#terminal-container[data-terminal-exited="true"]', {
```
to:
```javascript
await window.waitForSelector('.terminal-panel[data-terminal-exited="true"]', {
```

**Step 2: Run step 003 tests**

```bash
npx playwright test tests/step-003-xterm-shell.spec.js
```

Expected: All 8 tests pass.

**Step 3: Commit**

```bash
git add tests/step-003-xterm-shell.spec.js
git commit -m "step 005: update step-003 test selector for new DOM structure"
```

---

### Task 7: Run full test suite and verify green

**Step 1: Full test run**

```bash
npm test
```

Expected: All tests across all step files pass.

**Step 2: If all green, commit any remaining changes and finalize**

```bash
git add -A
git commit -m "step 005: tabbed terminal area complete"
```

---

### Task 8: Write step journal

**Files:**
- Create: `notes/STEP_NOTES_005.md`

**Step 1: Write the journal entry**

Cover: what was done, choices made, architecture decisions, how it was tested, lessons/gotchas. Per project CLAUDE.md requirements.

**Step 2: Commit**

```bash
git add notes/STEP_NOTES_005.md
git commit -m "step 005: add step journal"
```

---

### Task 9: Merge to main

**Step 1: Merge branch**

```bash
git checkout main
git merge step-005-tabbed-terminal-area
```

**Step 2: Verify tests still pass on main**

```bash
npm test
```

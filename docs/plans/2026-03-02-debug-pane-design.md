# Step 35 — Debug Pane Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a collapsible bottom panel inside `.main-area` that displays structured log entries so users can diagnose issues without opening DevTools.

**Architecture:** LogService singleton in main process with ring buffer → IPC bridge → renderer pane inside `.main-area` below `.terminals-container`. Toggle with Cmd+J, resizable via drag handle, persisted state via WindowStateService.

**Tech Stack:** Electron IPC (handle/on/send), vanilla JS DOM, plain CSS flex layout.

---

### Task 1: Create the branch

**Step 1: Create and checkout the feature branch**

```bash
git checkout -b step-035-debug-pane
```

**Step 2: Commit (empty)**

No commit needed yet.

---

### Task 2: LogService (main process)

**Files:**
- Create: `src/main/services/LogService.js`
- Test: `tests/step-035-debug-pane.spec.js`

**Step 1: Write the test file skeleton**

Create `tests/step-035-debug-pane.spec.js`:

```javascript
/**
 * Step 035 — Debug Pane
 * Tests LogService ring buffer, IPC streaming, renderer pane toggle/resize/clear.
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { appPath, launchEnv } = require('./helpers');

let electronApp;
let window;
let env;

test.beforeAll(async () => {
  env = launchEnv();
  electronApp = await electron.launch({
    args: [appPath],
    env,
    timeout: 90000,
  });
  window = await electronApp.firstWindow({ timeout: 90000 });
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 15000 });
});

test.afterAll(async () => {
  if (electronApp) await electronApp.close();
});

test('1 - log history IPC returns array', async () => {
  const history = await window.evaluate(() => window.electron_api.log.getHistory());
  expect(Array.isArray(history)).toBe(true);
});
```

**Step 2: Run test to verify it fails**

```bash
npx playwright test tests/step-035-debug-pane.spec.js --headed
```

Expected: FAIL — `window.electron_api.log` is undefined.

**Step 3: Create LogService**

Create `src/main/services/LogService.js`:

```javascript
/**
 * LogService — structured logging with ring buffer and IPC forwarding
 * Singleton instantiated in main.js. Forwards entries to all BrowserWindows.
 */

const { BrowserWindow } = require('electron');

const MAX_ENTRIES = 500;

class LogService {
  constructor() {
    this._entries = [];
  }

  info(source, message) {
    this._add('info', source, message);
  }

  warn(source, message) {
    this._add('warn', source, message);
  }

  error(source, message) {
    this._add('error', source, message);
  }

  getHistory() {
    return [...this._entries];
  }

  clear() {
    this._entries = [];
  }

  _add(level, source, message) {
    const entry = { timestamp: Date.now(), level, source, message };
    this._entries.push(entry);
    if (this._entries.length > MAX_ENTRIES) {
      this._entries.shift();
    }
    this._broadcast(entry);
  }

  _broadcast(entry) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('log-entry', entry);
      }
    }
  }
}

module.exports = { LogService };
```

**Step 4: Create log IPC handler**

Create `src/main/ipc/log.ipc.js`:

```javascript
/**
 * Log IPC handlers
 * Bridges renderer ↔ LogService via Electron IPC
 */

const { ipcMain } = require('electron');

/**
 * Register log-related IPC handlers
 * @param {import('../services/LogService').LogService} logService
 */
function registerLogIPC(logService) {
  ipcMain.handle('log-get-history', () => {
    return logService.getHistory();
  });

  ipcMain.on('log-clear', () => {
    logService.clear();
  });
}

module.exports = { registerLogIPC };
```

**Step 5: Add preload bridge for log**

Modify `src/main/preload.js` — add inside the `contextBridge.exposeInMainWorld('electron_api', {` block, after the `appConfig` section:

```javascript
  log: {
    getHistory: () => ipcRenderer.invoke('log-get-history'),
    clear: () => ipcRenderer.send('log-clear'),
    onEntry: createListener('log-entry'),
  },
```

**Step 6: Wire up in main.js**

Modify `main.js`:

1. Add require after the ConfigService require (line ~64):
```javascript
  const { LogService } = require('./src/main/services/LogService');
  const { registerLogIPC } = require('./src/main/ipc/log.ipc');
```

2. Inside `app.whenReady().then(...)`, after `registerConfigIPC(configService);` (line ~104):
```javascript
    const logService = new LogService();
    registerLogIPC(logService);
```

**Step 7: Run test to verify it passes**

```bash
npx playwright test tests/step-035-debug-pane.spec.js --headed
```

Expected: PASS — `log.getHistory()` returns `[]`.

**Step 8: Commit**

```bash
git add src/main/services/LogService.js src/main/ipc/log.ipc.js src/main/preload.js main.js tests/step-035-debug-pane.spec.js
git commit -m "feat: add LogService with ring buffer and IPC bridge"
```

---

### Task 3: WindowStateService additions for debug pane

**Files:**
- Modify: `src/main/services/WindowStateService.js`
- Modify: `main.js` (IPC handlers for debug pane state)
- Modify: `src/main/preload.js` (bridge for debug pane state)
- Test: `tests/step-035-debug-pane.spec.js`

**Step 1: Add test**

Append to `tests/step-035-debug-pane.spec.js`:

```javascript
test('2 - debug pane state defaults are persisted', async () => {
  const height = await window.evaluate(() => window.electron_api.windowState.getDebugPaneHeight());
  const open = await window.evaluate(() => window.electron_api.windowState.getDebugPaneOpen());
  expect(height).toBe(200);
  expect(open).toBe(false);
});
```

**Step 2: Run test — expect fail**

**Step 3: Add properties to WindowStateService**

Modify `src/main/services/WindowStateService.js`:

1. Add to DEFAULTS object:
```javascript
  debugPaneHeight: 200,
  debugPaneOpen: false,
```

2. Add getter/setter pairs after the `fontSize` getter/setter:
```javascript
  get debugPaneHeight() {
    return this._state.debugPaneHeight;
  }

  set debugPaneHeight(value) {
    this._state.debugPaneHeight = value;
    this._debouncedSave();
  }

  get debugPaneOpen() {
    return this._state.debugPaneOpen;
  }

  set debugPaneOpen(value) {
    this._state.debugPaneOpen = value;
    this._debouncedSave();
  }
```

**Step 4: Add IPC handlers in main.js**

After the existing `set-font-size` handler (line ~114), add:

```javascript
    ipcMain.handle('get-debug-pane-height', () => windowStateService.debugPaneHeight);
    ipcMain.on('set-debug-pane-height', (_event, h) => { windowStateService.debugPaneHeight = h; });
    ipcMain.handle('get-debug-pane-open', () => windowStateService.debugPaneOpen);
    ipcMain.on('set-debug-pane-open', (_event, open) => { windowStateService.debugPaneOpen = open; });
```

**Step 5: Add preload bridge**

Modify `src/main/preload.js` — add to the `windowState` section:

```javascript
    getDebugPaneHeight: () => ipcRenderer.invoke('get-debug-pane-height'),
    setDebugPaneHeight: (h) => ipcRenderer.send('set-debug-pane-height', h),
    getDebugPaneOpen: () => ipcRenderer.invoke('get-debug-pane-open'),
    setDebugPaneOpen: (open) => ipcRenderer.send('set-debug-pane-open', open),
```

**Step 6: Run test — expect pass**

**Step 7: Commit**

```bash
git add src/main/services/WindowStateService.js main.js src/main/preload.js tests/step-035-debug-pane.spec.js
git commit -m "feat: add debug pane height/open state to WindowStateService"
```

---

### Task 4: Renderer — debug pane DOM and CSS (collapsed by default)

**Files:**
- Modify: `index.html`
- Modify: `styles/base.css`
- Modify: `src/renderer/index.js`
- Test: `tests/step-035-debug-pane.spec.js`

**Step 1: Add test**

Append to test file:

```javascript
test('3 - debug pane exists in DOM and is collapsed by default', async () => {
  const pane = await window.evaluate(() => {
    const el = document.querySelector('[data-testid="debug-pane"]');
    if (!el) return null;
    return {
      exists: true,
      display: getComputedStyle(el).display,
      height: el.offsetHeight,
    };
  });
  expect(pane).not.toBeNull();
  expect(pane.height).toBe(0);
});
```

**Step 2: Run test — expect fail**

**Step 3: Add HTML elements**

Modify `index.html` — inside `.main-area`, after `<div id="terminals" class="terminals-container">...</div>`, add:

```html
        <div class="debug-pane-resize-handle" data-testid="debug-pane-resize-handle"></div>
        <div class="debug-pane" data-testid="debug-pane">
          <div class="debug-pane-header">
            <span class="debug-pane-title">Debug Log</span>
            <span class="debug-pane-count" data-testid="debug-pane-count"></span>
            <span class="debug-pane-spacer"></span>
            <button class="debug-pane-clear-btn" data-testid="debug-pane-clear-btn">Clear</button>
          </div>
          <div class="debug-pane-entries" data-testid="debug-pane-entries"></div>
        </div>
```

**Step 4: Add CSS**

Append to `styles/base.css`:

```css
/* Debug pane */
.debug-pane-resize-handle {
  height: 4px;
  cursor: row-resize;
  background: transparent;
  flex-shrink: 0;
  position: relative;
  z-index: 10;
  display: none;
}

.debug-pane-resize-handle.visible {
  display: block;
}

.debug-pane-resize-handle:hover,
.debug-pane-resize-handle.dragging {
  background: #3a3a5a;
}

.debug-pane {
  height: 0;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #12122a;
  border-top: 1px solid #2a2a4a;
}

.debug-pane.open {
  overflow: visible;
}

.debug-pane-header {
  display: flex;
  align-items: center;
  height: 28px;
  padding: 0 12px;
  background: #16162a;
  border-bottom: 1px solid #2a2a4a;
  flex-shrink: 0;
  gap: 8px;
  font-size: 11px;
  color: #888;
  user-select: none;
}

.debug-pane-title {
  font-weight: 600;
  color: #aaa;
}

.debug-pane-count {
  color: #666;
  font-size: 10px;
}

.debug-pane-spacer {
  flex: 1;
}

.debug-pane-clear-btn {
  background: none;
  border: 1px solid #3a3a5a;
  color: #888;
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 3px;
  cursor: pointer;
}

.debug-pane-clear-btn:hover {
  color: #ccc;
  border-color: #555;
}

.debug-pane-entries {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  font-size: 11px;
  line-height: 1.5;
}

.debug-entry {
  padding: 1px 12px;
  display: flex;
  gap: 8px;
  white-space: pre-wrap;
  word-break: break-all;
}

.debug-entry-time {
  color: #555;
  flex-shrink: 0;
}

.debug-entry-source {
  color: #6a6a9a;
  flex-shrink: 0;
  min-width: 60px;
}

.debug-entry-message {
  flex: 1;
}

.debug-entry.level-info .debug-entry-message {
  color: #888;
}

.debug-entry.level-warn .debug-entry-message {
  color: #e5c07b;
}

.debug-entry.level-error .debug-entry-message {
  color: #e06c75;
}
```

**Step 5: Initialize collapsed debug pane in renderer**

Modify `src/renderer/index.js`:

1. Add variables after the `emptyStateEl` declaration block (around line 77):
```javascript
let debugPaneEl;
let debugPaneEntriesEl;
let debugPaneCountEl;
let debugPaneResizeHandle;
let debugPaneOpen = false;
let debugPaneHeight = 200;
```

2. In `init()`, after the `emptyStateEl` line (around line 1599), add:
```javascript
  debugPaneEl = document.querySelector('[data-testid="debug-pane"]');
  debugPaneEntriesEl = document.querySelector('[data-testid="debug-pane-entries"]');
  debugPaneCountEl = document.querySelector('[data-testid="debug-pane-count"]');
  debugPaneResizeHandle = document.querySelector('[data-testid="debug-pane-resize-handle"]');
```

3. In `init()`, after restoring font size (around line 1653), add:
```javascript
  // Restore debug pane state
  if (api.windowState) {
    const savedDebugHeight = await api.windowState.getDebugPaneHeight();
    if (savedDebugHeight && savedDebugHeight > 0) debugPaneHeight = savedDebugHeight;
    const savedDebugOpen = await api.windowState.getDebugPaneOpen();
    if (savedDebugOpen) {
      debugPaneOpen = true;
      debugPaneEl.style.height = debugPaneHeight + 'px';
      debugPaneEl.classList.add('open');
      debugPaneResizeHandle.classList.add('visible');
    }
  }
```

**Step 6: Run test — expect pass**

**Step 7: Commit**

```bash
git add index.html styles/base.css src/renderer/index.js tests/step-035-debug-pane.spec.js
git commit -m "feat: add debug pane DOM structure and CSS (collapsed by default)"
```

---

### Task 5: Toggle with Cmd+J

**Files:**
- Modify: `src/renderer/index.js`
- Test: `tests/step-035-debug-pane.spec.js`

**Step 1: Add test**

```javascript
test('4 - Cmd+J toggles debug pane open and closed', async () => {
  // Initially collapsed
  let height = await window.evaluate(() => document.querySelector('[data-testid="debug-pane"]').offsetHeight);
  expect(height).toBe(0);

  // Toggle open
  await window.keyboard.press('Meta+j');
  await window.waitForTimeout(100);

  height = await window.evaluate(() => document.querySelector('[data-testid="debug-pane"]').offsetHeight);
  expect(height).toBeGreaterThan(0);

  const handleVisible = await window.evaluate(() =>
    document.querySelector('[data-testid="debug-pane-resize-handle"]').classList.contains('visible')
  );
  expect(handleVisible).toBe(true);

  // Toggle closed
  await window.keyboard.press('Meta+j');
  await window.waitForTimeout(100);

  height = await window.evaluate(() => document.querySelector('[data-testid="debug-pane"]').offsetHeight);
  expect(height).toBe(0);
});
```

**Step 2: Run test — expect fail**

**Step 3: Implement toggle**

Modify `src/renderer/index.js`:

1. Add `toggleDebugPane` function (near the sidebar resize section):

```javascript
// ── Debug pane toggle ────────────────────────────────────────

function toggleDebugPane() {
  debugPaneOpen = !debugPaneOpen;
  if (debugPaneOpen) {
    debugPaneEl.style.height = debugPaneHeight + 'px';
    debugPaneEl.classList.add('open');
    debugPaneResizeHandle.classList.add('visible');
  } else {
    debugPaneEl.style.height = '0';
    debugPaneEl.classList.remove('open');
    debugPaneResizeHandle.classList.remove('visible');
  }
  if (api.windowState) {
    api.windowState.setDebugPaneOpen(debugPaneOpen);
  }
  // Refit active terminal since available space changed
  if (activeId) {
    const session = sessions.get(activeId);
    if (session) session.fitAddon.fit();
  }
}
```

2. Add keybinding in `DEFAULT_KEYBINDINGS`:
```javascript
  'Meta+j': 'toggleDebugPane',
```

3. Register action in `init()` alongside other actions:
```javascript
  actions.set('toggleDebugPane', toggleDebugPane);
```

**Step 4: Run test — expect pass**

**Step 5: Commit**

```bash
git add src/renderer/index.js tests/step-035-debug-pane.spec.js
git commit -m "feat: toggle debug pane with Cmd+J"
```

---

### Task 6: Debug pane resize

**Files:**
- Modify: `src/renderer/index.js`
- Test: `tests/step-035-debug-pane.spec.js`

**Step 1: Add test**

```javascript
test('5 - debug pane is resizable via drag handle', async () => {
  // Open the pane first
  const isOpen = await window.evaluate(() => document.querySelector('[data-testid="debug-pane"]').classList.contains('open'));
  if (!isOpen) await window.keyboard.press('Meta+j');
  await window.waitForTimeout(100);

  const handle = await window.$('[data-testid="debug-pane-resize-handle"]');
  const box = await handle.boundingBox();

  // Drag upward (increases pane height)
  await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await window.mouse.down();
  await window.mouse.move(box.x + box.width / 2, box.y - 50);
  await window.mouse.up();

  const newHeight = await window.evaluate(() => document.querySelector('[data-testid="debug-pane"]').offsetHeight);
  expect(newHeight).toBeGreaterThan(200);
});
```

**Step 2: Run test — expect fail**

**Step 3: Implement resize**

Add `initDebugPaneResize` function in `src/renderer/index.js` (after `toggleDebugPane`):

```javascript
function initDebugPaneResize() {
  const MIN_HEIGHT = 80;

  let isDragging = false;
  let startY = 0;
  let startHeight = 0;

  debugPaneResizeHandle.addEventListener('mousedown', (e) => {
    if (!debugPaneOpen) return;
    isDragging = true;
    startY = e.clientY;
    startHeight = debugPaneEl.offsetHeight;
    debugPaneResizeHandle.classList.add('dragging');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const mainArea = document.querySelector('.main-area');
    const maxHeight = Math.floor(mainArea.offsetHeight * 0.5);
    const delta = startY - e.clientY; // dragging up increases height
    const newHeight = Math.max(MIN_HEIGHT, Math.min(maxHeight, startHeight + delta));
    debugPaneEl.style.height = newHeight + 'px';
    // Refit active terminal
    if (activeId) {
      const session = sessions.get(activeId);
      if (session) session.fitAddon.fit();
    }
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    debugPaneResizeHandle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    debugPaneHeight = debugPaneEl.offsetHeight;
    if (api.windowState) {
      api.windowState.setDebugPaneHeight(debugPaneHeight);
    }
  });
}
```

In `init()`, after `initSidebarResize();` add:

```javascript
  initDebugPaneResize();
```

**Step 4: Run test — expect pass**

**Step 5: Commit**

```bash
git add src/renderer/index.js tests/step-035-debug-pane.spec.js
git commit -m "feat: resizable debug pane via drag handle"
```

---

### Task 7: Log entries display and auto-scroll

**Files:**
- Modify: `src/renderer/index.js`
- Test: `tests/step-035-debug-pane.spec.js`

**Step 1: Add test**

```javascript
test('6 - log entries appear in the debug pane', async () => {
  // Open the pane
  const isOpen = await window.evaluate(() => document.querySelector('[data-testid="debug-pane"]').classList.contains('open'));
  if (!isOpen) await window.keyboard.press('Meta+j');
  await window.waitForTimeout(100);

  // Inject a test log entry via IPC (simulate main process sending log-entry)
  await window.evaluate(() => {
    // Use the onEntry listener — we'll trigger it by calling getHistory which we know works
    // Instead, let's directly test the rendering function
    window._claudiuAddDebugEntry({ timestamp: Date.now(), level: 'info', source: 'test', message: 'Hello from test' });
  });

  const entries = await window.evaluate(() =>
    document.querySelectorAll('[data-testid="debug-pane-entries"] .debug-entry').length
  );
  expect(entries).toBeGreaterThanOrEqual(1);

  const text = await window.evaluate(() =>
    document.querySelector('[data-testid="debug-pane-entries"]').textContent
  );
  expect(text).toContain('Hello from test');
});

test('7 - clear button removes all entries', async () => {
  // Add an entry first
  await window.evaluate(() => {
    window._claudiuAddDebugEntry({ timestamp: Date.now(), level: 'warn', source: 'test', message: 'Warning entry' });
  });

  // Click clear
  await window.click('[data-testid="debug-pane-clear-btn"]');
  await window.waitForTimeout(100);

  const entries = await window.evaluate(() =>
    document.querySelectorAll('[data-testid="debug-pane-entries"] .debug-entry').length
  );
  expect(entries).toBe(0);
});
```

**Step 2: Run test — expect fail**

**Step 3: Implement entry rendering**

Add to `src/renderer/index.js`:

```javascript
// ── Debug pane entries ───────────────────────────────────────

let debugAutoScroll = true;

function formatLogTime(timestamp) {
  const d = new Date(timestamp);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function addDebugEntry(entry) {
  if (!debugPaneEntriesEl) return;

  const row = document.createElement('div');
  row.className = `debug-entry level-${entry.level}`;

  const time = document.createElement('span');
  time.className = 'debug-entry-time';
  time.textContent = formatLogTime(entry.timestamp);

  const source = document.createElement('span');
  source.className = 'debug-entry-source';
  source.textContent = `[${entry.source}]`;

  const msg = document.createElement('span');
  msg.className = 'debug-entry-message';
  msg.textContent = entry.message;

  row.append(time, source, msg);
  debugPaneEntriesEl.appendChild(row);

  updateDebugPaneCount();

  // Auto-scroll if user hasn't scrolled up
  if (debugAutoScroll) {
    debugPaneEntriesEl.scrollTop = debugPaneEntriesEl.scrollHeight;
  }
}

function updateDebugPaneCount() {
  if (debugPaneCountEl) {
    const count = debugPaneEntriesEl.querySelectorAll('.debug-entry').length;
    debugPaneCountEl.textContent = count > 0 ? `(${count})` : '';
  }
}

function clearDebugPane() {
  if (debugPaneEntriesEl) {
    debugPaneEntriesEl.innerHTML = '';
    updateDebugPaneCount();
  }
  if (api.log) api.log.clear();
}

// Test helper
window._claudiuAddDebugEntry = addDebugEntry;
```

In `init()`, wire up:

1. After restoring debug pane state, subscribe to log entries:
```javascript
  // Wire up debug pane
  if (api.log) {
    // Load history
    const history = await api.log.getHistory();
    for (const entry of history) addDebugEntry(entry);

    // Stream new entries
    api.log.onEntry((entry) => addDebugEntry(entry));
  }

  // Clear button
  document.querySelector('[data-testid="debug-pane-clear-btn"]')
    .addEventListener('click', clearDebugPane);

  // Track scroll position for auto-scroll behavior
  debugPaneEntriesEl.addEventListener('scroll', () => {
    const { scrollTop, scrollHeight, clientHeight } = debugPaneEntriesEl;
    debugAutoScroll = scrollTop + clientHeight >= scrollHeight - 10;
  });
```

**Step 4: Run test — expect pass**

**Step 5: Commit**

```bash
git add src/renderer/index.js tests/step-035-debug-pane.spec.js
git commit -m "feat: render log entries in debug pane with auto-scroll and clear"
```

---

### Task 8: Instrument the codebase with LogService

**Files:**
- Modify: `main.js`
- Modify: `src/main/services/HooksService.js`
- Modify: `src/main/services/ConfigService.js`
- Modify: `src/main/services/TerminalService.js`
- Modify: `src/main/services/ProjectStore.js`
- Modify: `src/main/services/WindowStateService.js`
- Modify: `src/main/services/UpdaterService.js`
- Modify: `src/main/ipc/terminal.ipc.js`
- Test: `tests/step-035-debug-pane.spec.js`

**Step 1: Add test**

```javascript
test('8 - startup logs appear in history', async () => {
  // LogService should have captured at least one entry during startup
  // (e.g., hooks install, config load, etc.)
  const history = await window.evaluate(() => window.electron_api.log.getHistory());
  expect(history.length).toBeGreaterThan(0);
  // Check that entries have the expected shape
  const entry = history[0];
  expect(entry).toHaveProperty('timestamp');
  expect(entry).toHaveProperty('level');
  expect(entry).toHaveProperty('source');
  expect(entry).toHaveProperty('message');
});
```

**Step 2: Run test — expect fail** (no entries logged yet during startup)

**Step 3: Instrument HooksService**

Modify `src/main/services/HooksService.js`:

The module uses standalone functions, not a class. Add a module-level `_logService` variable and a setter:

1. Add at the top of the module (after the constants):
```javascript
let _logService = null;

function setLogService(logService) {
  _logService = logService;
}
```

2. Replace the 3 `console.error(...)` calls:
   - Line 38: `console.error('Failed to read Claude settings:', e);` → `if (_logService) _logService.warn('hooks', 'Failed to read Claude settings: ' + e.message);`
   - Line 115: `console.error('Failed to install hooks:', e);` → `if (_logService) _logService.error('hooks', 'Failed to install hooks: ' + e.message);`
   - Line 156: `console.error('Failed to remove hooks:', e);` → `if (_logService) _logService.error('hooks', 'Failed to remove hooks: ' + e.message);`

3. Export `setLogService`:
```javascript
module.exports = { installHooks, removeHooks, setLogService };
```

**Step 4: Instrument ConfigService**

Modify `src/main/services/ConfigService.js` — accept optional logService in constructor:

1. Change constructor:
```javascript
  constructor(logService) {
    this._logService = logService || null;
    this._globalPath = path.join(app.getPath('userData'), 'config.json');
    ...
  }
```

2. In `_loadGlobal()`, change `catch {}` to:
```javascript
    } catch (e) {
      this._global = {};
      if (this._logService) this._logService.warn('config', 'Failed to load global config: ' + (e.message || e));
    }
```

3. In `_loadProject()`, change `catch {}` to:
```javascript
    } catch (e) {
      config = {};
      // Only log if file exists but is corrupt (not for missing files)
      if (this._logService && e.code !== 'ENOENT') {
        this._logService.warn('config', 'Failed to load project config: ' + (e.message || e));
      }
    }
```

**Step 5: Instrument TerminalService**

Modify `src/main/services/TerminalService.js`:

1. Change constructor to accept logService:
```javascript
  constructor(mainWindow, logService) {
    this._window = mainWindow;
    this._logService = logService || null;
    ...
  }
```

2. In `resize()`, change `catch {}` to:
```javascript
    } catch (e) {
      if (this._logService) this._logService.warn('terminal', 'PTY resize failed (fd may be closed): ' + (e.message || e));
    }
```

**Step 6: Instrument ProjectStore**

Modify `src/main/services/ProjectStore.js`:

1. Change constructor:
```javascript
  constructor(logService) {
    this._logService = logService || null;
    ...
  }
```

2. In `_load()`, change `catch {}` to:
```javascript
    } catch (e) {
      this._projects = [];
      if (this._logService) this._logService.warn('projects', 'Failed to load projects: ' + (e.message || e));
    }
```

**Step 7: Instrument WindowStateService**

Modify `src/main/services/WindowStateService.js`:

1. Change constructor to accept logService:
```javascript
  constructor(logService) {
    this._logService = logService || null;
    ...
  }
```

2. In `_load()`, change `catch {}` to:
```javascript
    } catch (e) {
      this._state = { ...DEFAULTS };
      if (this._logService) this._logService.warn('window', 'Failed to load window state: ' + (e.message || e));
    }
```

3. In `_save()`, change `catch {}` to:
```javascript
    } catch (e) {
      if (this._logService) this._logService.warn('window', 'Failed to save window state: ' + (e.message || e));
    }
```

**Step 8: Instrument UpdaterService**

Modify `src/main/services/UpdaterService.js`:

1. Change constructor to accept logService:
```javascript
  constructor(mainWindow, logService) {
    this._window = mainWindow;
    this._logService = logService || null;
    ...
  }
```

2. Add log calls in the event handlers:
```javascript
    autoUpdater.on('update-available', (info) => {
      if (this._logService) this._logService.info('updater', 'Update available: v' + info.version);
      this._send('update-available', { version: info.version, releaseNotes: info.releaseNotes });
    });

    autoUpdater.on('update-downloaded', (info) => {
      if (this._logService) this._logService.info('updater', 'Update downloaded: v' + info.version);
      this._send('update-downloaded', { version: info.version });
    });

    autoUpdater.on('error', (err) => {
      if (this._logService) this._logService.error('updater', 'Update error: ' + (err?.message || String(err)));
      this._send('update-error', { message: err?.message || String(err) });
    });
```

**Step 9: Update main.js wiring**

In `main.js`, the logService must be created early (before services that need it). Reorder:

```javascript
    // Inside app.whenReady().then():
    const logService = new LogService();
    registerLogIPC(logService);

    windowStateService = new WindowStateService(logService);
    const win = createMainWindow(windowStateService);
    terminalService = new TerminalService(win, logService);
    setTerminalService(terminalService);
    const projectConfigService = new ProjectConfigService();
    const configService = new ConfigService(logService);
    registerTerminalIPC(terminalService, projectConfigService, configService);

    projectStore = new ProjectStore(logService);
    registerProjectIPC(projectStore, projectConfigService);
    registerConfigIPC(configService);

    // ... existing window state IPC ...

    new UpdaterService(win, logService);

    // Set logService on HooksService before installing
    const { setLogService } = require('./src/main/services/HooksService');
    setLogService(logService);
    installHooks();

    logService.info('app', 'Claudiu started — v' + app.getVersion());
```

**Step 10: Run test — expect pass**

**Step 11: Run ALL existing tests to verify no regressions**

```bash
npx playwright test --headed
```

Expected: All tests pass. The constructor changes are backward-compatible (logService is optional).

**Step 12: Commit**

```bash
git add main.js src/main/services/HooksService.js src/main/services/ConfigService.js src/main/services/TerminalService.js src/main/services/ProjectStore.js src/main/services/WindowStateService.js src/main/services/UpdaterService.js tests/step-035-debug-pane.spec.js
git commit -m "feat: instrument codebase with LogService for structured logging"
```

---

### Task 9: Add Cmd+J to shortcut help dialog

**Files:**
- Modify: `src/renderer/index.js`

**Step 1: Find the shortcut help data**

Search for the `showShortcutHelp` function in `src/renderer/index.js`. It builds a list of shortcut descriptions. Add the debug pane entry.

Add to the shortcuts list (in the appropriate section):
```javascript
  { key: '⌘J', label: 'Toggle Debug Log' },
```

**Step 2: Commit**

```bash
git add src/renderer/index.js
git commit -m "feat: add Cmd+J to shortcut help dialog"
```

---

### Task 10: Final test run and cleanup

**Step 1: Run all tests**

```bash
npx playwright test --headed
```

Expected: All tests pass (step-035 and all previous steps).

**Step 2: Manual verification**

```bash
npm run start
```

Verify:
- Cmd+J opens/closes the debug pane
- Log entries appear (at minimum, "Claudiu started" from startup)
- Resize handle works
- Clear button works
- Auto-scroll to bottom on new entries
- Pane state persists across app restart

**Step 3: Commit any final fixes if needed**

---

### Task 11: Merge to main and write step notes

**Step 1: Merge**

```bash
git checkout main
git merge step-035-debug-pane
```

**Step 2: Write step journal**

Create `notes/STEP_NOTES_035.md` with: what was done, choices made, architecture decisions, how it was tested, lessons/gotchas.

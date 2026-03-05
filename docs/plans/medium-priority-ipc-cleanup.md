# MEDIUM Priority: IPC Layer Cleanup Plan

## Overview

Clean up the IPC layer so handlers are thin wrappers that delegate to services, with no business logic. Addresses 5 issues: business logic in `terminal.ipc.js` and `sound-theme.ipc.js`, inline handlers in `main.js`, protocol handler security logic in wrong place, and MainWindow module-level globals.

---

## Step 1: Extract inline IPC handlers from main.js (`step-XXX-extract-inline-ipc`)

**Issue**: main.js lines 186-221 contain inline IPC handlers for window state, shell, and context menu.

### Changes

**1. Create `src/main/ipc/window-state.ipc.js`**

Extract lines 186-197 from main.js:

```js
const { ipcMain, app } = require('electron');

function registerWindowStateIPC(windowStateService) {
  ipcMain.handle('get-version', () => app.getVersion());
  ipcMain.handle('get-sidebar-width', () => windowStateService.sidebarWidth);
  ipcMain.on('set-sidebar-width', (_event, width) => { windowStateService.sidebarWidth = width; });
  ipcMain.handle('get-sidebar-mode', () => windowStateService.sidebarMode);
  ipcMain.on('set-sidebar-mode', (_event, mode) => { windowStateService.sidebarMode = mode; });
  ipcMain.handle('get-window-state-path', () => windowStateService.configPath);
  ipcMain.handle('get-font-size', () => windowStateService.fontSize);
  ipcMain.on('set-font-size', (_event, size) => { windowStateService.fontSize = size; });
  ipcMain.handle('get-debug-pane-height', () => windowStateService.debugPaneHeight);
  ipcMain.on('set-debug-pane-height', (_event, h) => { windowStateService.debugPaneHeight = h; });
  ipcMain.handle('get-debug-pane-open', () => windowStateService.debugPaneOpen);
  ipcMain.on('set-debug-pane-open', (_event, open) => { windowStateService.debugPaneOpen = open; });
}

module.exports = { registerWindowStateIPC };
```

**2. Create `src/main/ipc/shell.ipc.js`**

Extract lines 200-201:

```js
const { ipcMain, shell } = require('electron');

function registerShellIPC() {
  ipcMain.handle('shell-show-item-in-folder', (_event, fullPath) => shell.showItemInFolder(fullPath));
  ipcMain.handle('shell-open-external', (_event, url) => shell.openExternal(url));
}

module.exports = { registerShellIPC };
```

**3. Create `src/main/ipc/context-menu.ipc.js`**

Extract lines 204-221:

```js
const { ipcMain, Menu, BrowserWindow } = require('electron');

function registerContextMenuIPC() {
  ipcMain.handle('show-context-menu', (event, { items }) => {
    return new Promise((resolve) => {
      const contextMenu = Menu.buildFromTemplate(
        items.map(item => {
          if (item.type === 'separator') return { type: 'separator' };
          return {
            label: item.label,
            enabled: item.enabled !== false,
            click: () => resolve(item.action),
          };
        })
      );
      contextMenu.popup({
        window: BrowserWindow.fromWebContents(event.sender),
        callback: () => resolve(null),
      });
    });
  });
}

module.exports = { registerContextMenuIPC };
```

**4. Update `main.js`**

Replace lines 186-221 with:
```js
const { registerWindowStateIPC } = require('./src/main/ipc/window-state.ipc');
const { registerShellIPC } = require('./src/main/ipc/shell.ipc');
const { registerContextMenuIPC } = require('./src/main/ipc/context-menu.ipc');
// ...
registerWindowStateIPC(windowStateService);
registerShellIPC();
registerContextMenuIPC();
```

Remove `shell` from main.js's `require('electron')` if no longer used there.

### Test strategy

Pure structural move — all existing tests must pass. Key tests: `step-007-window-state.spec.js`, `step-014-font-zoom.spec.js`, `step-011-tab-context-menu.spec.js`, `step-035-debug-pane.spec.js`.

---

## Step 2: Move sound protocol handler into SoundThemeService (`step-XXX-sound-protocol`)

**Issue**: main.js lines 142-161 contain path traversal security logic that belongs in SoundThemeService.

### Changes

**1. Add `handleSoundProtocol(request)` to SoundThemeService**

```js
handleSoundProtocol(request) {
  const { net } = require('electron');
  const url = new URL(request.url);
  const themeDirName = url.hostname;
  const fileName = url.pathname.slice(1);
  const filePath = path.join(this._themesDir, themeDirName, fileName);

  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(this._themesDir) + path.sep)) {
    return new Response('Forbidden', { status: 403 });
  }
  if (!fs.existsSync(resolved)) {
    return new Response('Not found', { status: 404 });
  }
  return net.fetch('file://' + resolved);
}
```

**2. Update main.js**

Replace lines 143-161 with:
```js
protocol.handle('claudiu-sound', (request) => soundThemeService.handleSoundProtocol(request));
```

Remove `net` from main.js `require('electron')` if no longer used.

### Test strategy

No new tests needed. `step-045-cow-themes.spec.js` tests 2 and 9 verify `claudiu-sound://` URLs work.

---

## Step 3: Extract business logic from terminal.ipc.js into SessionService (`step-XXX-session-service`)

**Issue**: terminal.ipc.js lines 16-104 contain session tracking, config resolution, command parsing, env assembly, and duplicated cleanup logic across `onExit` and `terminal-kill`.

### Changes

**1. Create `src/main/services/SessionService.js`**

```js
const crypto = require('crypto');
const { app } = require('electron');

class SessionService {
  constructor(terminalService, projectConfigService, configService) {
    this._terminalService = terminalService;
    this._projectConfigService = projectConfigService;
    this._configService = configService || null;
    this._sessionMap = new Map();
    this._shuttingDown = false;
    app.on('before-quit', () => { this._shuttingDown = true; });
  }

  create(params = {}) {
    const { cwd, type, claudeSessionId: resumeId } = params;
    const sessionId = crypto.randomUUID();
    const isClaude = type === 'claude';

    // Resolve command
    let command = params.command || (process.env.CLAUDIU_USER_DATA && process.env.CLAUDIU_COMMAND);
    if (!command && this._configService) {
      const key = isClaude ? 'claudeCommand' : 'terminalCommand';
      command = this._configService.resolve(key, cwd) || undefined;
    }

    // Parse command string
    let commandArgs = [];
    if (command) {
      const parts = command.split(/\s+/).filter(Boolean);
      command = parts[0];
      commandArgs = parts.slice(1);
    }

    // Build env
    const env = {};
    let projectId;
    if (cwd && this._projectConfigService) {
      projectId = this._projectConfigService.getProjectId(cwd);
      env.CLAUDIU_PROJECT_ID = projectId;
    }
    env.CLAUDIU_SESSION_ID = sessionId;

    let args = params.args || [];
    if (isClaude && resumeId) {
      args = ['--resume', resumeId, ...args];
    }

    // Cleanup callback (shared between onExit and kill)
    const onExit = ({ id }) => {
      const entry = this._sessionMap.get(id);
      if (!this._shuttingDown && entry && this._projectConfigService) {
        this._projectConfigService.removeSession(entry.projectPath, id);
      }
      this._sessionMap.delete(id);
    };

    const result = this._terminalService.create({
      ...params, command, args: [...commandArgs, ...args], env, onExit,
    });

    // Record session
    if (cwd && this._projectConfigService) {
      this._projectConfigService.recordSession(cwd, sessionId, result.id, type, resumeId);
      this._sessionMap.set(result.id, { projectPath: cwd, sessionId });
    }

    return { ...result, sessionId };
  }

  kill(id) {
    const entry = this._sessionMap.get(id);
    if (entry && this._projectConfigService) {
      this._projectConfigService.removeSession(entry.projectPath, id);
    }
    this._sessionMap.delete(id);
    this._terminalService.kill(id);
  }
}

module.exports = { SessionService };
```

**2. Simplify `terminal.ipc.js`**

```js
const { ipcMain } = require('electron');

function registerTerminalIPC(sessionService, terminalService) {
  ipcMain.handle('terminal-create', (_event, params = {}) => {
    return sessionService.create(params);
  });

  ipcMain.on('terminal-input', (_event, { id, data }) => {
    terminalService.write(id, data);
  });

  ipcMain.on('terminal-resize', (_event, { id, cols, rows }) => {
    terminalService.resize(id, cols, rows);
  });

  ipcMain.on('terminal-kill', (_event, { id }) => {
    sessionService.kill(id);
  });

  ipcMain.handle('terminal-count', () => {
    return terminalService.count();
  });
}

module.exports = { registerTerminalIPC };
```

**3. Update main.js wiring**

```js
const { SessionService } = require('./src/main/services/SessionService');
// ...
const sessionService = new SessionService(terminalService, projectConfigService, configService);
registerTerminalIPC(sessionService, terminalService);
```

### Key decisions

- `terminal-input` and `terminal-resize` still go directly to TerminalService (high-frequency, no session logic needed)
- `terminal-kill` routes through SessionService to unify cleanup (eliminates duplicated logic)
- `shuttingDown` flag moves into SessionService where it logically belongs

### Test strategy

All existing tests pass. Key: `step-004-claude-session.spec.js`, `step-003-xterm-shell.spec.js`, `step-016-close-confirm.spec.js`, `step-032-project-identity.spec.js`, `step-033-configuration.spec.js`.

---

## Step 4: Extract business logic from sound-theme.ipc.js (`step-XXX-sound-theme-ipc-cleanup`)

**Issue**: sound-theme.ipc.js contains `updateConfigAfterFork()` helper, 3 dialog handlers with duplicated patterns, and cross-service coupling.

### Changes

**1. Add `setKey()` to ConfigService**

```js
setKey(key, value, projectPath) {
  if (!(key in CONFIG_SCHEMA)) return;
  if (projectPath) {
    const config = this.getProject(projectPath);
    config[key] = value;
    this._saveProject(projectPath, config);
  } else {
    this._global[key] = value;
    this._saveGlobal();
  }
}
```

Replaces the read-modify-write pattern in `updateConfigAfterFork()`.

**2. Add scope-aware methods to SoundThemeService**

```js
getResolvedSoundsForScope(configService, projectPath) {
  const themeName = configService.resolve('soundTheme', projectPath);
  return this.getResolvedSoundMap(themeName);
}

uploadSoundForScope(configService, eventName, sourceFilePath, projectPath) {
  const themeName = configService.resolve('soundTheme', projectPath);
  if (!themeName || themeName === 'none') return { success: false, error: 'No theme active' };
  const result = this.uploadSoundToTheme(themeName, eventName, sourceFilePath);
  if (result.forked) configService.setKey('soundTheme', result.dirName, projectPath);
  return result;
}

saveTrimForScope(configService, eventName, trimStart, trimEnd, projectPath) {
  const themeName = configService.resolve('soundTheme', projectPath);
  if (!themeName || themeName === 'none') return { success: false, error: 'No theme active' };
  const result = this.saveTrimData(themeName, eventName, trimStart, trimEnd);
  if (result.forked) configService.setKey('soundTheme', result.dirName, projectPath);
  return result;
}
```

**3. Simplify sound-theme.ipc.js**

- Remove `updateConfigAfterFork()` helper entirely
- Extract `getWindowFromEvent(event)` helper at the top
- Import `BrowserWindow` once at the top instead of lazy-requiring 3 times
- Each handler becomes: dialog (if needed) + single service call

### Design decision

Dialog logic **stays in IPC** because it needs `BrowserWindow.fromWebContents(event.sender)` which is only available in IPC handlers. No separate DialogService needed at this scale.

### Test strategy

All existing tests pass. Key: `step-045-cow-themes.spec.js` (all 16 tests), `step-033-configuration.spec.js`.

---

## Step 5: Clean up MainWindow module-level globals (`step-XXX-mainwindow-cleanup`)

**Issue**: `terminalService` and `forceClose` are module-level mutable state set via `setTerminalService()`.

### Changes

**Refactor MainWindow to closure-based pattern:**

```js
function createMainWindow({ windowStateService, configService, getTerminalService }) {
  let forceClose = false;

  const mainWindow = new BrowserWindow({ /* ... */ });

  mainWindow.on('close', (e) => {
    if (forceClose) return;
    const ts = getTerminalService ? getTerminalService() : null;
    if (!ts || ts.count() === 0) return;
    // ... show dialog
  });

  return {
    window: mainWindow,
    forceClose: () => { forceClose = true; mainWindow.close(); },
  };
}
```

**Update main.js:**

```js
const { window: mainWindow, forceClose: doForceClose } = createMainWindow({
  windowStateService,
  configService,
  getTerminalService: () => terminalService,  // late-binding via getter
});
terminalService = new TerminalService(mainWindow, logService);
```

The getter pattern solves the ordering problem (MainWindow created before TerminalService) while making the late-binding explicit. No more `setTerminalService()` or module-level `forceClose` flag.

Remove `getMainWindow()` export — main.js uses `mainWindow` directly from its own scope.

### Test strategy

Key: `step-016-close-confirm.spec.js`, `step-007-window-state.spec.js`, `step-001-skeleton.spec.js`.

---

## Summary

| Step | Branch | Issue | Risk | Files Changed | Files Created |
|------|--------|-------|------|---------------|---------------|
| 1 | `step-XXX-extract-inline-ipc` | Inline IPC in main.js | Low | main.js | window-state.ipc.js, shell.ipc.js, context-menu.ipc.js |
| 2 | `step-XXX-sound-protocol` | Protocol handler in main.js | Low | main.js, SoundThemeService.js | — |
| 3 | `step-XXX-session-service` | Business logic in terminal.ipc.js | Medium | main.js, terminal.ipc.js | SessionService.js |
| 4 | `step-XXX-sound-theme-ipc-cleanup` | Business logic in sound-theme.ipc.js | Medium | sound-theme.ipc.js, SoundThemeService.js, ConfigService.js | — |
| 5 | `step-XXX-mainwindow-cleanup` | MainWindow module globals | Medium-High | main.js, MainWindow.js | — |

**Ordering rationale**: Step 1 (lowest risk, reduces main.js noise) → Step 2 (simple extraction) → Step 3 (independent from sound-theme) → Step 4 (builds on pattern from step 3) → Step 5 (highest risk, changes MainWindow creation used by everything).

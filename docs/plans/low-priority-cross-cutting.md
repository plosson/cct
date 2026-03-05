# LOW Priority: Cross-Cutting Improvements Plan

## Overview

Address 6 cross-cutting issues: inconsistent LogService injection, decentralized persistence, inconsistent error patterns, scattered window references, config validation gaps, and silent error swallowing. These are incremental improvements that can be done alongside feature work.

**Recommended order**: 1 → 2 → 3 → 4 → 5 → 6 (step 1 must precede step 2; step 3 should precede step 6).

---

## Step 1: Standardize LogService Injection (`step-XXX-logservice-injection`)

**Issue**: HooksService uses module-level `_logService` variable set via `setLogService()` (anti-pattern). ProjectConfigService has no logging at all.

### Changes

**1. Convert HooksService from module functions to a class**

File: `src/main/services/HooksService.js`

Before (lines 31-34):
```js
let _logService = null;
function setLogService(logService) { _logService = logService; }
```

After:
```js
class HooksService {
  constructor(logService) {
    this._logService = logService || null;
  }
  // Convert installHooks, removeHooks to instance methods
  // Keep buildHttpHookEntry, buildCommandHookEntry, asArray, isOurHook as module-level helpers
}
module.exports = { HooksService, HTTP_HOOK_EVENTS, COMMAND_HOOK_EVENTS };
```

**2. Add LogService to ProjectConfigService**

File: `src/main/services/ProjectConfigService.js`

Before (line 16):
```js
constructor() { this._cache = new Map(); }
```

After:
```js
constructor(logService) {
  this._logService = logService || null;
  this._cache = new Map();
}
```

Add logging to the silent `catch {}` at line 41:
```js
} catch (e) {
  config = { projectId: crypto.randomUUID(), sessions: [] };
  if (this._logService) this._logService.warn('project-config', 'Failed to read sessions.json: ' + (e.message || e));
}
```

**3. Update main.js wiring**

```js
const { HooksService } = require('./src/main/services/HooksService');
const projectConfigService = new ProjectConfigService(logService);
const hooksService = new HooksService(logService);
hooksService.installHooks(hookServerService.port);
// ... on quit:
hooksService.removeHooks();
```

### Test strategy

All existing tests pass. Optionally add 2-3 tests verifying log entries appear for hooks and project-config sources.

---

## Step 2: Centralized JSON Persistence Utility (`step-XXX-json-persistence`)

**Issue**: 5 services independently implement JSON read/write with different error handling patterns.

### Changes

**Create `src/main/services/JsonStore.js`**

```js
const fs = require('fs');
const path = require('path');

function readJson(filePath, options = {}) {
  const { fallback = {}, logService = null, logSource = 'json-store' } = options;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    if (logService) logService.warn(logSource, `Failed to read ${path.basename(filePath)}: ${e.message || e}`);
    return typeof fallback === 'function' ? fallback() : fallback;
  }
}

function writeJson(filePath, data, options = {}) {
  const { logService = null, logSource = 'json-store' } = options;
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (e) {
    if (logService) logService.error(logSource, `Failed to write ${path.basename(filePath)}: ${e.message || e}`);
  }
}

module.exports = { readJson, writeJson };
```

**Migrate services** (mechanical replacement of inline fs calls):

| Service | Read pattern | Write pattern |
|---------|-------------|---------------|
| ConfigService (lines 62-74) | `readJson(path, {fallback: {}, logService, logSource: 'config'})` | `writeJson(path, data, {logService, logSource: 'config'})` |
| ProjectStore (lines 18-31) | `readJson(path, {fallback: [], logService, logSource: 'projects'})` | `writeJson(path, data, {logService, logSource: 'projects'})` |
| ProjectConfigService (lines 35-48) | `readJson(path, {fallback: () => ({projectId: uuid(), sessions: []}), logService, logSource: 'project-config'})` | `writeJson(path, data, {logService, logSource: 'project-config'})` |
| WindowStateService (lines 33-76) | `readJson(path, {fallback: DEFAULTS, logService, logSource: 'window-state'})` | `writeJson(path, data, {logService, logSource: 'window-state'})` |
| HooksService (lines 40-59) | `readJson(path, {fallback: {}, logService, logSource: 'hooks'})` | `writeJson(path, data, {logService, logSource: 'hooks'})` |

### Test strategy

All existing tests pass. Add 3-4 tests:
1. Corrupt `config.json`, launch — verify app starts and log has a warning
2. Corrupt `projects.json`, launch — verify empty project list
3. Corrupt `window-state.json`, launch — verify default dimensions used
4. Remove write permissions, trigger save — verify error logged (not crash)

---

## Step 3: Standardize Error Return Patterns (`step-XXX-error-patterns`)

**Issue**: Some methods throw, some return `{success: false, error}`, some silently swallow. Callers must handle both.

### Convention

**Services throw on errors. IPC handlers catch and return `{success: false, error}`.**

### Changes

**1. Make SoundThemeService methods always throw on error**

Example — `forkTheme()` (lines 91-117):

Before:
```js
forkTheme(dirName) {
  if (!this._validateDirName(dirName)) return { success: false, error: 'Invalid theme name' };
  // ...
  return { success: true, dirName: newDirName };
}
```

After:
```js
forkTheme(dirName) {
  if (!this._validateDirName(dirName)) throw new Error('Invalid theme name');
  // ...
  return { dirName: newDirName };
}
```

Apply to: `removeTheme()`, `uploadSoundToTheme()`, `removeSoundFromTheme()`, `saveTrimData()`, `removeTrimData()`, `exportThemeAsZip()`.

**2. Wrap IPC handlers with try/catch**

Add a helper at the top of `sound-theme.ipc.js`:
```js
function wrapHandler(fn) {
  return async (...args) => {
    try {
      const result = await fn(...args);
      return { success: true, ...result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  };
}
```

**3. No renderer changes** — renderer already checks `result.success`.

### Test strategy

All existing tests pass (return format identical from renderer's perspective). Add 2-3 tests verifying error responses for invalid inputs.

---

## Step 4: Reduce Window Reference Scattering (`step-XXX-broadcast-helper`)

**Issue**: TerminalService, UpdaterService, HookServerService each hold `_window` references with independent `isDestroyed()` checks.

### Changes

**Create `src/main/services/RendererBroadcast.js`**

```js
class RendererBroadcast {
  constructor() { this._window = null; }

  setWindow(win) { this._window = win; }

  send(channel, data) {
    if (this._window && !this._window.isDestroyed()) {
      this._window.webContents.send(channel, data);
    }
  }
}

module.exports = { RendererBroadcast };
```

**Inject into services** instead of raw window:

```js
// TerminalService
constructor(broadcast, logService) {
  this._broadcast = broadcast;
  // _send() delegates to this._broadcast.send()
}

// Same for UpdaterService, HookServerService
```

**Wire in main.js:**
```js
const broadcast = new RendererBroadcast();
broadcast.setWindow(mainWindow);
terminalService = new TerminalService(broadcast, logService);
new UpdaterService(broadcast, logService);
hookServerService = new HookServerService(projectConfigService, logService, broadcast);
```

LogService keeps its existing `BrowserWindow.getAllWindows()` pattern (different use case — broadcasts to all windows).

### Test strategy

All existing tests pass. Add 2 tests verifying terminal-data and hook-event messages arrive correctly.

---

## Step 5: Config Validation on Read (`step-XXX-config-validation`)

**Issue**: ConfigService validates keys against CONFIG_SCHEMA on write but not on read. Unknown keys silently kept. No type validation.

### Changes

**Add `_filterAndValidate()` method to ConfigService:**

```js
_filterAndValidate(config, source) {
  const filtered = {};
  for (const [key, value] of Object.entries(config)) {
    if (!(key in CONFIG_SCHEMA)) {
      if (this._logService) this._logService.warn('config', `Unknown key "${key}" in ${source}, ignoring`);
      continue;
    }
    const schema = CONFIG_SCHEMA[key];
    if (schema.type === 'string' && typeof value !== 'string') {
      if (this._logService) this._logService.warn('config', `Invalid type for "${key}" in ${source}, expected string`);
      continue;
    }
    if (schema.type === 'select' && schema.options && !schema.options.includes(value)) {
      if (this._logService) this._logService.warn('config', `Invalid value for "${key}" in ${source}: "${value}"`);
      continue;
    }
    filtered[key] = value;
  }
  return filtered;
}
```

Apply in `_loadGlobal()` and `_loadProject()`:
```js
_loadGlobal() {
  try {
    const raw = JSON.parse(fs.readFileSync(this._globalPath, 'utf8'));
    this._global = this._filterAndValidate(raw, 'global config');
  } catch (e) { /* ... */ }
}
```

### Test strategy

Add 3-4 tests:
1. Pre-seed config with `{"bogusKey": 42}` — verify it's filtered out and warning logged
2. Pre-seed with `{"theme": "invalid-value"}` — verify default used
3. Pre-seed with `{"claudeCommand": 123}` (wrong type) — verify dropped
4. Clean config — verify no warnings

---

## Step 6: Ensure All Errors Flow Through LogService (`step-XXX-error-logging`)

**Issue**: Many `catch {}` blocks silently swallow errors. 11 in SoundThemeService alone, 1 in HookServerService.

### Changes

**Add logging to all silent catch blocks in SoundThemeService:**

For each `catch { /* ignore */ }`:

Before (e.g., line 42):
```js
} catch { /* ignore */ }
```

After:
```js
} catch (e) {
  this._log('warn', 'Failed to clean up legacy overrides: ' + (e.message || e));
}
```

Apply to all 11 catch blocks. For frequently-called methods like `_readThemeJson` (called per-theme in `listThemes`), only warn if the file exists but is invalid:
```js
} catch (e) {
  if (fs.existsSync(jsonPath)) {
    this._log('warn', `Invalid theme.json in ${dirName}: ${e.message || e}`);
  }
}
```

**Add logging to HookServerService JSON parse failure** (line 99):
```js
} catch (e) {
  this._logService.warn('hooks', 'Failed to parse hook payload: ' + (e.message || e));
  return;
}
```

### Test strategy

Add 2-3 tests:
1. Place invalid `theme.json` in a theme dir — verify warning in logs, valid themes still load
2. Verify no error-level entries during clean startup
3. Corrupt `sessions.json` — verify warning logged when project accessed

---

## Summary

| Step | Branch | Issue | Key Files | Size |
|------|--------|-------|-----------|------|
| 1 | `step-XXX-logservice-injection` | LogService injection | HooksService.js, ProjectConfigService.js, main.js | Small (~80 lines) |
| 2 | `step-XXX-json-persistence` | Decentralized persistence | New JsonStore.js + 5 services | Medium (~120 lines) |
| 3 | `step-XXX-error-patterns` | Error return patterns | SoundThemeService.js, sound-theme.ipc.js | Medium (~100 lines) |
| 4 | `step-XXX-broadcast-helper` | Window references | New RendererBroadcast.js + 3 services + main.js | Medium (~80 lines) |
| 5 | `step-XXX-config-validation` | Config validation on read | ConfigService.js | Small (~50 lines) |
| 6 | `step-XXX-error-logging` | Silent error swallowing | SoundThemeService.js, HookServerService.js | Small (~40 lines) |

**Dependencies**: Step 1 before step 2 (HooksService must be a class). Step 3 before step 6 (standardize error patterns before adding logging). Steps 4 and 5 are independent.

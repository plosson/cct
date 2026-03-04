# Rename Claudiu → Claudiu Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename the app from "Claudiu" to "Claudiu" across the entire codebase, including auto-migration for existing `.claudiu/` directories and Electron userData.

**Architecture:** Mechanical rename across all source, test, and documentation files. Two migration paths: (1) per-project `.claudiu/` → `.claudiu/` auto-rename in ProjectConfigService/ConfigService, (2) Electron userData copy from `~/Library/Application Support/cct/` → `~/Library/Application Support/claudiu/` on first launch.

**Tech Stack:** Electron, Node.js, Playwright tests, esbuild

---

### Task 1: Create step branch

**Step 1: Create and checkout branch**

```bash
git checkout -b step-041-rename-to-claudiu
```

**Step 2: Commit placeholder**

No commit needed — branch is created.

---

### Task 2: Rename app identity files

These are the core files that define the app name. All changes are coordinated so tests still pass (env vars, window globals, etc. are done in later tasks).

**Files:**
- Modify: `package.json:1-8`
- Modify: `electron-builder.config.js:2-3`
- Modify: `index.html:7`
- Modify: `main.js:1-2,205`

**Step 1: Update package.json**

Change lines 2, 4, 7:
```json
{
  "name": "claudiu",
  "version": "0.2.15",
  "description": "Claudiu — A Terminal Development Environment",
  "main": "main.js",
  "bin": {
    "claudiu": "bin/claudiu"
  },
```

Note: The bin field points to `bin/claudiu` which doesn't exist yet — that's Task 3. Don't run `npm install` yet.

**Step 2: Update electron-builder.config.js**

```js
module.exports = {
  appId: "com.claudiu.app",
  productName: "Claudiu",
```

Keep `publish.repo: "claudiu"` unchanged (owner will rename the GitHub repo separately).

**Step 3: Update index.html title**

Change line 7:
```html
  <title>Claudiu</title>
```

**Step 4: Update main.js**

Line 1-2 comment:
```js
/**
 * Claudiu - Main Process Entry Point
 */
```

Line 205 log message:
```js
    logService.info('app', 'Claudiu started — v' + app.getVersion());
```

**Step 5: Commit**

```bash
git add package.json electron-builder.config.js index.html main.js
git commit -m "chore: rename app identity from Claudiu to Claudiu"
```

---

### Task 3: Rename CLI binary

**Files:**
- Rename: `bin/claudiu` → `bin/claudiu`

**Step 1: Rename the file**

```bash
git mv bin/claudiu bin/claudiu
```

**Step 2: Update contents of bin/claudiu**

Replace the entire file contents with:
```bash
#!/bin/bash
# Claudiu CLI launcher — opens a project in Claudiu
#
# Usage:
#   claudiu .                         # open current directory
#   claudiu /path/to/project          # open specific project
#   claudiu                           # just open/focus Claudiu
#
# If Claudiu is already running, the project is opened in the existing window.
# If Claudiu is not running, it is launched with the project argument.

set -euo pipefail

# Resolve the project path to an absolute directory
ARGS=()
if [ $# -gt 0 ]; then
  CANDIDATE="$(cd "$1" 2>/dev/null && pwd || echo "")"
  if [ -n "$CANDIDATE" ] && [ -d "$CANDIDATE" ]; then
    ARGS=("$CANDIDATE")
  else
    echo "claudiu: not a directory: $1" >&2
    exit 1
  fi
fi

# Find the Claudiu app bundle (packaged) or fall back to dev mode
CLAUDIU_APP="/Applications/Claudiu.app"
if [ -d "$CLAUDIU_APP" ]; then
  open -a "$CLAUDIU_APP" -- "${ARGS[@]+"${ARGS[@]}"}"
else
  # Dev mode: find the project root (directory containing this script's parent)
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
  electron "$PROJECT_ROOT" "${ARGS[@]+"${ARGS[@]}"}"
fi
```

**Step 3: Ensure executable**

```bash
chmod +x bin/claudiu
```

**Step 4: Commit**

```bash
git add bin/
git commit -m "chore: rename CLI binary from cct to claudiu"
```

---

### Task 4: Rename environment variables in source files

All `CCT_*` env vars → `CLAUDIU_*` in source code (NOT tests yet — that's Task 8).

**Files:**
- Modify: `main.js:57-58,64`
- Modify: `src/main/windows/MainWindow.js:32`
- Modify: `src/main/preload.js:21`
- Modify: `src/main/ipc/terminal.ipc.js:33-34,52,54`
- Modify: `src/main/services/HooksService.js:11-13,90-91,93`
- Modify: `playwright.config.js:6`

**Step 1: main.js**

Line 57-58:
```js
if (process.env.CLAUDIU_USER_DATA) {
  app.setPath('userData', process.env.CLAUDIU_USER_DATA);
}
```

Line 64:
```js
const gotTheLock = process.env.CLAUDIU_USER_DATA || app.requestSingleInstanceLock({ projectPath: initialProjectPath });
```

**Step 2: MainWindow.js**

Line 32:
```js
  const headless = process.env.CLAUDIU_HEADLESS === '1';
```

**Step 3: preload.js**

Line 21:
```js
    spawnCommand: process.env.CLAUDIU_COMMAND || undefined
```

**Step 4: terminal.ipc.js**

Line 33-34:
```js
    // CLAUDIU_COMMAND env var overrides in test mode only (when CLAUDIU_USER_DATA is set)
    let command = params.command || (process.env.CLAUDIU_USER_DATA && process.env.CLAUDIU_COMMAND);
```

Line 52:
```js
      env.CLAUDIU_PROJECT_ID = projectId;
```

Line 54:
```js
    env.CLAUDIU_SESSION_ID = sessionId;
```

Line 71 comment:
```js
    // Record session in .claudiu/sessions.json
```

**Step 5: HooksService.js**

Line 4 comment:
```js
 * Installs HTTP hooks for all 17 Claude Code events, pointing to Claudiu's local hook server.
```

Line 11-14:
```js
// In test mode (CLAUDIU_USER_DATA set), write to isolated dir instead of real ~/.claude/settings.json
const CLAUDE_SETTINGS_PATH = process.env.CLAUDIU_USER_DATA
  ? path.join(process.env.CLAUDIU_USER_DATA, 'claude-settings.json')
  : path.join(os.homedir(), '.claude', 'settings.json');
```

Line 90:
```js
        command: `curl -s -X POST http://localhost:${port}/hooks -H 'Content-Type: application/json' -H 'X-Claudiu-Hook: true' -H "X-Claudiu-Session-Id: $CLAUDIU_SESSION_ID" -d @-`,
```

Line 93:
```js
    allowedEnvVars: ['CLAUDIU_SESSION_ID'],
```

**Step 6: playwright.config.js**

Line 6:
```js
process.env.CLAUDIU_HEADLESS = '1';
```

**Step 7: Commit**

```bash
git add main.js src/main/windows/MainWindow.js src/main/preload.js src/main/ipc/terminal.ipc.js src/main/services/HooksService.js playwright.config.js
git commit -m "chore: rename CCT_* environment variables to CLAUDIU_*"
```

---

### Task 5: Rename HTTP hook headers and hook detection

**Files:**
- Modify: `src/main/services/HooksService.js:73,107,112-113,118,135,151-152`
- Modify: `src/main/services/HookServerService.js:89,93-94,110,112,116`

**Step 1: HooksService.js — buildHttpHookEntry**

Line 73:
```js
          'X-Claudiu-Hook': 'true',
```

**Step 2: HooksService.js — isOurHook**

Lines 107-114:
```js
/**
 * Check if a hook entry is one of ours.
 * Detects HTTP hooks by X-Claudiu-Hook header, command hooks by the curl + X-Claudiu-Hook pattern.
 */
function isOurHook(hookEntry) {
  if (!hookEntry || !hookEntry.hooks) return false;
  return hookEntry.hooks.some(h =>
    (h.type === 'http' && h.headers && h.headers['X-Claudiu-Hook'] === 'true') ||
    (h.type === 'command' && h.command && h.command.includes('X-Claudiu-Hook'))
  );
}
```

**Step 3: HooksService.js — comments**

Line 118:
```js
 * Install Claudiu hooks into ~/.claude/settings.json
```

Line 135:
```js
      // Keep existing non-Claudiu hooks, replace any previous Claudiu hook (port may have changed)
```

Lines 151-152:
```js
 * Remove Claudiu hooks from ~/.claude/settings.json
 * Only removes our hooks (detected by X-Claudiu-Hook header)
```

**Step 4: HookServerService.js**

Line 89 comment:
```js
   * For SessionStart (command hook): CLAUDIU_SESSION_ID arrives via header, Claude's session_id in body.
```

Line 93-94:
```js
    // Only process hooks sent by Claudiu (ignore other tools' hooks)
    if (headers['x-claudiu-hook'] !== 'true') return;
```

Line 110:
```js
    // On SessionStart, link Claude's session_id to Claudiu's session via the header
```

Line 112:
```js
      const claudiuSessionId = headers['x-claudiu-session-id'];
```

Line 113:
```js
      if (claudiuSessionId) {
```

Line 114:
```js
        const updated = this._projectConfigService.updateClaudeSessionId(claudiuSessionId, claudeSessionId);
```

Line 116:
```js
          this._logService.info('hooks', `Linked claude=${claudeSessionId.slice(0, 8)} → claudiu=${claudiuSessionId.slice(0, 8)}`);
```

**Step 5: Commit**

```bash
git add src/main/services/HooksService.js src/main/services/HookServerService.js
git commit -m "chore: rename X-Claudiu-Hook headers to X-Claudiu-Hook"
```

---

### Task 6: Rename custom protocol

**Files:**
- Modify: `main.js:112,121-123,131`
- Modify: `src/main/services/SoundThemeService.js:226,238`

**Step 1: main.js protocol registration**

Line 112:
```js
    { scheme: 'claudiu-sound', privileges: { standard: false, supportFetchAPI: true, stream: true } },
```

Lines 121-123:
```js
    // Handle claudiu-sound:// protocol — serves mp3 files from themes directory
    protocol.handle('claudiu-sound', (request) => {
      // URL format: claudiu-sound://theme-dir-name/filename.mp3
```

**Step 2: SoundThemeService.js**

Line 226 comment:
```js
   * Get the sound URL map for a theme (event -> claudiu-sound:// URL).
```

Line 238:
```js
        map[event] = `claudiu-sound://${dirName}/${filename}`;
```

Also update line 138 comment (the GitHub URL example):
```js
   * @param {string} repoUrl - GitHub repo URL (e.g. https://github.com/user/my-claudiu-theme)
```

**Step 3: Commit**

```bash
git add main.js src/main/services/SoundThemeService.js
git commit -m "chore: rename claudiu-sound:// protocol to claudiu-sound://"
```

---

### Task 7: Rename per-project config directory with auto-migration

**Files:**
- Modify: `src/main/services/ProjectConfigService.js:2-3,11,20,102-103,121`
- Modify: `src/main/services/ConfigService.js:6,105`
- Modify: `.gitignore:10`

**Step 1: ProjectConfigService.js — rename CONFIG_DIR and add migration**

Replace the entire file top section (lines 1-48):

```js
/**
 * ProjectConfigService — manages per-project .claudiu/sessions.json
 * Each project folder gets a .claudiu/ directory with a sessions.json
 * containing a stable projectId (UUID) and session tracking.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_DIR = '.claudiu';
const LEGACY_CONFIG_DIR = '.cct';
const CONFIG_FILE = 'sessions.json';

class ProjectConfigService {
  constructor() {
    this._cache = new Map(); // projectPath -> config
  }

  /**
   * Auto-migrate legacy .claudiu/ directory to .claudiu/ if needed.
   * Only migrates if .claudiu/ doesn't exist but .claudiu/ does.
   */
  _migrateIfNeeded(projectPath) {
    const newDir = path.join(projectPath, CONFIG_DIR);
    const oldDir = path.join(projectPath, LEGACY_CONFIG_DIR);
    if (!fs.existsSync(newDir) && fs.existsSync(oldDir)) {
      fs.renameSync(oldDir, newDir);
    }
  }

  /**
   * Read or create .claudiu/sessions.json for a project
   * @param {string} projectPath
   * @returns {{ projectId: string, sessions: Array }}
   */
  getConfig(projectPath) {
    if (this._cache.has(projectPath)) {
      return this._cache.get(projectPath);
    }

    this._migrateIfNeeded(projectPath);

    const filePath = path.join(projectPath, CONFIG_DIR, CONFIG_FILE);
```

Update line 102-103 comment:
```js
  /**
   * Update claudeSessionId for a Claudiu session (searched across all cached projects)
   * @param {string} claudiuSessionId — the Claudiu-assigned session UUID
   * @param {string} claudeSessionId — Claude Code's own session ID
   * @returns {boolean} true if the session was found and updated
   */
  updateClaudeSessionId(claudiuSessionId, claudeSessionId) {
    for (const [projectPath, config] of this._cache) {
      const entry = config.sessions.find(s => s.id === claudiuSessionId);
```

Update line 121 comment:
```js
  /**
   * Write config to .claudiu/sessions.json
```

**Step 2: ConfigService.js**

Line 6 comment:
```js
 * Per-project config lives in .claudiu/config.json (inside the project folder)
```

Line 104-105 — add migration + rename path:
```js
  _projectConfigPath(projectPath) {
    // Auto-migrate legacy .claudiu/ → .claudiu/
    const newDir = path.join(projectPath, '.claudiu');
    const oldDir = path.join(projectPath, '.cct');
    if (!fs.existsSync(newDir) && fs.existsSync(oldDir)) {
      fs.renameSync(oldDir, newDir);
    }
    return path.join(projectPath, '.claudiu', 'config.json');
  }
```

**Step 3: .gitignore**

Line 10:
```
.claudiu/
```

**Step 4: Commit**

```bash
git add src/main/services/ProjectConfigService.js src/main/services/ConfigService.js .gitignore
git commit -m "chore: rename .claudiu/ config dir to .claudiu/ with auto-migration"
```

---

### Task 8: Add Electron userData migration

**Files:**
- Modify: `main.js` (add migration logic after line 59, before single-instance lock)

**Step 1: Add userData migration in main.js**

After the `CLAUDIU_USER_DATA` block (line 59) and before the single-instance lock (line 62), add:

```js
// Auto-migrate userData from legacy "claudiu" directory to "claudiu"
// Only runs on first launch after rename — if new dir is empty but old one has data
if (!process.env.CLAUDIU_USER_DATA) {
  const userDataPath = app.getPath('userData'); // Now points to .../claudiu/
  const legacyPath = path.join(path.dirname(userDataPath), 'cct');
  if (!fs.existsSync(userDataPath) || fs.readdirSync(userDataPath).length === 0) {
    if (fs.existsSync(legacyPath)) {
      try {
        if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
        for (const file of ['projects.json', 'config.json', 'window-state.json']) {
          const src = path.join(legacyPath, file);
          const dst = path.join(userDataPath, file);
          if (fs.existsSync(src)) fs.copyFileSync(src, dst);
        }
      } catch {
        // Migration failed — start fresh
      }
    }
  }
}
```

**Step 2: Commit**

```bash
git add main.js
git commit -m "feat: auto-migrate Electron userData from cct to claudiu on first launch"
```

---

### Task 9: Rename window globals and test infrastructure

This is the largest mechanical change — all `_claudiu*` globals in the renderer and every test file.

**Files:**
- Modify: `src/renderer/index.js` — all `_claudiu` prefixes → `_claudiu`
- Modify: `tests/helpers.js` — env vars and temp dir prefix
- Modify: ALL test files in `tests/` — `_claudiu*` globals, `claudiu-test-*` temp dirs, env vars

**Step 1: src/renderer/index.js**

Global find-and-replace: `_claudiu` → `_claudiu` (approximately 20 occurrences on lines 16, 1789-1857)

Specifically:
- `_claudiuProjectColors` → `_claudiuProjectColors`
- `_claudiuGetBufferText` → `_claudiuGetBufferText`
- `_claudiuActiveTabId` → `_claudiuActiveTabId`
- `_claudiuSelectedProject` → `_claudiuSelectedProject`
- `_claudiuProjectMRU` → `_claudiuProjectMRU`
- `_claudiuCloseOtherTabs` → `_claudiuCloseOtherTabs`
- `_claudiuCloseAllTabs` → `_claudiuCloseAllTabs`
- `_claudiuDuplicateTab` → `_claudiuDuplicateTab`
- `_claudiuGetTabContextMenuItems` → `_claudiuGetTabContextMenuItems`
- `_claudiuGetTabOrder` → `_claudiuGetTabOrder`
- `_claudiuGetProjectContextMenuItems` → `_claudiuGetProjectContextMenuItems`
- `_claudiuIsSidebarVisible` → `_claudiuIsSidebarVisible`
- `_claudiuGetSidebarMode` → `_claudiuGetSidebarMode`
- `_claudiuProjectActivity` → `_claudiuProjectActivity`
- `_claudiuGetSessionsForProject` → `_claudiuGetSessionsForProject`
- `_claudiuReloadProjects` → `_claudiuReloadProjects`
- `_claudiuSelectProject` → `_claudiuSelectProject`
- `_claudiuAddDebugEntry` → `_claudiuAddDebugEntry`

**Step 2: tests/helpers.js**

```js
/**
 * Shared test helpers for Claudiu Playwright tests
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const appPath = path.join(__dirname, '..');

function launchEnv(extra = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'claudiu-test-'));
  return {
    ...process.env,
    CLAUDIU_COMMAND: process.env.SHELL || '/bin/zsh',
    CLAUDIU_USER_DATA: userData,
    ...extra,
  };
}

module.exports = { appPath, launchEnv };
```

**Step 3: Update ALL test files**

For every test file in `tests/`, apply these replacements:
1. `_claudiu` → `_claudiu` (window globals)
2. `claudiu-test-` → `claudiu-test-` (temp dir prefixes)
3. `CLAUDIU_COMMAND` → `CLAUDIU_COMMAND` (env var references)
4. `CLAUDIU_USER_DATA` → `CLAUDIU_USER_DATA` (env var references)
5. `CLAUDIU_PROJECT_ID` → `CLAUDIU_PROJECT_ID` (env var references)
6. `CLAUDIU_SESSION_ID` → `CLAUDIU_SESSION_ID` (env var references)
7. `X-Claudiu-Hook` → `X-Claudiu-Hook` (hook header references)
8. `'Claudiu'` → `'Claudiu'` (string literals in assertions)
9. `HELLO_CLAUDIU` → `HELLO_CLAUDIU` (test echo strings)
10. `CLAUDIU_CLIPBOARD_TEST_` → `CLAUDIU_CLIPBOARD_TEST_` (test strings)
11. `.claudiu/` → `.claudiu/` (config dir references)
12. `bin/claudiu` → `bin/claudiu` (CLI binary references)
13. Comments mentioning Claudiu → Claudiu

Test files to modify (every file in `tests/`):
- `step-001-skeleton.spec.js`
- `step-003-xterm-shell.spec.js`
- `step-004-claude-session.spec.js`
- `step-005-tabbed-terminals.spec.js`
- `step-006-sidebar-projects.spec.js`
- `step-009-status-bar.spec.js`
- `step-010-terminal-search.spec.js`
- `step-011-tab-context-menu.spec.js`
- `step-012-tab-reorder.spec.js`
- `step-013-tab-rename.spec.js`
- `step-014-font-zoom.spec.js`
- `step-015-tab-activity.spec.js`
- `step-016-close-confirm.spec.js`
- `step-017-shortcut-help.spec.js`
- `step-018-tab-number-shortcuts.spec.js`
- `step-019-project-activity.spec.js`
- `step-020-duplicate-tab.spec.js`
- `step-021-terminal-bell.spec.js`
- `step-022-clear-terminal.spec.js`
- `step-023-clipboard.spec.js`
- `step-024-move-tab.spec.js`
- `step-025-session-uptime.spec.js`
- `step-026-select-all.spec.js`
- `step-027-toggle-sidebar.spec.js`
- `step-028-project-context-menu.spec.js`
- `step-029-terminal-links.spec.js`
- `step-031-close-others-shortcut.spec.js`
- `step-032-project-identity.spec.js`
- `step-033-configuration.spec.js`
- `step-034-cli-invocation.spec.js`
- `step-035-debug-pane.spec.js`
- `step-036-npm-start-project.spec.js`

**Step 4: Commit**

```bash
git add src/renderer/index.js tests/
git commit -m "chore: rename _claudiu* window globals to _claudiu* and update all tests"
```

---

### Task 10: Update documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `STEPS.md`
- Modify: All files in `notes/STEP_NOTES_*.md`
- Modify: All files in `docs/plans/*.md`

**Step 1: CLAUDE.md**

- Line 1: `# Claudiu - Claude Code Terminal` → `# Claudiu — A Terminal Development Environment`
- Line 15: Update fork URL reference (keep as-is since user will change repo)
- Update all other Claudiu → Claudiu references
- Update `.claudiu/` → `.claudiu/` references
- Update `claudiu .` → `claudiu .` usage examples

**Step 2: STEPS.md**

- Update `claudiu .` → `claudiu .`
- Update `claudiu $HOME/...` → `claudiu $HOME/...`

**Step 3: notes/ files**

Apply find-and-replace across all STEP_NOTES files:
- `Claudiu` → `Claudiu` (as app name in prose)
- `.claudiu/` → `.claudiu/`
- `claudiu-sound://` → `claudiu-sound://`
- `_claudiu` → `_claudiu` (in code references)
- `CCT_*` → `CLAUDIU_*` (env var references)
- `X-Claudiu-*` → `X-Claudiu-*` (header references)
- `bin/claudiu` → `bin/claudiu`
- `claudiu .` → `claudiu .`

**Step 4: docs/plans/ files**

Same replacements as notes/ across all plan documents.

**Step 5: Commit**

```bash
git add CLAUDE.md STEPS.md notes/ docs/plans/
git commit -m "docs: rename all Claudiu references to Claudiu in documentation"
```

---

### Task 11: Update CI/CD

**Files:**
- Modify: `.github/workflows/release.yml:105`

**Step 1: Update artifact name**

Line 105:
```yaml
          name: claudiu-dev-${{ steps.bump.outputs.version }}
```

**Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: rename artifact from cct-dev to claudiu-dev"
```

---

### Task 12: Regenerate package-lock.json and verify

**Step 1: Regenerate lock file**

```bash
npm install
```

This updates `package-lock.json` to reflect the new package name `claudiu`.

**Step 2: Run the full test suite**

```bash
npm test
```

Expected: All tests pass. If any fail, fix the missed rename and re-run.

**Step 3: Commit**

```bash
git add package-lock.json
git commit -m "chore: regenerate package-lock.json for claudiu rename"
```

---

### Task 13: Write step journal and final verification

**Files:**
- Create: `notes/STEP_NOTES_041.md`

**Step 1: Run tests one final time**

```bash
npm test
```

Expected: All tests pass.

**Step 2: Write STEP_NOTES_041.md**

Document what was done, choices made, migration logic, test results.

**Step 3: Commit and push**

```bash
git add notes/STEP_NOTES_041.md
git commit -m "docs: add step 041 journal for Claudiu → Claudiu rename"
```

---

## Execution Notes

- **Task 9 is the largest** — ~32 test files need mechanical find-and-replace. Best done with parallel subagents (one per batch of files).
- **Task 7 (migration code)** and **Task 8 (userData migration)** are the only tasks with new logic — everything else is pure rename.
- **ConfigService migration** is duplicated (both ProjectConfigService and ConfigService check for `.claudiu/` → `.claudiu/`). This is intentional — either service could be first to access a project dir.
- Tests should be run after Task 12, not after each individual task, since intermediate states have mismatched env var names between source and tests.

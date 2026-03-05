# HIGH Priority: Renderer Decomposition Plan

## Overview

Split the 2700-line `src/renderer/index.js` monolith into ~13 focused modules. The analysis identified 14 distinct concerns mixed in one file, 20+ module-scoped globals, 30+ scattered IPC calls, and 9 duplicated code patterns.

**Constraint**: Vanilla JS (no framework), esbuild bundler, each step leaves the app fully functional with all existing tests passing.

---

## Phase 0: Shared Utilities (foundation for all modules)

### Step A: Extract shared UI utilities (`step-XXX-renderer-utils`)

Create `src/renderer/utils/` with reusable helpers that eliminate the 9 duplicated patterns:

**1. `src/renderer/utils/overlay.js`** — Overlay creation + close pattern
```js
// Replaces 3 duplicated overlay creation blocks (picker, search, shortcuts)
export function createOverlay(className, panelClassName) { /* ... */ }
export function closeOverlay(overlayRef, refocusTerminal) { /* ... */ }
```
Lines replaced: 696-714, 945-977, 1263-1288, 760-765, 1019-1026, 1307-1312

**2. `src/renderer/utils/drag-resize.js`** — Generic drag-resize handler
```js
// Replaces 2 duplicated resize handlers (sidebar, debug pane)
export function createDragResize(handle, axis, { minSize, maxSize, onResize, onEnd }) { /* ... */ }
```
Lines replaced: 2206-2243, 2278-2313

**3. `src/renderer/utils/mru-list.js`** — MRU list management
```js
export class MRUList {
  access(item) { /* ... */ }
  add(item) { /* ... */ }
  remove(item) { /* ... */ }
  prune(validItems) { /* ... */ }
  toArray() { /* ... */ }
}
```
Lines replaced: 287-289, 337-342

**4. `src/renderer/utils/disposable.js`** — Lifecycle/cleanup helper
```js
export class DisposableGroup {
  add(disposeFn) { /* ... */ }
  dispose() { /* ... */ }
}
```
Standardizes the cleanup pattern used by sessions (line 572-580) and settings (line 1371).

**Test strategy**: Extract pure utility functions first, import them back into index.js. All existing tests must pass. Add unit-style tests for MRUList if feasible.

---

## Phase 1: State Management (must come before module extraction)

### Step B: Extract AppState (`step-XXX-app-state`)

Create `src/renderer/state/AppState.js` — a unified state store replacing 20+ module-scoped globals.

**State it owns:**
```js
// src/renderer/state/AppState.js
class AppState {
  constructor() {
    this.sessions = new Map();       // session storage
    this.activeId = null;            // active tab ID
    this.selectedProjectPath = null; // selected project
    this.projects = [];              // project list
    this.projectMRU = new MRUList(); // MRU ordering (uses util from Phase 0)
    this.projectActivity = new Set();// activity badges
    this.sidebarMode = 'pinned';    // sidebar mode
    this.sidebarRevealed = false;    // sidebar visibility
    this.sidebarWidth = 220;        // persisted width
    this.debugPaneOpen = false;      // debug pane state
    this.debugPaneHeight = 200;      // debug pane height
    this.currentFontSize = 14;       // zoom level
    this.soundCache = new Map();     // sound cache
    this.draggedTabId = null;        // drag state
  }

  // Convenience getters
  getActiveSession() { return this.sessions.get(this.activeId); }
  getProjectSessions(projectPath) { /* filter sessions by projectPath */ }
}

export const appState = new AppState();
```

**Migration approach:**
1. Create AppState with all current globals as properties
2. In index.js, replace `let activeId = null` with `import { appState } from './state/AppState'`
3. Find-and-replace all bare references: `activeId` → `appState.activeId`, `sessions` → `appState.sessions`, etc.
4. This is a mechanical refactoring — no logic changes

**Test strategy**: All existing tests pass unchanged (state access pattern is the same, just namespaced under `appState`).

---

## Phase 2: Module Extraction (one module per step, ordered by dependency)

### Step C: Extract ThemeManager (`step-XXX-theme-manager`)

**Responsibility**: Dark/light theme application, OS preference detection.

**From index.js**: Lines 91-141, 2572-2583

**New file**: `src/renderer/modules/ThemeManager.js`

```js
// State: none (pure functions + one OS listener)
// Interface:
export function getTerminalTheme(mode) { /* ... */ }
export function applyThemeSetting(theme, appState) { /* ... */ }
export function listenToOSThemeChanges(onThemeChange) { /* ... */ }
```

**Why first**: No dependencies on other modules. Other modules (SessionManager, SettingsUI) depend on theme.

---

### Step D: Extract FontSizeManager (`step-XXX-font-size-manager`)

**Responsibility**: Zoom in/out/reset, constraints, persistence.

**From index.js**: Lines 1028-1050

**New file**: `src/renderer/modules/FontSizeManager.js`

```js
// State owned: appState.currentFontSize (reads/writes)
// Interface:
export function setFontSize(size, appState, api) { /* ... */ }
export function zoomIn(appState, api) { /* ... */ }
export function zoomOut(appState, api) { /* ... */ }
export function zoomReset(appState, api) { /* ... */ }
```

**Why early**: Small, self-contained, used by keyboard shortcuts and settings.

---

### Step E: Extract KeyboardShortcutManager (`step-XXX-keyboard-shortcuts`)

**Responsibility**: Keybinding config, key event normalization, action dispatch.

**From index.js**: Lines 34-73 (DEFAULT_KEYBINDINGS), 2443-2451 (normalizeKeyEvent), 2676-2684 (dispatch)

**New file**: `src/renderer/modules/KeyboardShortcutManager.js`

```js
// State owned: keybindings Map, actions Map
// Interface:
export class KeyboardShortcutManager {
  constructor(defaultBindings) { /* ... */ }
  registerAction(name, handler) { /* ... */ }
  normalizeKeyEvent(e) { /* ... */ }
  handleKeyDown(e) { /* ... */ }  // called from document keydown listener
  getBindings() { /* ... */ }     // for shortcut help overlay
}
```

**Migration**:
1. Move DEFAULT_KEYBINDINGS array and normalize/dispatch logic
2. In index.js, create instance and register all actions (actions still reference index.js functions initially)
3. Later steps will move action handlers into their respective modules

---

### Step F: Extract StatusBar (`step-XXX-status-bar`)

**Responsibility**: Project/session display, uptime timer, terminal dimensions.

**From index.js**: Lines 2124-2192

**New file**: `src/renderer/modules/StatusBar.js`

```js
// State owned: uptimeInterval
// Interface:
export class StatusBar {
  constructor(elements) { /* ... */ }  // receives DOM refs
  update(appState) { /* ... */ }
  startUptimeTimer(session) { /* ... */ }
  stopUptimeTimer() { /* ... */ }
}
```

---

### Step G: Extract DebugPane (`step-XXX-debug-pane`)

**Responsibility**: Log display, resize handling, auto-scroll.

**From index.js**: Lines 85-86, 2246-2367

**New file**: `src/renderer/modules/DebugPane.js`

```js
// State owned: debugAutoScroll (reads appState.debugPaneOpen, debugPaneHeight)
// Interface:
export class DebugPane {
  constructor(panelEl, appState, api) { /* ... */ }
  toggle() { /* ... */ }
  addEntry(entry) { /* ... */ }
  clear() { /* ... */ }
  initResize() { /* uses createDragResize util */ }
  loadHistory() { /* ... */ }
}
```

Uses `createDragResize` utility from Phase 0.

---

### Step H: Extract SidebarManager (`step-XXX-sidebar-manager`)

**Responsibility**: Sidebar rendering, resize handling, auto-hide/dock mode.

**From index.js**: Lines 229-377 (render), 1078-1157 (auto-hide), 2194-2244 (resize)

**New file**: `src/renderer/modules/SidebarManager.js`

```js
// State: reads/writes appState.sidebarMode, sidebarRevealed, sidebarWidth, selectedProjectPath, projects, projectMRU, projectActivity
// Interface:
export class SidebarManager {
  constructor(sidebarEl, appState, api, callbacks) { /* ... */ }
  render() { /* ... */ }
  selectProject(projectPath) { /* ... */ }
  toggleMode() { /* ... */ }
  initResize() { /* uses createDragResize util */ }
  initAutoHide() { /* ... */ }
  updateActivityBadge(projectPath) { /* ... */ }
}
```

**Callbacks**: `onProjectSelected(path)`, `onAddProject()`, `onRemoveProject(path)` — allows index.js to handle cross-module coordination.

---

### Step I: Extract ModalManager (`step-XXX-modal-manager`)

**Responsibility**: Project picker, search bar, shortcut help overlays.

**From index.js**: Lines 687-797 (picker), 936-1026 (search), 1260-1312 (shortcuts)

**New file**: `src/renderer/modules/ModalManager.js`

```js
// State: per-overlay local state (pickerOverlay, searchBarEl, shortcutHelpOverlay)
// Interface:
export class ModalManager {
  constructor(appState, keyboardManager, callbacks) { /* ... */ }
  openProjectPicker() { /* uses createOverlay util */ }
  closeProjectPicker() { /* uses closeOverlay util */ }
  openSearchBar() { /* ... */ }
  closeSearchBar() { /* ... */ }
  showShortcutHelp() { /* ... */ }
  closeShortcutHelp() { /* ... */ }
}
```

**Callbacks**: `onProjectSelected(path)`, `onSearchNext/Prev(query)` — for cross-module actions.

Uses `createOverlay` and `closeOverlay` utilities from Phase 0.

---

### Step J: Extract TabManager (`step-XXX-tab-manager`)

**Responsibility**: Tab DOM creation, drag-drop, rename, context menus.

**From index.js**: Lines 448-518 (tab creation), 473-516 (drag-drop handlers), 809-854 (rename), 858-903 (context menu)

**New file**: `src/renderer/modules/TabManager.js`

```js
// State: appState.draggedTabId
// Interface:
export class TabManager {
  constructor(tabBarEl, appState, api, callbacks) { /* ... */ }
  createTab(session) { /* returns tabEl */ }
  activateTab(id) { /* ... */ }
  closeTab(id) { /* ... */ }
  renameTab(id, newName) { /* ... */ }
  moveTab(id, direction) { /* ... */ }
  showContextMenu(tabId) { /* ... */ }
}
```

**Callbacks**: `onTabActivated(id)`, `onTabClosed(id)`, `onTabMoved(id, direction)` — for coordination with SessionManager.

---

### Step K: Extract SoundManager (`step-XXX-sound-manager`)

**Responsibility**: Sound cache loading, event sound playback.

**From index.js**: Lines 2453-2496

**New file**: `src/renderer/modules/SoundManager.js`

```js
// State: appState.soundCache
// Interface:
export class SoundManager {
  constructor(appState, api) { /* ... */ }
  async loadTheme(projectPath) { /* ... */ }
  playEventSound(eventName) { /* ... */ }
  init() { /* sets up hook event listener */ }
}
```

---

### Step L: Extract SessionManager (`step-XXX-session-manager`)

**Responsibility**: PTY lifecycle, terminal instances, xterm.js setup.

**From index.js**: Lines 385-615 (session creation), 520-570 (PTY callbacks), 609-615 (activation), 618-640 (close)

**New file**: `src/renderer/modules/SessionManager.js`

This is the largest extraction. It owns the core session lifecycle.

```js
// State: appState.sessions, appState.activeId
// Interface:
export class SessionManager {
  constructor(terminalsContainer, appState, api, deps) { /* ... */ }
  async createSession(type, options) { /* ... */ }
  activateSession(id) { /* ... */ }
  async closeSession(id) { /* ... */ }
  getActiveTerminal() { /* ... */ }
  refitAll() { /* ... */ }
  refitActive() { /* ... */ }
}
```

**deps**: `{ themeManager, fontSizeManager, tabManager, statusBar, soundManager, debugPane }` — receives other modules for coordination.

**Key detail**: xterm.js Terminal creation, FitAddon/SearchAddon/WebglAddon setup, PTY data/exit listeners, ResizeObserver — all move here.

---

### Step M: Extract SettingsUI (`step-XXX-settings-ui`)

**Responsibility**: Settings tab rendering, form inputs, sound theme config, audio trim UI.

**From index.js**: Lines 1314-2121

**New file**: `src/renderer/modules/SettingsUI.js`

This is the second-largest extraction (~800 lines). Includes the audio trim panel with WaveSurfer.

```js
// State: local closure state (activeSection, settingsScope, editGlobal, editProject, resolvedSoundMap)
// Interface:
export class SettingsUI {
  constructor(appState, api, deps) { /* ... */ }
  async open(sessionManager) { /* creates settings "session" */ }
  async renderSettingsTab(panelEl) { /* ... */ }
}
```

**Internal sub-modules** (if the file gets too long):
- `src/renderer/modules/settings/GeneralSettings.js`
- `src/renderer/modules/settings/SoundSettings.js`
- `src/renderer/modules/settings/AudioTrimUI.js`
- `src/renderer/modules/settings/AboutSection.js`

---

### Step N: Extract ProjectManager (`step-XXX-project-manager`)

**Responsibility**: Project list, selection, MRU tracking, activity badges.

**From index.js**: Lines 88-89, 229-377, 2622-2626

**New file**: `src/renderer/modules/ProjectManager.js`

```js
// State: appState.projects, appState.selectedProjectPath, appState.projectMRU, appState.projectActivity
// Interface:
export class ProjectManager {
  constructor(appState, api, sidebarManager) { /* ... */ }
  async refreshList() { /* ... */ }
  async addProject() { /* ... */ }
  async removeProject(path) { /* ... */ }
  selectProject(path) { /* ... */ }
  onProjectOpen(callback) { /* ... */ }
}
```

---

### Step O: Slim down index.js to orchestrator (`step-XXX-renderer-orchestrator`)

After all modules are extracted, `index.js` becomes a ~100-line orchestrator:

```js
// src/renderer/index.js — Application orchestrator
import { appState } from './state/AppState.js';
import { ThemeManager } from './modules/ThemeManager.js';
import { FontSizeManager } from './modules/FontSizeManager.js';
import { KeyboardShortcutManager } from './modules/KeyboardShortcutManager.js';
import { StatusBar } from './modules/StatusBar.js';
import { DebugPane } from './modules/DebugPane.js';
import { SidebarManager } from './modules/SidebarManager.js';
import { ModalManager } from './modules/ModalManager.js';
import { TabManager } from './modules/TabManager.js';
import { SoundManager } from './modules/SoundManager.js';
import { SessionManager } from './modules/SessionManager.js';
import { SettingsUI } from './modules/SettingsUI.js';
import { ProjectManager } from './modules/ProjectManager.js';

const api = window.electron_api;

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Initialize state from persisted values
  appState.sidebarWidth = await api.windowState.getSidebarWidth();
  appState.sidebarMode = await api.windowState.getSidebarMode();
  // ... etc

  // 2. Create modules
  const themeManager = new ThemeManager(appState, api);
  const fontSizeManager = new FontSizeManager(appState, api);
  const keyboard = new KeyboardShortcutManager(DEFAULT_KEYBINDINGS);
  const statusBar = new StatusBar(/* DOM refs */);
  const debugPane = new DebugPane(/* DOM refs */, appState, api);
  const tabManager = new TabManager(/* DOM refs */, appState, api, { /* callbacks */ });
  const soundManager = new SoundManager(appState, api);
  const sessionManager = new SessionManager(/* DOM refs */, appState, api, { /* deps */ });
  const settingsUI = new SettingsUI(appState, api, { /* deps */ });
  const sidebarManager = new SidebarManager(/* DOM refs */, appState, api, { /* callbacks */ });
  const modalManager = new ModalManager(appState, keyboard, { /* callbacks */ });
  const projectManager = new ProjectManager(appState, api, sidebarManager);

  // 3. Register keyboard actions
  keyboard.registerAction('new-claude-session', () => sessionManager.createSession('claude'));
  keyboard.registerAction('new-terminal-session', () => sessionManager.createSession('terminal'));
  // ... etc

  // 4. Apply initial theme
  themeManager.apply();

  // 5. Load projects
  await projectManager.refreshList();

  // 6. Init sound
  soundManager.init();
});
```

---

## Module Communication Strategy

Since we're not using a framework, modules communicate via:

1. **Shared AppState** — modules read/write `appState` directly for shared state
2. **Callbacks** — passed at construction for cross-module actions (e.g., `onTabClosed` triggers `sessionManager.closeSession`)
3. **Direct method calls** — modules receive references to other modules they depend on (e.g., `SessionManager` receives `tabManager` to create tabs)
4. **IPC** — `api` object passed to all modules for main process communication

**No event bus needed** at this scale. The callback pattern keeps dependencies explicit and traceable.

---

## esbuild Considerations

The current esbuild config bundles `src/renderer/index.js` as the entry point. With the module extraction:

- All new modules under `src/renderer/` will be bundled automatically via imports
- Use ES module syntax (`import`/`export`) in renderer code — esbuild handles this
- No changes to esbuild config needed (it follows the import graph from the entry point)
- `src/renderer/utils/` and `src/renderer/modules/` directories are purely organizational

---

## Recommended Implementation Order

| Step | Module | Lines Moved | Risk | Dependencies |
|------|--------|-------------|------|-------------|
| A | Shared utilities | ~150 | Low | None |
| B | AppState | ~50 new + mechanical find-replace | Low | Utilities |
| C | ThemeManager | ~50 | Low | AppState |
| D | FontSizeManager | ~25 | Low | AppState |
| E | KeyboardShortcutManager | ~80 | Low | None |
| F | StatusBar | ~70 | Low | AppState |
| G | DebugPane | ~120 | Low | AppState, drag-resize util |
| H | SidebarManager | ~250 | Medium | AppState, drag-resize util |
| I | ModalManager | ~250 | Medium | AppState, overlay utils |
| J | TabManager | ~200 | Medium | AppState |
| K | SoundManager | ~50 | Low | AppState |
| L | SessionManager | ~300 | High | AppState, TabManager, ThemeManager, FontSizeManager |
| M | SettingsUI | ~800 | High | AppState, SoundManager |
| N | ProjectManager | ~150 | Medium | AppState, SidebarManager |
| O | Final orchestrator cleanup | index.js shrinks to ~100 | Medium | All modules |

**Total**: ~15 steps, each a separate branch. The first ~7 are low-risk mechanical extractions. The last ~8 involve more complex module boundary decisions.

---

## Key Principles

1. **One module per step** — never extract two modules in the same branch
2. **Tests pass at every step** — run full Playwright suite after each extraction
3. **No behavior changes** — pure structural refactoring; no new features, no bug fixes
4. **Keep index.js working** — during extraction, index.js imports the new module and delegates to it; old code is deleted
5. **No framework adoption** — vanilla JS classes and functions, no reactive state library
6. **Callback-based communication** — explicit dependencies, no global event bus

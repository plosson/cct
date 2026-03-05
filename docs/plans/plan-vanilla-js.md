# Renderer Refactoring Plan -- Vanilla JS

## Current State Analysis

### File Inventory

The renderer layer consists of exactly **2 source files**:

| File | Lines | Role |
|------|-------|------|
| `src/renderer/index.js` | 2,865 | Entire renderer: init, sessions, tabs, sidebar, search, settings, debug pane, keybindings, sound/trim UI, status bar, resize handles, overlays, test helpers |
| `src/renderer/projectColors.js` | 39 | Deterministic color palette per project name |

Supporting files:

| File | Lines | Role |
|------|-------|------|
| `src/main/preload.js` | 115 | Context bridge exposing IPC API (`window.electron_api`) |
| `index.html` | 82 | Static shell: titlebar, sidebar, empty state, debug pane, status bar |
| `styles/base.css` | 1,544 | All styling (theme tokens, layout, components, animations) |
| `scripts/build-renderer.js` | 20 | esbuild: `src/renderer/index.js` -> `dist/renderer.bundle.js` (IIFE) |

### What `index.js` Contains (by section)

The file is a single monolithic module with the following logical sections, identified by comment headers:

1. **Imports and globals** (lines 1-88): xterm.js + addons, WaveSurfer, global state (`sessions` Map, `activeId`, `selectedProjectPath`, `projectMRU`, `projectActivity`, `keybindings`, `actions`, DOM element references, `projects` array).

2. **Theme helpers** (lines 89-145): Dark/light terminal theme objects, `getCurrentThemeMode()`, `getTerminalTheme()`, `applyThemeSetting()`, `TERMINAL_OPTIONS`.

3. **General helpers** (lines 147-243): `getActiveSession()`, `refocusTerminal()`, `showPromptOverlay()` (custom modal), `updateAppGlow()`.

4. **Empty state** (lines 245-290): `getEmptyStateMessage()`, `updateEmptyState()` -- manages the "no sessions" placeholder.

5. **Sidebar** (lines 292-436): `renderSidebar()`, `updateProjectActivityBadge()`, `selectProject()`, `sessionsForProject()`, `countSessionsForProject()`, `refreshProjectList()`, `addProject()`, `removeProject()`.

6. **Sessions / Tabs** (lines 438-743): `createSession()` (200+ lines -- creates xterm Terminal, addons, DOM, IPC wiring, resize observer, cleanup), `activateTab()`, `closeTab()`, `restoreSessions()`, `cycleProject()`, `cycleTab()`, `goToTab()`.

7. **Project Picker overlay** (lines 745-855): `openProjectPicker()`, `closeProjectPicker()`, `renderPickerList()`.

8. **Tab drag helpers** (lines 857-863): `clearDropIndicators()`.

9. **Tab rename** (lines 865-912): `startTabRename()`.

10. **Tab context menu** (lines 914-961): `showTabContextMenu()`, `closeOtherTabs()`, `closeAllTabs()`.

11. **Project context menu** (lines 963-990): `showProjectContextMenu()`.

12. **Terminal search** (lines 992-1084): `openSearchBar()`, `focusSearchBar()`, `closeSearchBar()`.

13. **Font size zoom** (lines 1086-1107): `setFontSize()`, `zoomIn()`, `zoomOut()`, `zoomReset()`.

14. **Clear terminal** (lines 1109-1115): `clearTerminal()`.

15. **Clipboard** (lines 1117-1134): `copySelection()`, `pasteClipboard()`.

16. **Sidebar auto-hide** (lines 1136-1215): `toggleSidebar()`, `revealSidebar()`, `scheduleSidebarHide()`, `hideSidebar()`, `initSidebarAutoHide()`.

17. **Select all** (lines 1217-1223): `selectAll()`.

18. **Move tab** (lines 1225-1263): `moveTab()`.

19. **Shortcut help overlay** (lines 1265-1370): `ACTION_LABELS`, `formatKeyCombo()`, `showShortcutHelp()`, `closeShortcutHelp()`.

20. **Settings tab** (lines 1372-2089): `openSettings()`, `renderSettingsTab()` (~650 lines including `renderGeneralSection()`, `renderSoundsSection()`, `renderAboutSection()` as nested functions).

21. **Audio Trim UI** (lines 2091-2282): `openTrimUI()` (~190 lines, builds waveform editor with WaveSurfer).

22. **Status bar** (lines 2284-2353): `updateStatusBar()`, `formatUptime()`, `startUptimeTimer()`, `stopUptimeTimer()`.

23. **Sidebar resize** (lines 2355-2405): `initSidebarResize()`.

24. **Debug pane** (lines 2407-2528): `toggleDebugPane()`, `initDebugPaneResize()`, debug entry rendering, `clearDebugPane()`.

25. **Test helpers** (lines 2530-2599): ~20 `window._claudiu*` functions exposed for Playwright tests.

26. **Keybindings** (lines 2601-2611): `normalizeKeyEvent()`.

27. **Sound theme** (lines 2613-2656): `soundCache`, `loadSoundTheme()`, `playEventSound()`, `initSoundTheme()`.

28. **Init** (lines 2658-2865): `init()` -- ~200 lines wiring everything together: DOM queries, state restoration, event listeners, action registration.

### Architectural Pain Points

1. **God file**: 2,865 lines in a single file with ~28 logical sections. Every feature is a flat function in the same scope. There is no separation of concerns.

2. **Shared mutable state**: 15+ module-level `let` variables (`activeId`, `selectedProjectPath`, `sessions`, `projects`, `sidebarMode`, `sidebarRevealed`, `currentFontSize`, `searchBarEl`, `pickerOverlay`, `shortcutHelpOverlay`, `debugPaneOpen`, `debugPaneHeight`, `debugAutoScroll`, `uptimeInterval`, `soundCache`, etc.) are freely read and mutated from any function. There is no encapsulation.

3. **Tight coupling**: Sidebar rendering calls `updateEmptyState()`. `selectProject()` calls `activateTab()`, `renderSidebar()`, `updateStatusBar()`, `updateAppGlow()`, and `restoreSessions()`. `createSession()` calls `activateTab()` which calls `updateStatusBar()`. Every feature reaches into every other feature's state.

4. **Inline DOM construction**: Major UI features (settings, project picker, search bar, shortcut help, trim UI, prompt overlay) build their entire DOM imperatively with `createElement`/`innerHTML` chains. These are effectively "components" but with no reusable structure.

5. **No event bus / pub-sub**: Features communicate through direct function calls. When a tab is activated, 4-5 side effects fire synchronously. There is no way to add a new listener without editing existing functions.

6. **Test helpers baked into production code**: ~70 lines of `window._claudiu*` test hooks are shipped in the production bundle. They expose internal state (sessions map, project list, tab order) and allow mutation (close tabs, select projects, reload projects).

7. **Settings is enormous**: `renderSettingsTab()` alone is ~650 lines. It contains 3 nested section renderers, theme management logic, sound upload/remove/trim orchestration, and save logic -- all in a single closure.

8. **`createSession()` does too much**: ~200 lines that create DOM, instantiate xterm + 4 addons, set up IPC, scrollbar hacking, resize observer, drag/drop, activity tracking, bell handling, and register cleanup. It is the hardest function to understand and modify.

9. **No lifecycle management**: Overlays (project picker, shortcut help, prompt, search bar) each manage their own open/close state with separate module-level variables and nearly identical backdrop-click-to-close logic.

10. **esbuild bundles a single entry point**: The build produces one IIFE. Splitting into modules will work seamlessly because esbuild handles ES module imports within a single bundle.

---

## Test Suite Analysis

### Structure

- **40 test files** (`tests/step-001-skeleton.spec.js` through `tests/step-047-sound-theme-ops.spec.js`), totaling ~6,100 lines (excluding helpers).
- Tests are **end-to-end Playwright Electron tests**. Each file launches the full Electron app, interacts via the rendered UI, and asserts on DOM state.
- There are **zero unit tests**. Every test requires a full app launch with a real PTY.
- `tests/helpers.js` provides `launchEnv()` (temp userData dir) and `showWindow()`.

### What Is Tested

| Area | Test Files | Coverage Level |
|------|-----------|---------------|
| App launch, security, preload | 001, 002 | Basic |
| Terminal + PTY | 003, 004 | Functional |
| Tabs (create, switch, close, state) | 005 | Good |
| Sidebar projects (add, remove, select, multi-project) | 006 | Thorough (667 lines) |
| Window state persistence (size, position) | 007 | Good |
| Sidebar resize | 008 | Good |
| Status bar | 009 | Good |
| Terminal search | 010 | Good |
| Tab context menu | 011 | Good |
| Tab drag reorder | 012 | Good |
| Tab rename | 013 | Good |
| Font zoom | 014 | Good |
| Tab activity indicator | 015 | Good |
| Close confirmation (beforeunload) | 016 | Basic |
| Shortcut help overlay | 017 | Good |
| Tab number shortcuts (Cmd+1-9) | 018 | Good |
| Project activity indicator | 019 | Good |
| Duplicate tab | 020 | Basic |
| Terminal bell | 021 | Basic |
| Clear terminal | 022 | Good |
| Clipboard (copy/paste) | 023 | Good |
| Move tab left/right | 024 | Good |
| Session uptime | 025 | Good |
| Select all | 026 | Good |
| Toggle sidebar | 027 | Good |
| Project context menu | 028 | Basic |
| Terminal links | 029 | Good |
| App version display | 030 | Basic |
| Close others shortcut | 031 | Good |
| Project identity (colors, glow) | 032 | Good |
| Configuration (settings UI) | 033 | Thorough (254 lines) |
| CLI invocation | 034 | Good |
| Debug pane | 035 | Good |
| npm start with project arg | 036 | Basic |
| Dark theme | 037 | Basic |
| Sound themes (cow themes) | 045 | Thorough (305 lines) |
| Duplicate theme | 046 | Good |
| Sound theme operations | 047 | Very thorough (594 lines) |

### Coverage Gaps

1. **No unit tests at all**: Every test is a full E2E Playwright test. Functions like `formatUptime()`, `normalizeKeyEvent()`, `formatKeyCombo()`, `getProjectColor()`, `getEmptyStateMessage()` are pure functions that should have fast unit tests but do not.

2. **Session restore logic** (`restoreSessions()`) is not directly tested.

3. **Sidebar auto-hide mouse interactions** (hover trigger zone, reveal/hide) are only lightly covered in step-027.

4. **Audio trim UI** (`openTrimUI()` with WaveSurfer) has no dedicated test.

5. **Prompt overlay** (`showPromptOverlay()`) is tested implicitly through sound theme tests but has no isolated test.

6. **Updater banner** (update-available notification) is not tested.

7. **OS theme change listener** (system dark/light mode switching at runtime) is not tested.

8. **Error paths** are generally untested (what happens when `api.terminal.create()` fails, when `api.projects.add()` returns null, etc.).

### Test Organization Issues

1. **Each test file launches a separate Electron app**: This is correct for isolation but makes the full suite slow. A refactored renderer with unit-testable modules could run hundreds of tests in seconds.

2. **Boilerplate duplication**: Nearly identical `beforeAll`/`afterAll` blocks (launch app, create temp project, select project, create session) are repeated across ~30 test files.

3. **Sequential numbering**: Tests are numbered by implementation step (001-047), not by feature area. This makes it hard to find all tab-related tests or all sidebar tests.

4. **Test helpers in production code**: The `window._claudiu*` bridge functions (lines 2530-2599) exist solely for tests. In a refactored architecture, proper module exports would eliminate this need.

---

## Proposed Architecture

### Guiding Principles

- **Plain vanilla JS** -- no framework, no build-time transforms beyond esbuild bundling.
- **ES modules** -- each module is a `.js` file with `export`/`import`. esbuild bundles them into a single IIFE.
- **Explicit dependencies** -- each module imports what it needs. No implicit globals.
- **Central state** -- one `AppState` module owns shared state. Other modules read/write through it.
- **Event bus** -- a lightweight pub/sub allows modules to react to state changes without direct coupling.
- **Max 10 modules** -- keeps the architecture simple enough to hold in your head.

### Proposed File Structure

```
src/renderer/
  index.js              # Entry point: imports all modules, calls init()
  state.js              # AppState: sessions, projects, activeId, selectedProjectPath
  events.js             # EventBus: publish/subscribe for cross-module communication
  terminal.js           # Terminal lifecycle: create, activate, close, resize, addons
  tabs.js               # Tab bar: rendering, drag/drop, rename, context menu, move
  sidebar.js            # Sidebar: render, select project, add/remove, resize, auto-hide
  overlays.js           # Overlays: project picker, shortcut help, prompt, search bar
  settings.js           # Settings tab: general, sounds, about sections, trim UI
  keybindings.js        # Keybinding map, action registry, keyboard dispatch
  statusbar.js          # Status bar: project, session type, uptime, terminal size
  projectColors.js      # (unchanged) Deterministic color palette
```

---

## Module Breakdown

### 1. `events.js` -- Event Bus

**Responsibility**: Lightweight publish/subscribe for decoupled cross-module communication.

**What moves here**: New code. Currently, cross-feature communication is done through direct function calls (e.g., `activateTab()` directly calls `updateStatusBar()`, `renderSidebar()`, etc.). The event bus replaces these hard-wired call chains.

**Public API**:
```js
export function on(event, handler)      // Returns unsubscribe function
export function emit(event, data)       // Synchronous broadcast
export function off(event, handler)     // Manual unsubscribe
```

**Key events**:
- `session:created`, `session:activated`, `session:closed`
- `project:selected`, `project:added`, `project:removed`, `project:list-changed`
- `theme:changed`
- `font:changed`

**Dependencies**: None (foundational module).

---

### 2. `state.js` -- Application State

**Responsibility**: Owns all shared mutable state. Provides getters and controlled mutators. Emits events on state changes.

**What moves here**:
- `sessions` Map (line 20)
- `activeId` (line 21)
- `selectedProjectPath` (line 22)
- `projectMRU` array (line 24)
- `projectActivity` Set (line 30)
- `projects` array (line 87)
- `currentFontSize` (line 1091)
- `sidebarMode`, `sidebarRevealed`, `sidebarWidth` (lines 1138-1141)
- `debugPaneOpen`, `debugPaneHeight` (lines 83-84)
- Helper functions: `getActiveSession()`, `sessionsForProject()`, `countSessionsForProject()`, `refreshProjectList()`

**Public API**:
```js
// Session state
export function getSession(id)
export function getAllSessions()
export function setSession(id, session)
export function deleteSession(id)
export function getActiveId()
export function setActiveId(id)
export function getActiveSession()
export function sessionsForProject(path)
export function countSessionsForProject(path)

// Project state
export function getProjects()
export function getSelectedProjectPath()
export function setSelectedProjectPath(path)
export function getProjectMRU()
export function updateMRU(path)
export function getProjectActivity()
export function addProjectActivity(path)
export function clearProjectActivity(path)

// UI state
export function getFontSize() / setFontSize(size)
export function getSidebarMode() / setSidebarMode(mode)
export function getSidebarWidth() / setSidebarWidth(w)
export function getDebugPaneOpen() / setDebugPaneOpen(open)
export function getDebugPaneHeight() / setDebugPaneHeight(h)
```

**Dependencies**: `events.js` (emits state change events).

---

### 3. `terminal.js` -- Terminal Lifecycle

**Responsibility**: Creating xterm.js Terminal instances, attaching addons, wiring IPC data flow, managing resize, and teardown. This is the core PTY-to-xterm bridge.

**What moves here**:
- `createSession()` (lines 444-643) -- the biggest function in the file
- `activateTab()` (lines 646-673) -- terminal-specific parts (fit, resize, focus)
- `closeTab()` (lines 676-698) -- terminal teardown
- `restoreSessions()` (lines 704-716)
- `TERMINAL_OPTIONS` (lines 139-145)
- Theme constants (`DARK_TERMINAL_THEME`, `LIGHT_TERMINAL_THEME`) and `getTerminalTheme()`, `applyThemeSetting()` (lines 91-137)
- Font size: `setFontSize()`, `zoomIn()`, `zoomOut()`, `zoomReset()` (lines 1086-1107)
- `clearTerminal()` (lines 1111-1115)
- `copySelection()`, `pasteClipboard()` (lines 1119-1134)
- `selectAll()` (lines 1219-1223)
- Sound theme: `soundCache`, `loadSoundTheme()`, `playEventSound()`, `initSoundTheme()` (lines 2613-2656)

**Public API**:
```js
export async function createSession(type, options)
export function activateSession(id)
export function closeSession(id)
export async function restoreSessions(projectPath)
export function setFontSize(size)
export function zoomIn() / zoomOut() / zoomReset()
export function clearTerminal()
export function copySelection()
export function pasteClipboard()
export function selectAll()
export function applyThemeSetting(theme)
export function getTerminalTheme()
export async function loadSoundTheme()
```

**Dependencies**: `state.js`, `events.js`, `projectColors.js`, preload API (`window.electron_api`).

---

### 4. `tabs.js` -- Tab Bar Management

**Responsibility**: Tab DOM rendering, visual state (active, activity, bell), drag-and-drop reordering, tab rename, tab context menu, move tab left/right, close-others/close-all.

**What moves here**:
- Tab DOM creation (currently inline in `createSession()`, lines 500-576)
- Tab event listeners: click-to-activate, close button, drag/drop, double-click rename
- `startTabRename()` (lines 867-912)
- `showTabContextMenu()` (lines 916-946)
- `closeOtherTabs()` (lines 948-956)
- `closeAllTabs()` (lines 958-961)
- `clearDropIndicators()` (lines 859-863)
- `moveTab()` (lines 1227-1263)
- `cycleTab()` (lines 727-734)
- `goToTab()` (lines 737-743)
- Tab activity tracking (currently in `createSession()`'s `onData` handler, lines 583-595)
- Bell handler (lines 602-607)

**Public API**:
```js
export function createTabElement(id, session, project)
export function activateTabUI(id)
export function removeTab(id)
export function cycleTab(direction)
export function goToTab(n)
export function moveTab(direction)
export function closeOtherTabs(keepId)
export function closeAllTabs(projectPath)
export function showTabsForProject(projectPath)
export function hideTabsForProject(projectPath)
```

**Dependencies**: `state.js`, `events.js`, preload API (for context menu).

---

### 5. `sidebar.js` -- Sidebar & Project Management

**Responsibility**: Sidebar rendering, project selection, add/remove projects, sidebar resize, auto-hide (dock mode), project activity badges, empty state.

**What moves here**:
- `renderSidebar()` (lines 294-338)
- `updateProjectActivityBadge()` (lines 340-344)
- `selectProject()` (lines 346-381)
- `addProject()` (lines 405-412)
- `removeProject()` (lines 414-436)
- `cycleProject()` (lines 719-724)
- Empty state: `getEmptyStateMessage()`, `updateEmptyState()` (lines 247-290)
- Auto-hide: `toggleSidebar()`, `revealSidebar()`, `scheduleSidebarHide()`, `hideSidebar()`, `initSidebarAutoHide()` (lines 1136-1215)
- Sidebar resize: `initSidebarResize()` (lines 2357-2405)
- Project context menu: `showProjectContextMenu()` (lines 965-990)
- App glow: `updateAppGlow()` (lines 230-243)

**Public API**:
```js
export function renderSidebar()
export function selectProject(path)
export function addProject()
export function removeProject(path)
export function cycleProject(direction)
export function toggleSidebar()
export function initSidebarResize()
export function initSidebarAutoHide()
export function updateEmptyState()
```

**Dependencies**: `state.js`, `events.js`, `projectColors.js`, preload API.

---

### 6. `overlays.js` -- Overlay / Modal UI

**Responsibility**: All overlay UIs that float above the main content: project picker, shortcut help, prompt dialog, and terminal search bar.

**What moves here**:
- Project picker: `openProjectPicker()`, `closeProjectPicker()`, `renderPickerList()` (lines 745-855)
- Shortcut help: `showShortcutHelp()`, `closeShortcutHelp()`, `ACTION_LABELS`, `formatKeyCombo()` (lines 1265-1370)
- Prompt overlay: `showPromptOverlay()` (lines 160-227)
- Search bar: `openSearchBar()`, `focusSearchBar()`, `closeSearchBar()` (lines 992-1084)
- `refocusTerminal()` (lines 155-158) -- used by overlay close handlers

**Public API**:
```js
export function openProjectPicker()
export function closeProjectPicker()
export function showShortcutHelp()
export function closeShortcutHelp()
export function showPromptOverlay(message, defaultValue)  // Returns Promise<string|null>
export function openSearchBar()
export function closeSearchBar()
export function refocusTerminal()
```

**Dependencies**: `state.js`, `events.js`, `keybindings.js` (for shortcut help labels), preload API.

---

### 7. `settings.js` -- Settings Tab

**Responsibility**: The entire settings pseudo-tab: scope toggle, general section, sound & hooks section (theme selector, event table, upload, trim), about section.

**What moves here**:
- `findSettingsTab()` (lines 1393-1398)
- `openSettings()` (lines 1401-1442)
- `renderSettingsTab()` and its 3 nested section renderers (lines 1444-2089): `renderGeneralSection()`, `renderSoundsSection()`, `renderAboutSection()`
- `openTrimUI()` (lines 2097-2282) -- WaveSurfer waveform trimmer
- `ALL_HOOK_EVENTS` constant (lines 1378-1387)
- `settingsIdCounter` (line 1375)

**Public API**:
```js
export function openSettings()
export function findSettingsTab()
```

**Dependencies**: `state.js`, `events.js`, `overlays.js` (for `showPromptOverlay()`), `terminal.js` (for `loadSoundTheme()`, `applyThemeSetting()`), preload API.

---

### 8. `keybindings.js` -- Keyboard Shortcuts

**Responsibility**: Keybinding map, action registry, keyboard event normalization, and dispatch.

**What moves here**:
- `DEFAULT_KEYBINDINGS` (lines 33-67)
- `keybindings` (line 69)
- `actions` Map (line 71)
- `normalizeKeyEvent()` (lines 2603-2611)
- Keyboard dispatch listener (lines 2833-2841)
- Action registration (currently in `init()`, lines 2800-2830)

**Public API**:
```js
export function registerAction(name, handler)
export function getKeybindings()
export function getActionLabels()
export function normalizeKeyEvent(e)
export function initKeyboardDispatch()
```

**Dependencies**: None (other modules register their actions into this module).

---

### 9. `statusbar.js` -- Status Bar

**Responsibility**: Rendering and updating the bottom status bar (project name, session type, uptime timer, terminal size, version).

**What moves here**:
- `updateStatusBar()` (lines 2304-2336)
- `formatUptime()` (lines 2293-2302)
- `startUptimeTimer()`, `stopUptimeTimer()` (lines 2338-2353)
- Status bar DOM element references (lines 2287-2291)
- Version display initialization (lines 2678-2681)

**Public API**:
```js
export function initStatusBar()
export function updateStatusBar()
```

**Dependencies**: `state.js`, `events.js` (listens for `session:activated`, `session:closed`, `project:selected`), preload API.

---

### 10. `debugpane.js` -- Debug Pane

**Responsibility**: Debug log pane: toggle, resize, entry rendering, auto-scroll, clear.

**What moves here**:
- `toggleDebugPane()` (lines 2409-2428)
- `initDebugPaneResize()` (lines 2432-2475)
- `addDebugEntry()` (lines 2486-2513)
- `updateDebugPaneCount()` (lines 2515-2520)
- `clearDebugPane()` (lines 2522-2528)
- `formatLogTime()` (lines 2481-2484)
- `debugAutoScroll` state (line 2479)
- Debug pane DOM element references

**Public API**:
```js
export function initDebugPane()
export function toggleDebugPane()
export function addDebugEntry(entry)
```

**Dependencies**: `state.js`, `events.js`, preload API.

---

### Module Dependency Graph

```
                 events.js (no deps)
                     |
                 state.js
                /    |    \
               /     |     \
    terminal.js  tabs.js  sidebar.js    keybindings.js (no deps)
         |          |          |              |
         +----+-----+----+----+----+---------+
              |          |         |
          overlays.js  settings.js  statusbar.js  debugpane.js
              |          |
              +---+------+
                  |
              index.js (entry point: wires everything together)
```

`projectColors.js` remains standalone, imported by `terminal.js` and `sidebar.js`.

---

## Migration Strategy

### Phase 0: Preparation

1. **Add the event bus** (`events.js`) as a new file. No existing code changes.
2. **Add the state module** (`state.js`), initially importing/re-exporting the same variables from `index.js`. Use this as a bridge.
3. **Update `scripts/build-renderer.js`**: No changes needed -- esbuild already resolves ES module imports.

### Phase 1: Extract Foundational Modules (Low Risk)

Extract modules that have **no dependents** first:

1. **`keybindings.js`**: Extract `DEFAULT_KEYBINDINGS`, `normalizeKeyEvent()`, action registry. In `index.js`, import and call `initKeyboardDispatch()`. Tests unaffected (they press keys on the real app).

2. **`statusbar.js`**: Extract status bar functions. Subscribe to events from `state.js`. Wire up in `init()`.

3. **`debugpane.js`**: Extract debug pane functions. Wire up in `init()`.

### Phase 2: Extract Feature Modules (Medium Risk)

4. **`overlays.js`**: Extract project picker, search bar, shortcut help, prompt overlay. These are self-contained UI features with clear open/close lifecycle.

5. **`sidebar.js`**: Extract sidebar rendering, project management, resize, auto-hide. This touches `selectProject()` which is a central orchestration point -- it should emit a `project:selected` event instead of directly calling 5 other functions.

6. **`tabs.js`**: Extract tab bar DOM, drag/drop, rename, context menu. The tab creation is currently embedded in `createSession()` -- it needs to be pulled out into a `createTabElement()` function that `terminal.js` calls.

### Phase 3: Extract Heavy Modules (Higher Risk)

7. **`settings.js`**: Extract the 650-line settings tab. This is the largest single feature and benefits most from isolation. Depends on `overlays.js` for prompt dialogs.

8. **`terminal.js`**: Extract session/terminal lifecycle. This is the most coupled module -- it creates sessions, manages xterm instances, handles IPC data flow, and currently builds tab DOM. After `tabs.js` is extracted, this becomes cleaner.

### Phase 4: Refactor `index.js` into Entry Point

9. **Slim down `index.js`** to just:
   - Import all modules
   - `init()` function that: queries DOM, restores persisted state, registers keybinding actions, calls each module's init function
   - Test helper exports (or move to a `testHelpers.js` that is conditionally included)

### Phase 5: Test Improvements (Optional Follow-up)

10. **Add unit tests** for pure functions: `formatUptime()`, `formatKeyCombo()`, `normalizeKeyEvent()`, `getProjectColor()`, `getEmptyStateMessage()`, `formatLogTime()`.
11. **Extract test helpers** from production code into a test-only module (conditionally loaded or stripped in production builds).
12. **Consolidate test boilerplate**: Create shared setup functions to reduce the ~30 nearly-identical `beforeAll` blocks.

### Migration Rules

- **One module per PR**: Extract one module at a time. Run the full E2E test suite after each extraction.
- **No behavior changes**: Each extraction should be a pure refactor. The app should behave identically.
- **Preserve `window._claudiu*` hooks**: Test helpers must continue to work. They can import from the new modules instead of reaching into `index.js` closures.
- **CSS stays monolithic for now**: `base.css` is not part of this refactoring. It can be split later if desired, but CSS does not suffer from the same coupling issues as JS.

---

## Benefits

### Immediate

1. **Readability**: Each file is 100-400 lines instead of one 2,865-line file. A developer can understand the settings system without scrolling past terminal lifecycle code.

2. **Navigability**: Finding "where is tab rename handled?" becomes "open `tabs.js`" instead of "search for `startTabRename` in the 2,865-line file."

3. **Reduced merge conflicts**: Two developers working on sidebar and settings will edit different files.

4. **Encapsulated state**: Modules can only access shared state through `state.js` getters/setters, making it possible to reason about who changes what.

### Architectural

5. **Decoupled features via event bus**: Adding a new feature that reacts to tab changes (e.g., breadcrumbs, session logging) requires only subscribing to `session:activated` -- no modification of existing code.

6. **Testable units**: Pure functions (`formatUptime`, `normalizeKeyEvent`, `getProjectColor`) and state logic can be unit-tested without launching Electron. This could cut test time from minutes to seconds for logic tests.

7. **Swappable modules**: The settings tab or debug pane could be replaced or disabled without touching terminal or sidebar code.

8. **Clear dependency direction**: The dependency graph flows one way (foundational -> features -> entry point). No circular dependencies.

### Practical

9. **Easier onboarding**: A new contributor can understand the architecture from the file list alone. Each file has a single responsibility stated in its header comment.

10. **Incremental migration**: The phased approach means the app stays functional throughout. Each PR is independently reviewable and testable.

11. **Production bundle unchanged**: esbuild still produces a single `renderer.bundle.js` IIFE. No runtime cost from the refactoring. No new dependencies.

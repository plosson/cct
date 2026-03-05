# Renderer Extraction — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split `src/renderer/index.js` (2,865 lines) into 7 focused modules while keeping all 40 E2E tests passing.

**Architecture:** Extract code into ES modules with direct imports (no event bus, no state wrapper). esbuild already handles ES module imports within the IIFE bundle. Each module owns its state and exports functions for others to call.

**Tech Stack:** Vanilla JS, ES modules, esbuild bundler, Playwright E2E tests.

**Test command:** `npm test` (builds renderer then runs Playwright)
**Quick build check:** `npm run build:renderer` (verifies esbuild can bundle without errors)

---

### Task 1: Extract `settings.js`

The settings tab is ~715 lines (1372-2089 + trim UI 2091-2282), the biggest self-contained chunk. It only reaches into the rest of the code for `showPromptOverlay`, `activateTab`, `closeTab`, `renderSidebar`, `loadSoundTheme`, `applyThemeSetting`, and shared state.

**Files:**
- Create: `src/renderer/settings.js`
- Modify: `src/renderer/index.js`

**Step 1: Create `src/renderer/settings.js`**

Cut these sections from `index.js` into the new file:
- Lines 1372-2282 (settings tab + trim UI) — everything from `// ── Settings tab` through the end of `openTrimUI()`

The new file needs these imports at the top:

```js
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
```

And these imports from index.js (temporarily — they'll move to proper modules in later tasks):

```js
import {
  sessions, activeId, selectedProjectPath, projects,
  activateTab, closeTab, renderSidebar, updateStatusBar,
  showPromptOverlay, loadSoundTheme, applyThemeSetting,
  sessionsForProject, countSessionsForProject, terminalsContainer, tabBarTabs,
} from './index.js';
```

Export:
```js
export { openSettings, findSettingsTab, ALL_HOOK_EVENTS, openTrimUI };
```

Note: `renderSettingsTab` does NOT need to be exported — it's only called inside `openSettings`.

**Step 2: Update `index.js`**

- Remove the cut sections (lines 1372-2282)
- Remove the `import WaveSurfer` and `import RegionsPlugin` lines (they're only used by settings/trim)
- Add `import { openSettings, findSettingsTab } from './settings.js';` near the top
- Add `export` keyword to everything `settings.js` imports:
  - `export const sessions`, `export let activeId`, `export let selectedProjectPath`, `export const projects`
  - `export function activateTab`, `export function closeTab`, `export function renderSidebar`, `export function updateStatusBar`
  - `export function showPromptOverlay`, `export async function loadSoundTheme`, `export function applyThemeSetting`
  - `export function sessionsForProject`, `export function countSessionsForProject`
  - `export let terminalsContainer`, `export let tabBarTabs`
- The `settingsIdCounter` variable only needs to be in settings.js (it's local state)

**Important detail:** `activeId` is reassigned with `=` in index.js, so it must be exported as a mutable binding. For settings.js to read the current value, either:
- Option A: Export a getter function `export function getActiveId() { return activeId; }` (cleanest)
- Option B: settings.js reads `sessions` and `activeId` through a getter

Use Option A: add `export function getActiveId() { return activeId; }` and `export function getSelectedProjectPath() { return selectedProjectPath; }` in index.js. Settings.js imports these getters instead of the `let` variables directly.

Also add `export function getTerminalsContainer() { return terminalsContainer; }` and `export function getTabBarTabs() { return tabBarTabs; }` since these are `let` assigned in `init()`.

**Step 3: Verify build**

Run: `npm run build:renderer`
Expected: Build succeeds with no errors.

**Step 4: Run tests**

Run: `npm test`
Expected: All 40 tests pass. Settings-related tests (step-033, step-045, step-046, step-047) are the critical ones.

**Step 5: Commit**

```bash
git add src/renderer/settings.js src/renderer/index.js
git commit -m "refactor: extract settings.js from renderer monolith (PR 1/6)"
```

---

### Task 2: Extract `overlays.js`

Overlays (~400 lines) + debug pane (~120 lines) = ~520 lines of self-contained UI features.

**Files:**
- Create: `src/renderer/overlays.js`
- Modify: `src/renderer/index.js`

**Step 1: Create `src/renderer/overlays.js`**

Cut these sections from `index.js`:
- `refocusTerminal()` (lines 155-158)
- `showPromptOverlay()` (lines 164-227)
- Project picker: `pickerOverlay`, `pickerSelectedIndex`, `pickerFilteredPaths` state + `openProjectPicker()`, `closeProjectPicker()`, `renderPickerList()` (lines 747-855)
- Search bar: `searchBarEl` state + `openSearchBar()`, `focusSearchBar()`, `closeSearchBar()` (lines 994-1084)
- Shortcut help: `ACTION_LABELS`, `formatKeyCombo()`, `shortcutHelpOverlay` state, `showShortcutHelp()`, `closeShortcutHelp()` (lines 1265-1370)
- Debug pane: all functions from `toggleDebugPane` through `clearDebugPane` (lines 2409-2528), plus `debugAutoScroll` (line 2479), `formatLogTime()` (lines 2481-2484)

Imports from index.js:

```js
import {
  getActiveId, getActiveSession, getSelectedProjectPath,
  sessions, projects, projectMRU,
  selectProject, keybindings, actions,
  terminalsContainer,
  // DOM refs needed by debug pane
  debugPaneEl, debugPaneEntriesEl, debugPaneCountEl, debugPaneResizeHandle,
  getDebugPaneOpen, setDebugPaneOpen, getDebugPaneHeight, setDebugPaneHeight,
} from './index.js';
```

Wait — the debug pane DOM refs (`debugPaneEl`, etc.) are `let` variables assigned in `init()`. Use getter functions like we did for `terminalsContainer`.

Export:
```js
export {
  refocusTerminal, showPromptOverlay,
  openProjectPicker, closeProjectPicker,
  openSearchBar, closeSearchBar,
  showShortcutHelp, closeShortcutHelp,
  ACTION_LABELS, formatKeyCombo,
  toggleDebugPane, initDebugPaneResize, addDebugEntry, clearDebugPane,
  updateDebugPaneCount,
};
```

**Step 2: Update `index.js`**

- Remove the cut sections
- Add `import { ... } from './overlays.js';`
- Export additional getter functions for DOM refs and debug state that `overlays.js` needs
- Update `settings.js` import: change `showPromptOverlay` import source from `'./index.js'` to `'./overlays.js'`

**Step 3: Verify build**

Run: `npm run build:renderer`
Expected: Build succeeds.

**Step 4: Run tests**

Run: `npm test`
Expected: All 40 tests pass. Key tests: step-010 (search), step-017 (shortcut help), step-035 (debug pane), step-045/46/47 (sounds — use prompt overlay).

**Step 5: Commit**

```bash
git add src/renderer/overlays.js src/renderer/settings.js src/renderer/index.js
git commit -m "refactor: extract overlays.js from renderer monolith (PR 2/6)"
```

---

### Task 3: Extract `sidebar.js`

Sidebar rendering, project management, resize, auto-hide, empty state, glow — ~400 lines.

**Files:**
- Create: `src/renderer/sidebar.js`
- Modify: `src/renderer/index.js`

**Step 1: Create `src/renderer/sidebar.js`**

Cut these sections:
- `getEmptyStateMessage()`, `updateEmptyState()` (lines 247-290)
- `renderSidebar()`, `updateProjectActivityBadge()`, `selectProject()`, `sessionsForProject()`, `countSessionsForProject()`, `refreshProjectList()`, `addProject()`, `removeProject()` (lines 294-436)
- `cycleProject()` (lines 719-724)
- `showProjectContextMenu()` (lines 965-990)
- Sidebar auto-hide state + functions (lines 1138-1215)
- `initSidebarResize()` (lines 2357-2405)
- `updateAppGlow()` (lines 230-243)

State owned by sidebar.js:
- `selectedProjectPath`, `projectMRU`, `projectActivity`, `projects`
- `sidebarMode`, `sidebarRevealed`, `sidebarHideTimeout`, `sidebarWidth`

Imports from index.js:
```js
import {
  sessions, getActiveId, setActiveId,
  activateTab, closeTab, restoreSessions, updateStatusBar,
  // DOM refs
  getSidebarProjectsEl, getSidebarEl, getEmptyStateEl,
} from './index.js';
import { getProjectColor } from './projectColors.js';
import { openSettings } from './settings.js';
```

Exports: everything listed in the design doc's sidebar exports.

**Step 2: Update `index.js`**

- Remove cut sections
- Import from sidebar.js
- Remove `selectedProjectPath`, `projects`, `projectMRU`, `projectActivity` declarations
- Add `export function setActiveId(id) { activeId = id; }` (sidebar's `selectProject` sets `activeId = null`)
- Export DOM ref getters for `sidebarProjectsEl`, `sidebarEl`, `emptyStateEl`
- Update `settings.js` and `overlays.js` imports: redirect `selectedProjectPath`, `projects`, `projectMRU`, `sessionsForProject`, `countSessionsForProject`, `selectProject` to `'./sidebar.js'`

**Step 3: Verify build**

Run: `npm run build:renderer`

**Step 4: Run tests**

Run: `npm test`
Expected: All 40 pass. Key tests: step-006 (sidebar projects), step-008 (sidebar resize), step-027 (toggle sidebar), step-028 (project context menu), step-032 (project identity).

**Step 5: Commit**

```bash
git add src/renderer/sidebar.js src/renderer/overlays.js src/renderer/settings.js src/renderer/index.js
git commit -m "refactor: extract sidebar.js from renderer monolith (PR 3/6)"
```

---

### Task 4: Extract `tabs.js`

Tab bar management — ~300 lines. Main challenge: untangling tab DOM creation from `createSession()`.

**Files:**
- Create: `src/renderer/tabs.js`
- Modify: `src/renderer/index.js`

**Step 1: Create `src/renderer/tabs.js`**

Cut and restructure:
- Extract tab DOM creation from `createSession()` (lines 496-576) into a new `createTabElement(id, session, project)` function
- `clearDropIndicators()` (lines 859-863)
- `startTabRename()` (lines 867-912)
- `showTabContextMenu()` (lines 916-946)
- `closeOtherTabs()` (lines 948-956)
- `closeAllTabs()` (lines 958-961)
- `cycleTab()` (lines 727-734)
- `goToTab()` (lines 737-743)
- `moveTab()` (lines 1227-1263)

For tab activity and bell handlers (lines 583-607): these fire from `terminal.onData`/`terminal.onBell` which stay in `createSession()`. However, the *visual* updates (`tabEl.classList.add('tab-activity')`, etc.) can stay inline in `createSession()` since they're just 2-line class toggling. No need to extract these.

The `createTabElement` function:
- Takes `id`, `project` (name, color), `type` ('claude'|'terminal'), `num`, and callbacks `{ onActivate, onClose }`
- Returns the `tabEl` DOM element
- Wires up: click, double-click rename, context menu, drag/drop, close button
- `draggedTabId` state moves here

State owned:
- `draggedTabId`

Imports:
```js
import {
  sessions, getActiveId,
  activateTab, closeTab, createSession,
  getTabBarTabs,
} from './index.js';
import {
  sessionsForProject, selectedProjectPath,
} from './sidebar.js';
```

**Step 2: Update `index.js`**

- In `createSession()`: replace inline tab DOM creation (lines 496-576) with a call to `createTabElement()` from tabs.js
- Remove `closeOtherTabs`, `closeAllTabs`, `cycleTab`, `goToTab`, `moveTab`, `startTabRename`, `showTabContextMenu`, `clearDropIndicators`, `draggedTabId`
- Import these from tabs.js

**Step 3: Verify build**

Run: `npm run build:renderer`

**Step 4: Run tests**

Run: `npm test`
Expected: All 40 pass. Key tests: step-005 (tabs), step-011 (tab context menu), step-012 (tab drag), step-013 (tab rename), step-024 (move tab), step-031 (close others).

**Step 5: Commit**

```bash
git add src/renderer/tabs.js src/renderer/index.js
git commit -m "refactor: extract tabs.js from renderer monolith (PR 4/6)"
```

---

### Task 5: Extract `terminal.js`

Session lifecycle + theme + font + clipboard + sounds + statusbar — ~600 lines. The most coupled module, but by now tabs.js and sidebar.js are extracted.

**Files:**
- Create: `src/renderer/terminal.js`
- Modify: `src/renderer/index.js`

**Step 1: Create `src/renderer/terminal.js`**

Cut these sections:
- Theme constants and helpers (lines 91-145): `DARK_TERMINAL_THEME`, `LIGHT_TERMINAL_THEME`, `getCurrentThemeMode`, `getTerminalTheme`, `applyThemeSetting`, `TERMINAL_OPTIONS`
- `getActiveSession()` (line 150-152)
- `createSession()` (lines 444-643, now shorter after tab extraction)
- `activateTab()` (lines 646-673)
- `closeTab()` (lines 676-698)
- `restoreSessions()` (lines 704-716)
- Font size state + functions (lines 1088-1107): `currentFontSize`, `setFontSize`, `zoomIn`, `zoomOut`, `zoomReset`
- `clearTerminal()` (lines 1111-1115)
- Clipboard (lines 1119-1134): `copySelection`, `pasteClipboard`
- `selectAll()` (lines 1219-1223)
- Sound theme (lines 2613-2656): `soundCache`, `loadSoundTheme`, `playEventSound`, `initSoundTheme`
- Status bar (lines 2287-2353): state + `formatUptime`, `updateStatusBar`, `startUptimeTimer`, `stopUptimeTimer`

State owned:
- `sessions`, `activeId`, `currentFontSize`, `soundCache`, `uptimeInterval`
- Status bar DOM refs

Imports:
```js
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { getProjectColor } from './projectColors.js';
import { createTabElement } from './tabs.js';
import {
  selectedProjectPath, projects, projectActivity,
  renderSidebar, updateEmptyState, updateAppGlow,
  updateProjectActivityBadge, sessionsForProject, countSessionsForProject,
} from './sidebar.js';
import { addDebugEntry } from './overlays.js';
```

Exports: everything listed in the design doc's terminal.js exports.

**Step 2: Update `index.js`**

- Remove ALL xterm imports (Terminal, FitAddon, SearchAddon, WebLinksAddon, Unicode11Addon)
- Remove `sessions`, `activeId` declarations
- Remove all cut functions
- Import everything from terminal.js
- `index.js` is now mostly just `init()`, test helpers, and action registration

**Step 3: Update import paths in other modules**

- `settings.js`: change imports of `sessions`, `activeId`, `activateTab`, `closeTab`, `loadSoundTheme`, `applyThemeSetting` to `'./terminal.js'`
- `overlays.js`: change imports of `sessions`, `getActiveId`, `getActiveSession` to `'./terminal.js'`
- `sidebar.js`: change imports of `sessions`, `activateTab`, `closeTab`, `restoreSessions`, `updateStatusBar` to `'./terminal.js'`
- `tabs.js`: change imports of `sessions`, `getActiveId`, `activateTab`, `closeTab`, `createSession` to `'./terminal.js'`

**Step 4: Verify build**

Run: `npm run build:renderer`

**Step 5: Run tests**

Run: `npm test`
Expected: All 40 pass. This is the highest-risk extraction — every test touches terminal functionality.

**Step 6: Commit**

```bash
git add src/renderer/terminal.js src/renderer/settings.js src/renderer/overlays.js src/renderer/sidebar.js src/renderer/tabs.js src/renderer/index.js
git commit -m "refactor: extract terminal.js from renderer monolith (PR 5/6)"
```

---

### Task 6: Extract `keybindings.js`

Action registry + dispatch — ~100 lines. Done last because action registration references all other modules.

**Files:**
- Create: `src/renderer/keybindings.js`
- Modify: `src/renderer/index.js`

**Step 1: Create `src/renderer/keybindings.js`**

Cut:
- `DEFAULT_KEYBINDINGS` (lines 33-67)
- `keybindings` (line 69)
- `actions` Map (line 71)
- `normalizeKeyEvent()` (lines 2603-2611)

Add an `initKeyboardDispatch()` function that encapsulates lines 2833-2841:
```js
export function initKeyboardDispatch() {
  document.addEventListener('keydown', (e) => {
    const key = normalizeKeyEvent(e);
    const actionName = keybindings[key];
    if (!actionName) return;
    const handler = actions.get(actionName);
    if (!handler) return;
    e.preventDefault();
    handler();
  });
}
```

Export:
```js
export { DEFAULT_KEYBINDINGS, keybindings, actions, normalizeKeyEvent, initKeyboardDispatch };
```

No imports from other modules — this is a leaf module.

**Step 2: Update `index.js`**

- Remove `DEFAULT_KEYBINDINGS`, `keybindings`, `actions`, `normalizeKeyEvent`, keyboard dispatch listener
- Import from keybindings.js
- Call `initKeyboardDispatch()` in `init()`
- Update `overlays.js`: change `keybindings`, `actions` imports to `'./keybindings.js'`

**Step 3: Verify build**

Run: `npm run build:renderer`

**Step 4: Run tests**

Run: `npm test`
Expected: All 40 pass. Key tests: step-018 (tab number shortcuts), step-017 (shortcut help).

**Step 5: Commit**

```bash
git add src/renderer/keybindings.js src/renderer/overlays.js src/renderer/index.js
git commit -m "refactor: extract keybindings.js from renderer monolith (PR 6/6)"
```

---

### Task 7: Clean up `index.js` and verify final state

After all extractions, `index.js` should be ~200-300 lines: imports, `init()`, test helpers, IPC listeners.

**Files:**
- Modify: `src/renderer/index.js`

**Step 1: Review remaining code**

Read `index.js` and verify it only contains:
- Import statements from all 6 modules + `projectColors.js`
- `init()` function: DOM queries, state restoration, action registration, module init calls
- `window._claudiu*` test helpers
- IPC listeners (`update-available`, `debug-log`, `before-quit`, `open-project`)
- Entry point (`DOMContentLoaded` / `init()`)

**Step 2: Clean up any leftover exports**

Remove any `export` keywords from `index.js` that were added as bridges during extraction but are no longer needed (i.e., nothing imports from `./index.js` anymore).

**Step 3: Verify no circular imports remain**

Run: `npm run build:renderer`
Check output for warnings. esbuild handles circular imports but ideally there should be none at this point.

**Step 4: Final full test run**

Run: `npm test`
Expected: All 40 tests pass.

**Step 5: Verify file sizes**

Run: `wc -l src/renderer/*.js`
Expected approximate sizes:
- `index.js`: ~250 lines
- `settings.js`: ~650 lines
- `overlays.js`: ~520 lines
- `sidebar.js`: ~400 lines
- `tabs.js`: ~300 lines
- `terminal.js`: ~600 lines
- `keybindings.js`: ~100 lines
- `projectColors.js`: ~39 lines (unchanged)

**Step 6: Commit**

```bash
git add src/renderer/index.js
git commit -m "refactor: clean up index.js after renderer extraction complete"
```

---

## Known Challenges

1. **Circular imports during extraction**: Tasks 1-4 will have temporary circular imports (e.g., settings.js imports from index.js which imports from settings.js). esbuild handles these in IIFE bundles. They resolve once terminal.js is extracted in Task 5.

2. **`let` variables can't be live-exported**: ES module `export let x` creates a live binding, BUT the importer can't reassign it. For variables like `activeId` that are reassigned (`activeId = id`), we use getter/setter functions instead of direct variable exports.

3. **Tab DOM creation untangling (Task 4)**: The hardest refactoring is splitting `createSession()`. The tab creation code (lines 496-576) interleaves with terminal setup. The clean boundary: `createTabElement()` takes the `id`, project info, and returns the `tabEl`. It wires up click/drag/rename/context-menu listeners. The terminal-specific listeners (onData activity tracking, bell) stay in `createSession()`.

4. **Test helpers bridge**: `window._claudiu*` functions reference internal state from multiple modules. After extraction they import from the appropriate modules instead of relying on closure scope.

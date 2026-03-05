# Renderer Extraction Design

## Goal

Split `src/renderer/index.js` (2,865 lines) into 7 focused modules to fix:
- Slow code navigation (28 logical sections in one file)
- Risky modifications (changing one feature breaks another due to coupling)
- Merge conflicts when two people edit the same file

## Principles

- **No new abstractions**: no event bus, no centralized state wrapper. Direct imports between modules.
- **State ownership**: each variable is exported from exactly one module. Others import it read-only and mutate through exported functions.
- **No behavior changes**: pure structural refactor. App behaves identically after each PR.
- **No build changes**: esbuild still bundles `src/renderer/index.js` into a single IIFE.

## Module Structure

```
src/renderer/
  index.js              # Entry point: imports, init(), test helpers (~250 lines)
  settings.js           # Settings tab + trim UI (~650 lines)
  overlays.js           # Project picker, shortcut help, prompt, search, debug pane (~520 lines)
  sidebar.js            # Sidebar, projects, resize, auto-hide, empty state, glow (~400 lines)
  tabs.js               # Tab bar, drag/drop, rename, context menu, move (~300 lines)
  terminal.js           # Session lifecycle, xterm, theme, font, clipboard, sounds, statusbar (~600 lines)
  keybindings.js        # Action registry, normalization, dispatch (~100 lines)
  projectColors.js      # (unchanged)
```

## Extraction Order

| PR | Module | Lines | Risk | Rationale |
|----|--------|-------|------|-----------|
| 1 | `settings.js` | ~650 | Low | Biggest chunk, nearly self-contained |
| 2 | `overlays.js` | ~520 | Low | Self-contained UI features with clear lifecycle |
| 3 | `sidebar.js` | ~400 | Medium | Touches project selection which cascades |
| 4 | `tabs.js` | ~300 | Medium | Tab creation embedded in createSession() needs untangling |
| 5 | `terminal.js` | ~600 | Medium | Core module, cleaner after tabs.js extracted |
| 6 | `keybindings.js` | ~100 | Low | References all modules, done last |

## Module Details

### 1. `settings.js`

**Moves here:**
- `settingsIdCounter`, `ALL_HOOK_EVENTS`
- `findSettingsTab()`, `openSettings()`
- `renderSettingsTab()` + nested `renderGeneralSection()`, `renderSoundsSection()`, `renderAboutSection()`
- `openTrimUI()`

**Exports:** `openSettings()`, `findSettingsTab()`

**Imports from:** overlays.js (`showPromptOverlay`), terminal.js (`loadSoundTheme`, `applyThemeSetting`), terminal.js (`activeId`, `sessions`)

### 2. `overlays.js`

**Moves here:**
- Prompt: `showPromptOverlay()`
- Project picker: `openProjectPicker()`, `closeProjectPicker()`, `renderPickerList()`
- Shortcut help: `showShortcutHelp()`, `closeShortcutHelp()`, `ACTION_LABELS`, `formatKeyCombo()`
- Search: `openSearchBar()`, `focusSearchBar()`, `closeSearchBar()`
- `refocusTerminal()`
- Debug pane: `toggleDebugPane()`, `initDebugPaneResize()`, `addDebugEntry()`, `updateDebugPaneCount()`, `clearDebugPane()`, `formatLogTime()`, `debugAutoScroll`, `debugPaneOpen`, `debugPaneHeight`

**Exports:** `showPromptOverlay()`, `openProjectPicker()`, `closeProjectPicker()`, `showShortcutHelp()`, `closeShortcutHelp()`, `openSearchBar()`, `closeSearchBar()`, `refocusTerminal()`, `toggleDebugPane()`, `initDebugPaneResize()`, `addDebugEntry()`, `clearDebugPane()`

**Imports from:** terminal.js (`sessions`, `activeId`, `getActiveSession`), keybindings.js (`keybindings`, `actions`), sidebar.js (`projects`, `selectedProjectPath`)

### 3. `sidebar.js`

**Moves here:**
- `renderSidebar()`, `updateProjectActivityBadge()`, `selectProject()`, `addProject()`, `removeProject()`, `cycleProject()`
- `getEmptyStateMessage()`, `updateEmptyState()`
- `toggleSidebar()`, `revealSidebar()`, `scheduleSidebarHide()`, `hideSidebar()`, `initSidebarAutoHide()`
- `initSidebarResize()`
- `updateAppGlow()`
- `showProjectContextMenu()`

**State owned:** `selectedProjectPath`, `projectMRU`, `projectActivity`, `projects`, `sidebarMode`, `sidebarRevealed`, `sidebarWidth`

**Exports:** `renderSidebar()`, `selectProject()`, `addProject()`, `removeProject()`, `cycleProject()`, `toggleSidebar()`, `initSidebarResize()`, `initSidebarAutoHide()`, `updateEmptyState()`, `updateAppGlow()`, `refreshProjectList()`, `sessionsForProject()`, `countSessionsForProject()`, state variables

**Imports from:** tabs.js (`activateTabUI`), terminal.js (`restoreSessions`, `updateStatusBar`, `sessions`, `activeId`), projectColors.js

### 4. `tabs.js`

**Moves here:**
- Tab DOM creation (extracted from `createSession()` into `createTabElement()`)
- Tab event listeners (click, close, drag/drop, double-click rename)
- `clearDropIndicators()`, `startTabRename()`
- `showTabContextMenu()`, `closeOtherTabs()`, `closeAllTabs()`
- `cycleTab()`, `goToTab()`, `moveTab()`
- Activity indicator logic, bell indicator

**Exports:** `createTabElement()`, `activateTabUI()`, `removeTab()`, `cycleTab()`, `goToTab()`, `moveTab()`, `closeOtherTabs()`, `closeAllTabs()`, `startTabRename()`, `showTabContextMenu()`

**Imports from:** terminal.js (`sessions`, `activeId`, `closeSession`)

### 5. `terminal.js`

**Moves here:**
- `createSession()` (minus tab DOM creation, now calls `createTabElement()`)
- `closeSession()` (teardown + calls `removeTab()`)
- `restoreSessions()`
- Theme: `DARK_TERMINAL_THEME`, `LIGHT_TERMINAL_THEME`, `TERMINAL_OPTIONS`, `getCurrentThemeMode()`, `getTerminalTheme()`, `applyThemeSetting()`
- Font: `currentFontSize`, `setFontSize()`, `zoomIn()`, `zoomOut()`, `zoomReset()`
- Actions: `clearTerminal()`, `copySelection()`, `pasteClipboard()`, `selectAll()`
- Sound: `soundCache`, `loadSoundTheme()`, `playEventSound()`, `initSoundTheme()`
- Status bar: `updateStatusBar()`, `formatUptime()`, `startUptimeTimer()`, `stopUptimeTimer()`

**State owned:** `sessions`, `activeId`, `currentFontSize`, `soundCache`, `uptimeInterval`

**Exports:** `sessions`, `activeId`, `getActiveSession()`, `createSession()`, `closeSession()`, `activateSession()`, `restoreSessions()`, `setFontSize()`, `zoomIn()`, `zoomOut()`, `zoomReset()`, `clearTerminal()`, `copySelection()`, `pasteClipboard()`, `selectAll()`, `applyThemeSetting()`, `getTerminalTheme()`, `loadSoundTheme()`, `updateStatusBar()`

**Imports from:** tabs.js (`createTabElement`, `activateTabUI`, `removeTab`), sidebar.js (`selectedProjectPath`, `renderSidebar`, `updateEmptyState`, `updateAppGlow`), overlays.js (`addDebugEntry`), projectColors.js

### 6. `keybindings.js`

**Moves here:**
- `DEFAULT_KEYBINDINGS`, `keybindings`, `actions`
- `normalizeKeyEvent()`
- Keyboard dispatch listener
- Action registration block

**Exports:** `keybindings`, `actions`, `normalizeKeyEvent()`, `registerAction()`, `getKeybindings()`, `initKeyboardDispatch()`

**Imports from:** None (leaf module)

### 7. `index.js` (after extraction)

~200-250 lines remaining:
- Imports from all 6 modules
- `init()`: DOM queries, state restoration, action registration, module init calls
- `window._claudiu*` test helpers (thin wrappers delegating to module exports)
- IPC listeners (`update-available`, `debug-log`, `before-quit`)

## Dependency Graph

```
  keybindings.js    projectColors.js     (no deps)
       |                  |
       v                  v
  overlays.js -----> terminal.js <----- tabs.js
       ^               |    ^              |
       |               v    |              |
       +---------- sidebar.js <------------+
                       |
                       v
                  settings.js
                       |
                       v
                   index.js (entry point)
```

## Migration Rules

- One module per PR. Run full E2E test suite after each extraction.
- No behavior changes. Pure refactor.
- `window._claudiu*` test helpers must continue working throughout.
- CSS stays monolithic (not part of this refactoring).
- Circular imports during intermediate PRs are OK (esbuild handles them). They resolve as later modules are extracted.

## Differences from Original Plan

| Original plan (plan-vanilla-js.md) | This design |
|-------------------------------------|-------------|
| Event bus + centralized state.js | Direct imports, state owned by each module |
| 10 modules | 7 modules (statusbar merged into terminal, debugpane into overlays, no events.js/state.js) |
| Bottom-up extraction order | Big-chunks-first (settings first) |
| 5 phases | 6 linear PRs |

# Renderer Refactoring Plan -- Alpine.js

## Current State Analysis

### File Inventory

| File | Lines | Role |
|------|-------|------|
| `src/renderer/index.js` | 2865 | **Entire renderer** -- all UI logic in one file |
| `src/renderer/projectColors.js` | 39 | Deterministic color palette per project name |
| `src/main/preload.js` | 115 | Context bridge exposing IPC API to renderer |
| `index.html` | 82 | App shell with static DOM structure |
| `styles/base.css` | 1544 | All styles (dark/light themes, layout, components) |
| `scripts/build-renderer.js` | 20 | esbuild bundler config |

### What index.js Does (Feature Map)

The single 2865-line file contains **every renderer concern**:

1. **State management** (lines 20-31): Module-level `Map`/`Set`/`let` variables -- `sessions`, `activeId`, `selectedProjectPath`, `projectMRU`, `projectActivity`, `draggedTabId`.
2. **Theme system** (lines 89-145): Dark/light terminal themes, `applyThemeSetting()`, CSS `data-theme` attribute management, OS media query listener.
3. **DOM references** (lines 73-87): ~15 `let` variables populated in `init()` by `querySelector`.
4. **Helpers** (lines 148-243): `getActiveSession()`, `refocusTerminal()`, `showPromptOverlay()`, `updateAppGlow()`.
5. **Empty state** (lines 246-290): `getEmptyStateMessage()`, `updateEmptyState()` with project-color-tinted SVG cards.
6. **Sidebar** (lines 292-436): `renderSidebar()`, `selectProject()`, `addProject()`, `removeProject()`, `refreshProjectList()`, project activity badges.
7. **Sessions/Tabs** (lines 438-716): `createSession()` (200+ lines), `activateTab()`, `closeTab()`, `restoreSessions()`, `cycleProject()`, `cycleTab()`, `goToTab()`.
8. **Project Picker** (lines 746-855): Overlay with fuzzy filter, MRU ordering, keyboard navigation.
9. **Tab drag-and-drop** (lines 857-863 + inline in createSession): Drop indicators, DOM reorder.
10. **Tab rename** (lines 865-912): Inline input replacement on double-click.
11. **Tab context menu** (lines 914-961): Duplicate, close, close others, close all.
12. **Project context menu** (lines 963-990): Reveal in Finder, copy path, project settings, remove.
13. **Terminal search** (lines 992-1084): Search bar UI, find next/prev via SearchAddon.
14. **Font zoom** (lines 1086-1107): Zoom in/out/reset, persistence via IPC.
15. **Clear terminal** (lines 1109-1115): `Cmd+K` handler.
16. **Clipboard** (lines 1117-1134): Copy selection, paste.
17. **Sidebar auto-hide** (lines 1136-1215): Pin/unpin toggle, mouse hover reveal/hide with timeout.
18. **Select all** (lines 1217-1223).
19. **Move tab** (lines 1225-1263): Reorder tabs with keyboard.
20. **Shortcut help overlay** (lines 1265-1370): Dynamic overlay listing all keybindings.
21. **Settings tab** (lines 1372-2089): ~700 lines -- scope toggle, general settings form, sound theme selector, sound event table, theme management (duplicate/rename/delete), install from ZIP/GitHub, export, save.
22. **Audio trim UI** (lines 2091-2282): WaveSurfer.js integration, region-based trimming, save trim metadata.
23. **Status bar** (lines 2284-2353): Project name, session type, uptime timer, terminal dimensions.
24. **Sidebar resize** (lines 2355-2405): Drag handle with min/max constraints.
25. **Debug pane** (lines 2407-2528): Toggle, resize, log entries, auto-scroll, clear.
26. **Test helpers** (lines 2530-2599): ~20 `window._claudiu*` functions exposed for Playwright.
27. **Keybinding dispatch** (lines 2601-2841): `normalizeKeyEvent()`, data-driven action map, `document.addEventListener('keydown', ...)`.
28. **Sound theme** (lines 2613-2656): Audio cache, `loadSoundTheme()`, `playEventSound()`, hook event listener.
29. **Init** (lines 2658-2865): DOM lookups, window state restoration, IPC listeners, action registration.

### Pain Points

1. **God file**: All 2865 lines live in one module. No separation of concerns whatsoever.
2. **Imperative DOM manipulation everywhere**: Manual `createElement`, `innerHTML`, `appendChild`, `remove()` -- hundreds of calls. No templates, no declarative rendering.
3. **Scattered state**: 15+ module-level `let` variables, a `Map`, a `Set`, and several arrays form the global state. State mutations are spread across dozens of functions with no centralized change tracking.
4. **No reactivity**: After any state change, the developer must manually call `renderSidebar()`, `updateStatusBar()`, `updateEmptyState()`, etc. Missing a call = stale UI.
5. **Settings tab is a mini-app**: The `renderSettingsTab()` + `renderGeneralSection()` + `renderSoundsSection()` + `openTrimUI()` block is ~700 lines of imperative DOM code with its own local state, closures over async data, and manual re-render loops.
6. **Test helpers tightly coupled**: 20 `window._claudiu*` functions reach directly into the module's internal state. Any refactor risks breaking tests.
7. **Inline event listeners**: Event handlers are attached imperatively inside `createSession()`, `renderSidebar()`, etc. No way to inspect or remove them declaratively.
8. **No component boundaries**: Tab creation, sidebar rendering, and overlay construction all happen inline with tangled dependencies.
9. **Duplicate patterns**: Several overlays (project picker, shortcut help, prompt, settings) all implement the same pattern of create-overlay-div + add-to-DOM + listen-for-escape + remove-on-close, but with no shared abstraction.
10. **CSS is also monolithic**: 1544 lines in one file, though this is less critical than the JS.

### What Works Well

- The **preload layer** is clean and well-structured -- no changes needed there.
- The **data-driven keybinding system** is a good pattern worth preserving.
- The **IPC API surface** (`window.electron_api`) is stable and well-designed.
- The **project color system** is isolated in its own module.
- Test coverage is extensive (37 spec files, ~6100 lines of tests).

---

## Test Suite Analysis

### Structure

- **37 Playwright E2E spec files** in `/tests/`, named `step-NNN-feature.spec.js`.
- **1 shared helper** (`tests/helpers.js`) providing `launchEnv()`, `appPath`, `showWindow()`.
- Tests are Electron integration tests -- they launch the real app, interact with the DOM, and verify behavior.

### What Is Tested

| Feature | Test File | Tests |
|---------|-----------|-------|
| App skeleton / security | step-001, step-002 | 7 |
| xterm.js shell | step-003 | ~6 |
| Claude session spawning | step-004 | ~5 |
| Tabbed terminals | step-005 | 10 |
| Sidebar projects + picker + persistence | step-006 | 31 |
| Window state persistence | step-007 | ~8 |
| Sidebar resize | step-008 | ~6 |
| Status bar | step-009 | ~6 |
| Terminal search | step-010 | ~8 |
| Tab context menu | step-011 | ~6 |
| Tab reorder (drag) | step-012 | ~6 |
| Tab rename | step-013 | ~5 |
| Font zoom | step-014 | ~6 |
| Tab activity indicator | step-015 | ~6 |
| Close confirm | step-016 | ~4 |
| Shortcut help | step-017 | ~5 |
| Tab number shortcuts | step-018 | ~5 |
| Project activity | step-019 | ~5 |
| Duplicate tab | step-020 | ~4 |
| Terminal bell | step-021 | ~4 |
| Clear terminal | step-022 | ~4 |
| Clipboard | step-023 | ~4 |
| Move tab | step-024 | ~5 |
| Session uptime | step-025 | ~4 |
| Select all | step-026 | ~4 |
| Toggle sidebar | step-027 | ~4 |
| Project context menu | step-028 | ~4 |
| Terminal links | step-029 | ~3 |
| App version | step-030 | ~2 |
| Close others shortcut | step-031 | ~3 |
| Project identity | step-032 | ~5 |
| Configuration settings | step-033 | ~12 |
| CLI invocation | step-034 | ~4 |
| Debug pane | step-035 | ~6 |
| npm start project | step-036 | ~2 |
| Dark theme | step-037 | ~3 |
| Sound themes (cow) | step-045 | ~10 |
| Duplicate theme | step-046 | ~3 |
| Sound theme ops | step-047 | ~15 |

### Coverage Gaps

1. **No unit tests**: Everything is E2E. There are no fast, isolated tests for pure functions like `formatUptime()`, `getProjectColor()`, `normalizeKeyEvent()`, `getEmptyStateMessage()`.
2. **Audio trim UI untested**: The WaveSurfer trim UI (~190 lines) has no dedicated test.
3. **Edge cases in overlays**: Prompt overlay, shortcut help, and project picker are tested for basic flows but not for edge cases like rapid open/close, concurrent overlays, or memory leaks.
4. **Sidebar auto-hide**: Tested for toggle but hover-reveal timing is not verified.
5. **No accessibility tests**: No keyboard-only navigation verification beyond shortcuts.

### Test Coupling to Internals

Tests rely heavily on `window._claudiu*` helper functions:
- `_claudiuGetBufferText()`, `_claudiuActiveTabId()`, `_claudiuSelectedProject()`
- `_claudiuProjectMRU()`, `_claudiuCloseOtherTabs()`, `_claudiuDuplicateTab()`
- `_claudiuReloadProjects()`, `_claudiuSelectProject()`, etc.

These are direct references to internal state. An Alpine.js refactor must either:
- Preserve these exact `window._claudiu*` functions (safest for test compatibility), OR
- Replace them with equivalent Alpine store accessors (but update all 37 test files).

**Recommendation**: Preserve the `window._claudiu*` API as a thin compatibility layer that delegates to Alpine stores. This allows incremental migration without breaking tests.

---

## Proposed Architecture

### Why Alpine.js

Alpine.js occupies the sweet spot for this codebase:

- **Progressive adoption**: Can be introduced file by file alongside existing vanilla JS. No big-bang rewrite required.
- **Minimal overhead**: ~15 KB gzipped. No virtual DOM, no build-time compilation, no JSX.
- **Declarative templates**: Replaces 1000+ lines of `createElement`/`innerHTML` with `x-data`, `x-for`, `x-show`, `x-on`, `x-text`, `x-bind`.
- **Built-in reactivity**: `Alpine.store()` provides reactive global state. UI updates automatically when store properties change -- eliminates every manual `renderSidebar()`, `updateStatusBar()`, `updateEmptyState()` call.
- **Component pattern**: `Alpine.data()` registers reusable component definitions. Each concern gets its own data function.
- **Plugin system**: `Alpine.plugin()` allows extracting cross-cutting concerns (keybindings, overlays).
- **No framework lock-in**: Alpine works with plain HTML and can be removed just as easily as it's added.

### High-Level Structure

```
src/renderer/
  index.js              # Alpine.start() + plugin registration + test helpers
  stores/
    sessions.js         # Alpine.store('sessions') -- core session/tab state
    projects.js         # Alpine.store('projects') -- project list, MRU, selection
    ui.js               # Alpine.store('ui') -- sidebar mode, font size, debug pane, theme
  components/
    sidebar.js          # Alpine.data('sidebar') -- project list rendering + interactions
    tabBar.js           # Alpine.data('tabBar') -- tabs, drag-drop, rename, context menu
    terminal.js         # Alpine.data('terminal') -- xterm.js lifecycle, search bar
    settings.js         # Alpine.data('settings') -- full settings tab (general, sounds, trim)
    overlays.js         # Alpine.data('projectPicker'), Alpine.data('shortcutHelp'), etc.
    statusBar.js        # Alpine.data('statusBar') -- status bar reactive display
    debugPane.js        # Alpine.data('debugPane') -- log entries, resize, clear
  plugins/
    keybindings.js      # Alpine.plugin -- data-driven keyboard dispatch
    sound.js            # Alpine.plugin -- sound theme cache + playback on hook events
  lib/
    projectColors.js    # Pure function (unchanged)
    theme.js            # Theme constants + applyThemeSetting()
    helpers.js          # formatUptime(), formatKeyCombo(), showPromptOverlay()
```

### Data Flow

```
IPC events (preload)
  |
  v
Alpine.store('sessions')  <-->  Alpine.store('projects')
  |                                |
  v                                v
components/tabBar.js          components/sidebar.js
components/terminal.js        components/overlays.js
  |                                |
  v                                v
index.html (x-data, x-for, x-show, x-bind, x-on)
```

State mutations flow through stores. Components read from stores reactively. The HTML template uses Alpine directives to bind data, iterate, toggle visibility, and handle events.

---

## Module Breakdown (10 Concerns)

### 1. Sessions Store (`stores/sessions.js`)

**Responsibility**: Core session lifecycle -- creating, activating, closing, and querying sessions. This is the heart of the app.

**Alpine.js patterns**:
- `Alpine.store('sessions')` -- reactive global store
- Properties: `map` (reactive Map proxy or plain object keyed by ID), `activeId`, `nextSettingsId`
- Methods: `create(type, opts)`, `activate(id)`, `close(id)`, `closeOthers(keepId)`, `closeAll(projectPath)`, `forProject(projectPath)`, `countForProject(projectPath)`, `getActive()`, `restore(projectPath)`

**Current code mapped**:
- `sessions` Map (line 20)
- `activeId` (line 21)
- `createSession()` (lines 444-643)
- `activateTab()` (lines 646-673)
- `closeTab()` (lines 676-698)
- `restoreSessions()` (lines 704-716)
- `cycleTab()`, `goToTab()` (lines 727-743)
- `closeOtherTabs()`, `closeAllTabs()` (lines 948-961)
- `sessionsForProject()`, `countSessionsForProject()` (lines 384-389)

**Dependencies**: `Alpine.store('projects')` for selectedProjectPath. `window.electron_api.terminal` for IPC. xterm.js + addons for terminal instances.

**Data flow**: Sessions store is the source of truth for what terminals exist. TabBar component reads from it. Sidebar reads session counts from it. StatusBar reads the active session from it.

---

### 2. Projects Store (`stores/projects.js`)

**Responsibility**: Project list management, selection, MRU ordering, activity tracking.

**Alpine.js patterns**:
- `Alpine.store('projects')` -- reactive global store
- Properties: `list` (array), `selectedPath`, `mru` (array), `activity` (Set or reactive array)
- Methods: `select(path)`, `add()`, `remove(path)`, `refresh(projectList)`, `cycleProject(direction)`, `clearActivity(path)`, `markActivity(path)`

**Current code mapped**:
- `projects` array (line 87)
- `selectedProjectPath` (line 22)
- `projectMRU` (line 24)
- `projectActivity` Set (line 30)
- `selectProject()` (lines 346-381)
- `addProject()`, `removeProject()` (lines 405-436)
- `refreshProjectList()` (lines 392-403)
- `cycleProject()` (lines 718-724)

**Dependencies**: `Alpine.store('sessions')` to show/hide tabs on project switch. `window.electron_api.projects` for IPC.

**Data flow**: When `selectedPath` changes, Alpine reactivity automatically updates the sidebar (selected state), tab bar (visibility), empty state, status bar, and app glow.

---

### 3. UI Store (`stores/ui.js`)

**Responsibility**: Global UI state that doesn't belong to sessions or projects -- sidebar mode, font size, theme, debug pane state.

**Alpine.js patterns**:
- `Alpine.store('ui')` -- reactive global store
- Properties: `sidebarMode`, `sidebarWidth`, `sidebarRevealed`, `currentFontSize`, `themeMode`, `debugPaneOpen`, `debugPaneHeight`
- Methods: `toggleSidebar()`, `revealSidebar()`, `hideSidebar()`, `setFontSize(size)`, `zoomIn()`, `zoomOut()`, `zoomReset()`, `applyTheme(theme)`, `toggleDebugPane()`

**Current code mapped**:
- `sidebarMode`, `sidebarRevealed`, `sidebarWidth` (lines 1138-1141)
- `currentFontSize` (line 1091)
- `debugPaneOpen`, `debugPaneHeight` (lines 83-84)
- Font zoom functions (lines 1093-1107)
- Sidebar auto-hide functions (lines 1144-1215)
- Theme helpers (lines 89-137)
- Debug pane toggle (lines 2409-2428)

**Dependencies**: `window.electron_api.windowState` for persistence. `window.electron_api.appConfig` for theme resolution.

**Data flow**: UI store changes propagate via Alpine reactivity to all components that use `x-bind:class`, `x-show`, or `x-bind:style` based on these values.

---

### 4. Sidebar Component (`components/sidebar.js`)

**Responsibility**: Project list rendering, project item interactions (click to select, right-click context menu, remove button), resize handle.

**Alpine.js patterns**:
- `Alpine.data('sidebar')` -- component definition
- Template uses `x-for` to iterate `$store.projects.list`
- `x-bind:class` for `selected` and `project-activity` states
- `x-on:click` for selection, `x-on:contextmenu` for context menu
- `x-show` conditional on `$store.ui.sidebarMode`

**Current code mapped**:
- `renderSidebar()` (lines 294-338)
- `updateProjectActivityBadge()` (lines 340-344)
- `showProjectContextMenu()` (lines 965-990)
- `initSidebarResize()` (lines 2357-2405)
- `initSidebarAutoHide()` (lines 1207-1215)

**Template transformation**: The current `renderSidebar()` creates DOM elements in a loop with `innerHTML`. In Alpine, this becomes:

```html
<template x-for="project in $store.projects.list" :key="project.path">
  <div class="sidebar-project"
       x-data="sidebarProject(project)"
       :class="{ selected: $store.projects.selectedPath === project.path,
                 'project-activity': $store.projects.activity.includes(project.path) }"
       @click="$store.projects.select(project.path)"
       @contextmenu.prevent="showContextMenu()">
    <!-- icon, name, count, remove button -->
  </div>
</template>
```

This eliminates `renderSidebar()` entirely -- Alpine re-renders automatically when store data changes.

---

### 5. Tab Bar Component (`components/tabBar.js`)

**Responsibility**: Tab rendering, activation, closing, drag-and-drop reorder, keyboard move, rename, context menu.

**Alpine.js patterns**:
- `Alpine.data('tabBar')` -- component definition
- `x-for` to iterate sessions filtered by selected project
- `x-bind:class` for active tab, activity indicator, bell animation
- `x-on:dragstart`, `x-on:dragover`, `x-on:drop` for drag reorder
- `x-on:dblclick` on label for rename
- `x-on:contextmenu` for tab context menu

**Current code mapped**:
- Tab creation inside `createSession()` (lines 506-576)
- Tab drag events (lines 531-574)
- `clearDropIndicators()` (lines 859-863)
- `startTabRename()` (lines 867-912)
- `showTabContextMenu()` (lines 916-946)
- `moveTab()` (lines 1227-1263)

**Dependencies**: `Alpine.store('sessions')`, `Alpine.store('projects')`.

**Note**: Tab elements currently embed tab metadata (icons, labels, color dots) using inline SVG in `innerHTML`. With Alpine, these become template expressions with `x-bind:style` for project colors.

---

### 6. Terminal Component (`components/terminal.js`)

**Responsibility**: xterm.js terminal lifecycle -- creating Terminal instances, fitting, wiring IPC data/exit listeners, ResizeObserver, search bar.

**Alpine.js patterns**:
- `Alpine.data('terminalPanel')` -- component definition attached to each `.terminal-panel` element
- Uses `x-init` to bootstrap xterm.js into the panel
- `x-ref` for terminal container element
- Manages its own xterm instance lifecycle in `init()` / `destroy()`

**Current code mapped**:
- Terminal creation inside `createSession()` (lines 458-628)
- `openSearchBar()`, `closeSearchBar()`, `focusSearchBar()` (lines 996-1084)
- `clearTerminal()` (lines 1111-1115)
- `copySelection()`, `pasteClipboard()` (lines 1119-1134)
- `selectAll()` (lines 1219-1223)

**Key consideration**: xterm.js is imperative by nature -- you call `terminal.open(element)`, not render a template. Alpine's `x-init` / `x-effect` hooks handle this well. The terminal instance is stored as a property on the component's data object.

---

### 7. Settings Component (`components/settings.js`)

**Responsibility**: The entire settings tab UI -- scope toggle, general settings, sound & hooks section, theme management, sound event table, trim UI.

**Alpine.js patterns**:
- `Alpine.data('settingsTab')` -- main settings component
- Nested `x-data` for sub-sections (general, sounds, about)
- `x-show` for section switching instead of `contentArea.innerHTML = ''`
- `x-for` to iterate schema fields (general) and hook events (sounds)
- `x-model` for two-way binding on settings inputs (eliminates manual event listeners)
- `x-effect` to react to scope/section changes

**Current code mapped**:
- `openSettings()` (lines 1401-1442)
- `renderSettingsTab()` (lines 1445-2089) -- ~650 lines of imperative DOM
- `openTrimUI()` (lines 2097-2282) -- ~185 lines
- `ALL_HOOK_EVENTS` constant (lines 1378-1387)

**This is the biggest win**: The settings section is ~700 lines of `createElement`/`appendChild` code. With Alpine's declarative templates, this drops to ~200 lines of HTML + ~150 lines of JS logic. The `x-model` directive alone eliminates ~100 lines of manual input binding.

**Trim UI sub-component**: `Alpine.data('trimUI')` -- isolates WaveSurfer lifecycle. Uses `x-init` to create WaveSurfer, `x-effect` to sync region state, and cleanup on `destroy()`.

---

### 8. Overlays Component (`components/overlays.js`)

**Responsibility**: All overlay/modal UIs -- project picker, shortcut help, prompt dialog.

**Alpine.js patterns**:
- `Alpine.data('projectPicker')` -- picker overlay
- `Alpine.data('shortcutHelp')` -- shortcut help overlay
- `Alpine.data('promptOverlay')` -- generic prompt dialog
- All overlays share a common pattern: `x-show` for visibility, `x-transition` for animation, `@keydown.escape` to close, `@click.self` to close on backdrop click

**Current code mapped**:
- `openProjectPicker()`, `closeProjectPicker()`, `renderPickerList()` (lines 751-855)
- `showShortcutHelp()`, `closeShortcutHelp()` (lines 1318-1370)
- `showPromptOverlay()` (lines 164-227)

**Shared overlay pattern**: Extract a reusable Alpine directive or magic property for the overlay backdrop behavior (`x-on:mousedown.self="close()"`, `x-on:keydown.escape="close()"`). This eliminates the duplicated overlay setup code.

**Project picker specifics**: The filtered project list becomes `x-for="project in filteredProjects"` with a computed getter, instead of rebuilding DOM on every keystroke.

---

### 9. Status Bar + Debug Pane (`components/statusBar.js`, `components/debugPane.js`)

**Responsibility**: Status bar display (project name, session type, uptime, terminal size, version) and debug log pane (entries, auto-scroll, resize, clear).

**Alpine.js patterns**:
- `Alpine.data('statusBar')` -- reads from stores, displays reactive text
- `x-text` bindings for each status item
- `x-effect` to manage the uptime interval (start/stop based on active session)
- `Alpine.data('debugPane')` -- manages log entries array, auto-scroll behavior
- `x-for` to render debug entries
- `x-bind:class` for log level coloring

**Current code mapped**:
- Status bar (lines 2284-2353): `updateStatusBar()`, `formatUptime()`, `startUptimeTimer()`, `stopUptimeTimer()`
- Debug pane (lines 2407-2528): `toggleDebugPane()`, `initDebugPaneResize()`, `addDebugEntry()`, `clearDebugPane()`

**Key win**: The current `updateStatusBar()` must be called manually after every state change (and is called from 8+ places). With Alpine, `x-text="$store.projects.selectedName"` updates automatically when the store changes.

---

### 10. Keybindings Plugin + Sound Plugin (`plugins/keybindings.js`, `plugins/sound.js`)

**Responsibility**: Cross-cutting concerns that wire into the app but aren't UI components.

**Alpine.js patterns**:
- `Alpine.plugin(keybindingsPlugin)` -- registers a global keydown listener, resolves action names to handlers
- `Alpine.magic('keybinding', ...)` -- optional magic property for components to declare local keybindings
- `Alpine.plugin(soundPlugin)` -- manages audio cache, listens for hook events, plays sounds

**Current code mapped**:
- `DEFAULT_KEYBINDINGS`, `keybindings`, `actions` Map (lines 32-71)
- `normalizeKeyEvent()` (lines 2603-2611)
- Keybinding dispatch in init (lines 2832-2841)
- `ACTION_LABELS`, `formatKeyCombo()` (lines 1267-1314) -- used by shortcut help overlay
- Sound theme: `soundCache`, `loadSoundTheme()`, `playEventSound()`, `initSoundTheme()` (lines 2613-2656)

**Design**: The keybindings plugin registers `document.addEventListener('keydown', ...)` during `Alpine.init` and dispatches to named actions. Actions are registered by components during their `init()` phase. This preserves the current data-driven keybinding architecture.

---

## Tooling Changes

### New Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `alpinejs` | ^3.x | Reactive framework |

That's it. Alpine.js is the only new dependency. No build tooling changes needed -- esbuild already bundles ESM imports.

### Build Config Changes

The `scripts/build-renderer.js` esbuild config needs no structural changes. Alpine.js is an ESM package that esbuild handles natively. The entry point remains `src/renderer/index.js`.

One optional addition: if Alpine templates move into `.html` template fragments imported as strings, esbuild's `loader: { '.html': 'text' }` can be added. However, the recommended approach is to keep templates inline in `index.html` using Alpine directives, which requires zero build changes.

### index.html Changes

The HTML file will grow moderately as imperative DOM construction moves into declarative Alpine templates. The current 82-line file will grow to approximately 250-350 lines, but this is **readable, scannable HTML** replacing **hundreds of lines of createElement calls**.

Key additions:
- `x-data` attributes on major containers
- `x-for` loops replacing `renderSidebar()`, tab rendering, settings sections
- `x-show` / `x-bind:class` replacing manual `style.display` and `classList.toggle`
- `x-on:*` event handlers replacing `addEventListener` calls
- Alpine `x-init` for bootstrapping

---

## Migration Strategy

Alpine.js is specifically designed for progressive enhancement. The migration can happen incrementally with no big-bang rewrite.

### Phase 1: Foundation (Low Risk)

1. **Install Alpine.js** and import in `index.js`.
2. **Extract pure functions** into `lib/` -- `formatUptime()`, `formatKeyCombo()`, `normalizeKeyEvent()`, `getEmptyStateMessage()`. These have zero coupling. Add unit tests.
3. **Create stores** (`sessions.js`, `projects.js`, `ui.js`) as thin wrappers around the existing module-level variables. Initially, they can just proxy to the existing `let` variables. Stores expose the same getters/methods but as Alpine reactive properties.
4. **Preserve `window._claudiu*` helpers** as a compatibility shim that reads from Alpine stores.

### Phase 2: Simple Components (Medium Risk)

5. **Status bar**: Replace `updateStatusBar()` calls with `x-text` bindings on the status bar elements. This is the simplest win -- pure read-only display.
6. **Sidebar**: Replace `renderSidebar()` with `x-for` template in `index.html`. Remove the function. Sidebar project items become declarative.
7. **Empty state**: Replace `updateEmptyState()` with `x-show` / `x-bind` on the empty state element.

### Phase 3: Complex Components (Higher Risk)

8. **Tab bar**: Replace tab creation in `createSession()` with Alpine-driven `x-for` rendering. This requires careful handling of xterm.js lifecycle.
9. **Overlays**: Replace project picker, shortcut help, and prompt overlay with Alpine components. Use `x-show` + `x-transition`.
10. **Debug pane**: Replace `addDebugEntry()` with reactive array push + `x-for`.

### Phase 4: Settings (Standalone)

11. **Settings tab**: Rewrite `renderSettingsTab()` as Alpine template. This is the highest-payoff single change (~700 lines of imperative DOM -> ~350 lines of declarative HTML/JS).
12. **Trim UI**: Extract as sub-component of settings.

### Phase 5: Cleanup

13. Remove all manual `render*()` and `update*()` functions that are now handled by Alpine reactivity.
14. Remove dead code from `index.js`.
15. Consolidate the init function.

### Per-Phase Testing

After each phase, run the full Playwright test suite. Because `window._claudiu*` helpers are preserved as shims over Alpine stores, tests should continue to pass without modification until Phase 5.

---

## Benefits & Trade-offs

### Benefits

1. **~60% reduction in renderer JS complexity**: Rough estimate:
   - Current: 2865 lines in index.js
   - After: ~1200 lines total across 12 focused modules
   - The difference comes from eliminating manual DOM manipulation, manual re-render calls, and duplicated overlay patterns.

2. **Automatic UI consistency**: No more forgetting to call `updateStatusBar()` after a state change. Alpine's reactivity guarantees the UI reflects the current state.

3. **Readability**: Declarative HTML templates are scannable at a glance. `x-for="project in $store.projects.list"` is instantly understandable; `sidebarProjectsEl.innerHTML = ''; for (const project of projects) { const el = document.createElement('div'); ... }` is not.

4. **Maintainability**: Each concern is in its own file. Adding a new feature means creating a new component or extending a store, not appending to a 2865-line file.

5. **Testability**: Pure functions can have unit tests. Stores can be tested in isolation. Components can be tested independently.

6. **No build complexity**: Alpine needs no compiler, no JSX, no special loader. esbuild handles it as a normal ESM import.

7. **Easy onboarding**: Alpine's API surface is tiny (~15 directives). A developer familiar with HTML can read Alpine templates immediately.

### Trade-offs

1. **New dependency**: Alpine.js adds ~15 KB (gzipped) to the bundle. In an Electron app, this is negligible.

2. **Learning curve**: Developers need to learn Alpine's directive system (`x-data`, `x-for`, `x-show`, `x-bind`, `x-on`, `x-effect`, `x-init`, `Alpine.store`, `Alpine.data`, `Alpine.plugin`). However, this is vastly simpler than React/Vue/Svelte.

3. **xterm.js integration**: xterm.js is inherently imperative (`.open()`, `.write()`, `.dispose()`). Alpine's `x-init` and `destroy()` lifecycle hooks handle this, but it's not as clean as purely declarative components. The terminal panel component will still have imperative code.

4. **Test helper maintenance**: The `window._claudiu*` compatibility shim adds a small amount of code. Over time, tests should be updated to use `data-testid` selectors and Alpine store inspection directly, allowing the shim to be removed.

5. **WaveSurfer.js integration**: The trim UI uses WaveSurfer which is also imperative. This is contained to one component and works fine with `x-init`/`destroy()`.

### Why Alpine.js Over Alternatives

| Alternative | Why Not |
|-------------|---------|
| **React** | Overkill. Requires JSX compilation, virtual DOM overhead, complete rewrite of templates. Cannot be adopted incrementally. |
| **Vue** | Good option but heavier (~33 KB), requires `.vue` SFC files or render functions, more opinionated build setup. |
| **Svelte** | Requires compiler. Cannot be adopted incrementally into existing HTML. |
| **Lit/Web Components** | Good for component encapsulation but no built-in global state management. More boilerplate per component. |
| **Vanilla JS (status quo)** | The current approach. Works, but the 2865-line god file demonstrates its scalability limit. |
| **htmx** | Designed for server-rendered HTML. Not applicable to a client-side Electron app. |

Alpine.js is the right choice because:
- It works **with** existing HTML rather than replacing it
- It provides **just enough** reactivity without framework overhead
- It can be adopted **one component at a time**
- Its store system is **exactly** what this app needs for shared state
- It keeps the codebase **close to the metal** -- no abstraction layers between the developer and the DOM

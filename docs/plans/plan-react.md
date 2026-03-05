# Renderer Refactoring Plan — React

## Current State Analysis

### File Inventory

The renderer layer consists of exactly **2 source files** and **1 CSS file**:

| File | Lines | Purpose |
|------|-------|---------|
| `src/renderer/index.js` | 2,866 | **Entire** renderer: session management, tabs, sidebar, overlays, settings, search, debug pane, keybindings, sound, theming, status bar, clipboard, font zoom, drag-and-drop, test helpers |
| `src/renderer/projectColors.js` | 39 | Deterministic HSL color generation per project name |
| `styles/base.css` | 1,544 | All styling (theming, layout, components) in one file |

The preload layer is a single file (`src/main/preload.js`, 115 lines) exposing `window.electron_api` with 12 namespaces: `terminal`, `windowState`, `contextMenu`, `clipboard`, `shell`, `updater`, `projects`, `appConfig`, `log`, `hooks`, `soundThemes`, and `getVersion`.

The HTML shell (`index.html`, 82 lines) contains the static layout skeleton (titlebar, sidebar, main area, empty state, debug pane, status bar). The renderer bundle is loaded as an IIFE via esbuild.

### Architectural Pain Points

1. **Monolithic single file**: All 2,866 lines of renderer logic live in one file. There is no separation of concerns — UI rendering, state management, event handling, IPC communication, DOM manipulation, and business logic are all interleaved.

2. **Global mutable state**: The renderer relies on ~30+ module-level mutable variables:
   - `sessions` (Map), `activeId`, `selectedProjectPath`, `projectMRU` (array), `projects` (array)
   - `draggedTabId`, `projectActivity` (Set), `pickerOverlay`, `pickerSelectedIndex`, `pickerFilteredPaths`
   - `searchBarEl`, `shortcutHelpOverlay`, `currentFontSize`, `sidebarMode`, `sidebarRevealed`, `sidebarHideTimeout`, `sidebarWidth`
   - `debugPaneOpen`, `debugPaneHeight`, `debugAutoScroll`, `soundCache` (Map)
   - Multiple DOM element references cached in `let` variables (`terminalsContainer`, `tabBarTabs`, `sidebarEl`, etc.)

3. **Imperative DOM manipulation throughout**: Every UI update uses `document.createElement()`, `innerHTML`, `classList.toggle()`, etc. The settings tab alone (`renderSettingsTab` + sub-renderers) is ~650 lines of imperative DOM construction.

4. **Tightly coupled features**: Closing a tab calls `renderSidebar()` and `updateStatusBar()`. Selecting a project calls `updateAppGlow()`, `activateTab()`, `renderSidebar()`, `updateStatusBar()`, and potentially `restoreSessions()`. These cross-cutting updates make it impossible to reason about any feature in isolation.

5. **Test helpers leak internal state**: 15+ `window._claudiu*` helper functions are bolted onto `window` to give Playwright tests access to internal state (`_claudiuActiveTabId`, `_claudiuGetTabOrder`, `_claudiuProjectMRU`, etc.). This is a code smell that arises because there is no component boundary — the only way to observe or manipulate state is through global backdoors.

6. **No separation of "what" from "how"**: Data-driven keybindings are a good pattern, but the action registry, the DOM event listener, the key normalizer, and the action implementations are all in the same scope with no modularity.

7. **Settings UI is particularly complex**: The settings panel builds General, Sounds, and About sections imperatively. The Sounds section includes a sound theme selector, management buttons (duplicate/rename/delete), install buttons, an event-sound table with play/upload/trim/remove per row, and a WaveSurfer-based audio trim UI. All of this is constructed via `document.createElement()` chains with no componentization.

8. **Overlay/modal pattern is duplicated**: Project picker, shortcut help, prompt overlay, and context menus all follow the same pattern (create overlay div, attach to `.app`, handle Escape/click-outside to close) but each is implemented from scratch.

9. **No error boundaries or loading states**: IPC calls (`api.terminal.create`, `api.projects.list`, etc.) are `await`ed inline with no error handling UI, no loading indicators, and no retry logic.

10. **CSS is monolithic**: 1,544 lines in one file covering every component. Dark/light theme tokens are duplicated in three places (`:root`, `[data-theme="light"]`, `@media (prefers-color-scheme: light)`).

---

## Test Suite Analysis

### Overview

The test suite contains **38 test files** (`step-001` through `step-047`, with gaps) containing approximately **290 individual tests**. All tests are **Playwright E2E tests** running against a real Electron app.

### Test Pattern

Every test file follows the same pattern:
1. `beforeAll`: Launch Electron app with isolated `userData` via `launchEnv()`, get `firstWindow()`, optionally create temp project directories and pre-seed `projects.json`
2. Sequential tests that interact with the live app via Playwright selectors
3. `afterAll`: Close the Electron app, clean up temp dirs

Tests use `data-testid` selectors extensively, which is good practice. They also use the `window._claudiu*` test helpers to read internal renderer state.

### What Is Tested

| Area | Test Files | Coverage |
|------|-----------|----------|
| App skeleton / security | 001, 002 | Launch, title, contextIsolation, nodeIntegration, preload bridge |
| Terminal / xterm | 003, 004 | Shell spawning, buffer text, PTY data flow, Claude session creation |
| Tabs | 005, 011, 012, 013, 015, 018, 020, 024, 031 | Create/close/switch tabs, context menu, drag reorder, rename, activity indicator, tab number shortcuts, duplicate, move, close others |
| Sidebar / projects | 006, 019, 027, 028, 032 | Add/remove projects, selection, session counts, project activity, sidebar toggle, project context menu, project identity colors |
| Window state | 007, 008, 014 | Sidebar width persistence, font zoom persistence, sidebar resize |
| Status bar | 009, 025, 030 | Project name, session type, terminal size, uptime, app version |
| Search | 010 | Open/close search bar, search input, find results |
| Close confirm | 016 | PTY cleanup on close |
| Shortcuts | 017 | Shortcut help overlay |
| Clipboard | 023 | Copy/paste |
| Select all | 026 | Select all text in terminal |
| Terminal links | 029 | Web link detection |
| Clear terminal | 022 | Cmd+K clear |
| Bell | 021 | Terminal bell visual indicator |
| Configuration | 033 | Settings tab, global/project scope, save/load config, schema |
| CLI invocation | 034 | Opening projects from CLI |
| Debug pane | 035 | Toggle, log entries, clear |
| npm start | 036 | Project path launch |
| Dark theme | 037 | Theme switching |
| Sound themes | 045, 046, 047 | Theme listing, install, duplicate, rename, delete, sound upload, trim, export |

### Coverage Gaps

1. **No unit tests**: There are zero unit tests for any renderer logic. All testing is E2E via Playwright. Functions like `getProjectColor`, `formatUptime`, `normalizeKeyEvent`, `formatKeyCombo`, `hashString`, and all the state management logic have no isolated tests.

2. **No component-level tests**: Since there are no components, there are no component tests. The only way to test sidebar rendering is to launch the entire Electron app.

3. **No mocking of IPC layer**: Every test hits the real main process. There are no tests that mock `window.electron_api` to test renderer behavior in isolation.

4. **Slow test execution**: Each test file launches a full Electron app. Even with 4 parallel workers, the suite is inherently slow.

5. **Fragile test helpers**: The `window._claudiu*` test helpers are tightly coupled to implementation details. Any refactoring of internal state shape breaks tests.

6. **No error scenario testing**: No tests verify what happens when IPC calls fail, when projects can't be opened, or when terminals fail to spawn.

7. **Limited overlay testing**: The project picker overlay, prompt overlay, and shortcut help overlay have basic open/close tests but limited interaction testing.

---

## Proposed Architecture

### Component Tree

```
<App>
  <ThemeProvider>
  <SessionProvider>
  <KeybindingProvider>
  <SoundProvider>
    <TitleBar>
      <SidebarToggle />
      <TabBar>
        <Tab /> (per visible session)
        <NewTabButton />
      </TabBar>
    </TitleBar>
    <AppBody>
      <SidebarTriggerZone />
      <Sidebar>
        <SidebarHeader />
        <ProjectList>
          <ProjectItem /> (per project)
        </ProjectList>
      </Sidebar>
      <SidebarResizeHandle />
      <MainArea>
        <TerminalContainer>
          <TerminalPanel /> (per session)
          <SettingsPanel />
          <EmptyState />
        </TerminalContainer>
        <SearchBar /> (conditional)
        <UpdateBanner /> (conditional)
        <DebugPaneResizeHandle />
        <DebugPane>
          <DebugPaneHeader />
          <DebugEntryList />
        </DebugPane>
      </MainArea>
    </AppBody>
    <StatusBar />

    <!-- Portaled overlays -->
    <ProjectPicker />
    <ShortcutHelp />
    <PromptOverlay />
  </SoundProvider>
  </KeybindingProvider>
  </SessionProvider>
  </ThemeProvider>
</App>
```

### State Management Approach

Use **React Context + useReducer** for global state, split into focused contexts:

| Context | State | Why |
|---------|-------|-----|
| `SessionContext` | `sessions` Map, `activeId`, MRU ordering | Central session state used by tabs, sidebar counts, terminal panels, status bar |
| `ProjectContext` | `projects` array, `selectedProjectPath`, `projectActivity` Set, MRU | Project list and selection, used by sidebar, tab filtering, settings |
| `ThemeContext` | `themeMode`, terminal theme colors | Theme switching, xterm theme sync |
| `SoundContext` | `soundCache`, current theme, playback | Sound playback on hook events |
| `KeybindingContext` | `keybindings` map, `actions` map | Data-driven keyboard dispatch |
| `UIContext` | `sidebarMode`, `sidebarWidth`, `debugPaneOpen`, `debugPaneHeight`, `fontSize` | Persisted UI layout state |

No external state library (Redux, Zustand, Jotai) is needed — Context + useReducer is sufficient for this scale.

### IPC Layer

Create a typed `useElectronAPI()` hook that wraps `window.electron_api`. This provides:
- A single abstraction point for all IPC calls
- Easy mocking in tests (swap the context provider)
- Type-safe access to the preload API

---

## Module/Component Breakdown (10 Concerns)

### 1. App Shell & Layout

**Responsibility**: Top-level component tree, provider nesting, layout structure.

**React components**:
- `<App>` — root component, nests all providers
- `<AppBody>` — flex layout for sidebar + main area
- `<TitleBar>` — drag region container for tabs and buttons

**What current code maps to**:
- `index.html` body structure (the static skeleton moves into JSX)
- `init()` function (becomes `useEffect` in `<App>`)
- CSS layout rules for `.app`, `.app-body`, `.titlebar-drag-region`

**Props / state / context**: Consumes all contexts. Renders the provider hierarchy.

---

### 2. Session Management (Context + Hooks)

**Responsibility**: Core state — sessions Map, active session, creating/closing/activating sessions, PTY lifecycle.

**React components / hooks**:
- `SessionContext` + `SessionProvider` — provides `sessions`, `activeId`, dispatch
- `useSession(id)` — returns a single session's state
- `useActiveSession()` — returns the currently active session
- `useSessions(projectPath)` — returns filtered sessions for a project
- `useCreateSession()` — returns a function to create a claude or terminal session
- `useCloseSession()` — returns a function to close and clean up a session

**What current code maps to**:
- `sessions` Map, `activeId`, `createSession()`, `closeTab()`, `activateTab()`
- `sessionsForProject()`, `countSessionsForProject()`, `restoreSessions()`
- `closeOtherTabs()`, `closeAllTabs()`
- IPC subscriptions: `api.terminal.onData`, `api.terminal.onExit`

**Props / state / context**: Own context. Depends on `ProjectContext` for `selectedProjectPath`. Depends on `UIContext` for `currentFontSize`.

---

### 3. Project Management (Context + Hooks)

**Responsibility**: Project list, selection, MRU ordering, project activity tracking.

**React components / hooks**:
- `ProjectContext` + `ProjectProvider`
- `useProjects()` — returns projects array and CRUD methods
- `useSelectedProject()` — returns selected project path and selector
- `useProjectMRU()` — returns MRU-ordered project paths
- `useProjectActivity()` — returns activity Set and updater

**What current code maps to**:
- `projects` array, `selectedProjectPath`, `projectMRU`, `projectActivity` Set
- `addProject()`, `removeProject()`, `selectProject()`, `cycleProject()`
- `refreshProjectList()`, `api.projects.onOpen` listener

**Props / state / context**: Own context. Consumed by `SessionContext`, Sidebar, TabBar, StatusBar, ProjectPicker.

---

### 4. Terminal & xterm.js Integration

**Responsibility**: xterm.js terminal lifecycle, fit addon, resize observer, PTY data flow, search addon, web links.

**React components / hooks**:
- `<TerminalPanel sessionId={id} />` — mounts/unmounts xterm.js into a div ref
- `useTerminal(id)` — manages Terminal instance, addons, resize observer, cleanup
- `<EmptyState />` — shown when no sessions exist for the selected project

**What current code maps to**:
- Terminal instantiation inside `createSession()`: `new Terminal(...)`, addon loading, `terminal.open(panelEl)`
- ResizeObserver setup and debounced PTY resize
- `onData` / `onBell` disposables
- Scrollbar style fixing (MutationObserver hack)
- `clearTerminal()`, `selectAll()`, `copySelection()`, `pasteClipboard()`
- `updateEmptyState()`, `getEmptyStateMessage()`

**Props / state / context**: Receives `sessionId` prop. Consumes `SessionContext` to get terminal instance. Consumes `UIContext` for font size. Exposes terminal ref for search addon access.

---

### 5. Tab Bar & Tab Management

**Responsibility**: Tab rendering, switching, drag-and-drop reorder, rename, context menu, activity indicators, bell animation.

**React components / hooks**:
- `<TabBar />` — container for visible tabs
- `<Tab sessionId={id} />` — individual tab with icon, label, close button, drag handlers
- `<NewTabButton />` — "+" button to create sessions
- `useTabDragDrop()` — encapsulates drag-and-drop state and DOM reordering
- `useTabRename(sessionId)` — inline rename logic

**What current code maps to**:
- Tab element creation in `createSession()` (lines 506-576)
- `activateTab()`, `goToTab()`, `cycleTab()`, `moveTab()`
- `startTabRename()`, drag event handlers, `clearDropIndicators()`
- `showTabContextMenu()` (via IPC context menu)
- Tab activity class (`tab-activity`), bell class (`tab-bell`)

**Props / state / context**: Consumes `SessionContext` for sessions and active ID. Consumes `ProjectContext` for filtering visible tabs. Dispatches to `SessionContext` on activate/close.

---

### 6. Sidebar & Project Picker

**Responsibility**: Project list sidebar, sidebar resize, autohide/pinned toggle, project picker overlay.

**React components / hooks**:
- `<Sidebar />` — sidebar container with header and project list
- `<ProjectItem project={p} />` — single project row with icon, name, count, remove button, context menu
- `<SidebarResizeHandle />` — drag-to-resize handle
- `<SidebarTriggerZone />` — hover zone for autohide reveal
- `<ProjectPicker />` — Cmd+E overlay with search input and MRU-sorted list
- `useSidebarResize()` — drag resize logic
- `useSidebarAutoHide()` — autohide/reveal/schedule-hide logic

**What current code maps to**:
- `renderSidebar()`, `updateProjectActivityBadge()`
- `selectProject()`, `cycleProject()`
- `initSidebarResize()`, `initSidebarAutoHide()`, `toggleSidebar()`, `revealSidebar()`, `hideSidebar()`, `scheduleSidebarHide()`
- `openProjectPicker()`, `closeProjectPicker()`, `renderPickerList()`
- `showProjectContextMenu()`

**Props / state / context**: Consumes `ProjectContext` and `SessionContext`. Consumes/dispatches `UIContext` for sidebar width and mode.

---

### 7. Overlays & Modals

**Responsibility**: Reusable overlay/modal pattern, plus specific overlays (shortcut help, prompt).

**React components / hooks**:
- `<Overlay onClose={fn} testId={string}>` — reusable backdrop with click-outside and Escape handling, portaled to `.app`
- `<ShortcutHelp />` — keyboard shortcuts reference overlay
- `<PromptOverlay message={string} defaultValue={string} onSubmit={fn} onCancel={fn} />` — replaces `window.prompt`
- `useOverlay()` — hook returning `{ isOpen, open, close }` for any overlay

**What current code maps to**:
- `showShortcutHelp()`, `closeShortcutHelp()` (lines 1318-1370)
- `showPromptOverlay()` (lines 164-227)
- `openProjectPicker()` overlay behavior (backdrop, Escape handling)
- Repeated overlay pattern across all three

**Props / state / context**: Standalone. Used by Settings (for prompt), Sidebar (for project picker), Keybinding context (for shortcut help). Renders via React portal.

---

### 8. Settings Panel

**Responsibility**: Settings tab UI — scope toggle, section navigation, General/Sounds/About sections, config save/load.

**React components / hooks**:
- `<SettingsPanel />` — top-level settings container (rendered as a tab panel)
- `<SettingsScopeBar />` — global vs. project toggle
- `<SettingsNav />` — left-hand section navigation
- `<GeneralSection />` — config fields from schema
- `<SoundsSection />` — sound theme selector, management buttons, event-sound table
- `<SoundEventRow event={name} />` — per-event row with play/upload/trim/remove
- `<TrimUI eventName={string} audioUrl={string} />` — WaveSurfer-based audio trimmer
- `<AboutSection />` — version and platform info
- `useSettingsState()` — local form state for global/project config edits

**What current code maps to**:
- `openSettings()`, `findSettingsTab()`, `renderSettingsTab()` (lines 1372-2089)
- `renderGeneralSection()`, `renderSoundsSection()`, `renderAboutSection()`
- `openTrimUI()` (lines 2092-2282) — entire WaveSurfer trim panel
- `ALL_HOOK_EVENTS` constant

**Props / state / context**: Consumes `ProjectContext` for selected project. Consumes `useElectronAPI()` for config CRUD and sound theme operations. Local state for form edits (not global context — only persisted on Save).

---

### 9. Keybindings, Theme & Persistence (Contexts)

**Responsibility**: Data-driven keyboard shortcuts, theme mode management, and persisted UI state (font size, sidebar dimensions, debug pane state).

**React components / hooks**:
- `KeybindingProvider` — registers document keydown listener, dispatches to action registry
- `useRegisterAction(name, handler)` — registers an action handler (called by each feature)
- `ThemeProvider` — manages `data-theme` attribute, xterm theme sync, OS preference listener
- `useTheme()` — returns current mode and `applyTheme(mode)` function
- `UIStateProvider` — manages persisted layout state (sidebar width/mode, font size, debug pane)
- `useUIState()` — returns and dispatches UI state changes
- `usePersistUIState()` — syncs UI state to main process via IPC

**What current code maps to**:
- `DEFAULT_KEYBINDINGS`, `keybindings`, `actions` Map, `normalizeKeyEvent()`, `document.addEventListener('keydown', ...)`
- `ACTION_LABELS`, `formatKeyCombo()`
- Theme: `DARK_TERMINAL_THEME`, `LIGHT_TERMINAL_THEME`, `getCurrentThemeMode()`, `getTerminalTheme()`, `applyThemeSetting()`
- Persistence: `currentFontSize`, `setFontSize()`, `zoomIn/Out/Reset()`, sidebar state vars, debug pane state vars
- `init()` state restoration from `api.windowState.*`

**Props / state / context**: Own contexts. `KeybindingProvider` consumes nothing — actions register themselves. `ThemeProvider` consumes `SessionContext` to update existing terminal themes. `UIStateProvider` consumes `useElectronAPI()`.

---

### 10. Debug Pane, Status Bar & Sound System

**Responsibility**: Debug log pane (toggle, entries, resize, clear), status bar info display, and sound theme playback.

**React components / hooks**:
- `<DebugPane />` — collapsible bottom pane with log entries
- `<DebugEntry entry={obj} />` — single log row
- `<DebugPaneResizeHandle />` — vertical resize handle
- `useDebugLog()` — manages entries array, auto-scroll, IPC subscription for new entries
- `<StatusBar />` — bottom bar showing project name, session type, uptime, terminal size, version, shortcut hints
- `useUptime(createdAt)` — ticking uptime display
- `<SoundProvider>` — context that loads sound theme, listens for hook events, plays sounds
- `useSoundCache()` — loads Audio objects from theme, handles trim playback

**What current code maps to**:
- `toggleDebugPane()`, `initDebugPaneResize()`, `addDebugEntry()`, `clearDebugPane()`, `formatLogTime()`, `updateDebugPaneCount()`
- `debugPaneOpen`, `debugPaneHeight`, `debugAutoScroll`, `debugPaneEntriesEl`
- `updateStatusBar()`, `formatUptime()`, `startUptimeTimer()`, `stopUptimeTimer()`, status element refs
- `soundCache`, `loadSoundTheme()`, `playEventSound()`, `initSoundTheme()`

**Props / state / context**: `DebugPane` consumes `UIContext` for open/height state. `StatusBar` consumes `ProjectContext`, `SessionContext`, `UIContext`. `SoundProvider` consumes `ProjectContext` for selected project, `useElectronAPI()` for hook events and theme loading.

---

## Tooling Changes

### New Dependencies

| Package | Purpose | Dev/Runtime |
|---------|---------|-------------|
| `react` (^19) | Component model | Runtime |
| `react-dom` (^19) | DOM rendering | Runtime |
| `@testing-library/react` | Component testing | Dev |
| `@testing-library/jest-dom` | DOM assertions | Dev |
| `vitest` or `jest` | Unit/component test runner | Dev |
| `jsdom` | DOM environment for unit tests | Dev |

### Build Pipeline Changes

**esbuild** already supports JSX natively. The build script (`scripts/build-renderer.js`) needs minimal changes:

```js
esbuild.buildSync({
  entryPoints: ['src/renderer/index.jsx'],  // or .tsx if TypeScript added later
  bundle: true,
  outfile: 'dist/renderer.bundle.js',
  platform: 'browser',
  format: 'iife',
  target: 'chrome120',
  sourcemap: true,
  jsx: 'automatic',           // React 19 JSX transform (no import React needed)
  jsxImportSource: 'react',   // automatic JSX factory from react/jsx-runtime
  loader: { '.js': 'jsx' },   // allow JSX in .js files during migration
});
```

No Babel, no webpack, no Vite required. esbuild handles JSX transformation with near-zero build time impact.

### HTML Changes

`index.html` will be reduced to a minimal shell:

```html
<body>
  <div id="root"></div>
  <script src="dist/renderer.bundle.js"></script>
</body>
```

All structural HTML (sidebar, tabs, empty state, debug pane, status bar) moves into React components.

### Test Infrastructure Changes

1. **Add unit/component test layer** alongside Playwright E2E:
   - `vitest` + `@testing-library/react` + `jsdom` for component tests
   - New `tests/unit/` directory for isolated tests
   - New `tests/components/` directory for React component tests with mocked IPC

2. **Mock `window.electron_api`** in component tests via a `TestElectronAPIProvider` that supplies fake implementations.

3. **Playwright E2E tests remain unchanged initially** — they interact with the rendered DOM via `data-testid`, which React components will preserve.

4. **Remove `window._claudiu*` test helpers** over time as component tests replace the need for internal state inspection. During migration, these helpers can live in a dedicated test-utils module.

---

## Migration Strategy

### Phase 0: Preparation (no behavior change)

1. Add `react` and `react-dom` to dependencies.
2. Update `build-renderer.js` to support JSX (add `jsx: 'automatic'`).
3. Add `vitest` and `@testing-library/react` to devDependencies.
4. Create the new directory structure:
   ```
   src/renderer/
     index.jsx              (entry point: ReactDOM.createRoot)
     App.jsx
     contexts/
     components/
     hooks/
     utils/
   ```
5. Move `projectColors.js` to `src/renderer/utils/projectColors.js`.
6. Extract pure utility functions (`formatUptime`, `formatKeyCombo`, `normalizeKeyEvent`, `hashString`, `formatLogTime`) into `src/renderer/utils/` and write unit tests for them.

### Phase 1: Bottom-up component extraction

Migrate leaf components first (no internal state dependencies):

1. **StatusBar** — pure display component, consumes context.
2. **DebugPane** + **DebugEntry** — self-contained, receives entries via context/props.
3. **EmptyState** — simple conditional render.
4. **Tab** — individual tab rendering (icon, label, close button).

At this phase, the "outer shell" is still vanilla JS, but it renders React subtrees into specific DOM containers using `createRoot()`.

### Phase 2: Context providers & state migration

1. Create `SessionContext`, `ProjectContext`, `UIStateContext`.
2. Migrate the global mutable state (`sessions`, `projects`, `activeId`, etc.) into context reducers.
3. Create `useElectronAPI()` hook wrapping `window.electron_api`.
4. Wire up IPC subscriptions as `useEffect` hooks in providers.

### Phase 3: Major component migration

1. **Sidebar** + **ProjectItem** — replaces `renderSidebar()`.
2. **TabBar** — replaces tab creation in `createSession()` and tab switching in `activateTab()`.
3. **TerminalPanel** — wraps xterm.js lifecycle in a React component with `useRef` + `useEffect`.
4. **ProjectPicker** overlay.

### Phase 4: Settings & overlays

1. **SettingsPanel** and all sub-components — the biggest single migration item.
2. **ShortcutHelp**, **PromptOverlay** — using the reusable `<Overlay>` component.
3. **TrimUI** — WaveSurfer integration as a React component.

### Phase 5: Full React takeover

1. Replace `index.html` static structure with React-rendered JSX.
2. Entry point becomes `ReactDOM.createRoot(document.getElementById('root')).render(<App />)`.
3. Remove all imperative DOM code from the old `index.js`.
4. Remove `window._claudiu*` test helpers, replacing with proper component tests.
5. Add component-level tests for each major component.

### Key Migration Principle

**At every phase, `npm run start` and `npm run test` must pass.** The existing Playwright E2E tests serve as a regression safety net. React components must produce the same DOM structure (same `data-testid` attributes, same CSS classes) so that E2E tests continue to work without modification during the migration.

---

## Benefits & Trade-offs

### Benefits

1. **Maintainability**: 2,866 lines of monolithic code splits into ~15-20 focused files, each under 200 lines. New features can be added by creating a component rather than editing the god-file.

2. **Testability**: React components can be tested in isolation with `@testing-library/react` in milliseconds, without launching Electron. The IPC layer can be mocked. Unit test coverage for business logic becomes trivial.

3. **Declarative UI**: React's declarative model eliminates the error-prone pattern of manually syncing DOM state with application state. The settings panel alone drops from ~650 lines of `createElement` chains to clean JSX.

4. **State management clarity**: Moving from ~30 scattered `let` variables to structured contexts with reducers makes state transitions explicit and debuggable. React DevTools provide free state inspection.

5. **Reusable patterns**: The `<Overlay>` component, `useElectronAPI()` hook, and context providers establish patterns that scale as features are added.

6. **Faster development velocity**: React's component model and hot module replacement (if added later) enable faster iteration than the current "edit monolith, rebuild, relaunch" cycle.

7. **Reduced coupling**: Features that currently cascade updates (`closeTab` -> `renderSidebar` -> `updateStatusBar`) become independent: each component re-renders when the context it consumes changes, with no explicit cross-feature calls.

### Trade-offs

1. **Bundle size increase**: React + ReactDOM adds ~45KB gzipped to the renderer bundle. In an Electron app loaded from disk, this is negligible (no network latency).

2. **Migration effort**: The incremental migration strategy spans multiple phases. During phases 1-3, the codebase will have a hybrid vanilla-JS + React architecture, which requires discipline to avoid confusion.

3. **xterm.js integration complexity**: xterm.js is an imperative library that manages its own DOM. Wrapping it in React requires careful `useRef` + `useEffect` patterns and explicit cleanup. This is a well-solved problem but requires attention.

4. **Learning curve**: If contributors are unfamiliar with React, contexts, and hooks, there is an onboarding cost. However, the patterns used here (Context, useReducer, useEffect, useRef) are standard React and well-documented.

5. **E2E test maintenance**: During migration, DOM structure must remain compatible with existing Playwright selectors. This constrains some React rendering decisions (e.g., must keep `data-testid` attributes, must not add wrapper divs that break CSS selectors).

6. **WaveSurfer integration**: The TrimUI component wraps a WaveSurfer instance, which has its own lifecycle. This requires careful mounting/unmounting coordination within React's lifecycle.

7. **No TypeScript (yet)**: This plan uses JSX, not TSX. Adding TypeScript is a natural follow-up but is out of scope for this refactoring to keep the change focused. The context and hook APIs are designed to be easily typed later.

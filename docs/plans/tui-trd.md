# Claudiu TUI — Technical Requirements Document

> Implementation blueprint for a terminal-native multi-session development
> environment, built with Node.js, React, Ink, node-pty, and @xterm/headless.

**Version:** 1.0
**Date:** 2026-03-07
**Source PRD:** [docs/plans/tui-prd.md](./tui-prd.md)

---

## Table of Contents

1. [Technology Stack](#1-technology-stack)
2. [Architecture Overview](#2-architecture-overview)
3. [The PTY Embedding Problem](#3-the-pty-embedding-problem)
4. [Project Structure](#4-project-structure)
5. [Component Architecture](#5-component-architecture)
6. [Service Layer](#6-service-layer)
7. [State Management](#7-state-management)
8. [Input Handling & Keybinding System](#8-input-handling--keybinding-system)
9. [Terminal Rendering Pipeline](#9-terminal-rendering-pipeline)
10. [Layout Engine](#10-layout-engine)
11. [Focus Management](#11-focus-management)
12. [Data Persistence](#12-data-persistence)
13. [Hook System](#13-hook-system)
14. [Notification System](#14-notification-system)
15. [Theming](#15-theming)
16. [Build & Distribution](#16-build--distribution)
17. [Testing Strategy](#17-testing-strategy)
18. [Performance Budget](#18-performance-budget)
19. [Known Limitations & Mitigations](#19-known-limitations--mitigations)
20. [Implementation Phases](#20-implementation-phases)

---

## 1. Technology Stack

### Core Runtime

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Runtime | Node.js | ≥20 | JavaScript execution |
| Language | TypeScript | ≥5.4 | Type safety across the entire codebase |
| UI Framework | Ink | 6.x | React-based terminal rendering |
| React | React | 18.x | Component model, hooks, reconciliation |
| Layout Engine | Yoga (via Ink) | WASM | Flexbox layout computation |
| PTY | node-pty | 1.x | Pseudo-terminal spawning (Linux, macOS, Windows) |
| Terminal Emulator | @xterm/headless | 6.x | Headless VT100/ANSI state machine |
| Bundler | esbuild | 0.27+ | Fast TypeScript compilation and bundling |
| Package Manager | npm | — | Dependency management |

### Key Libraries

| Library | Purpose |
|---------|---------|
| `fullscreen-ink` | Alternate screen buffer + fullscreen `<Box>` wrapper |
| `@inkjs/ui` | Pre-built input, select, spinner, badge components |
| `ink-text-input` | Text input with cursor (for search, rename, path entry) |
| `ink-select-input` | Arrow-key navigable list selection |
| `clipboardy` | Cross-platform clipboard read/write |
| `uuid` | Session and project ID generation |
| `zod` | Runtime config schema validation |
| `commander` | CLI argument parsing |
| `open` | Open URLs/paths in default browser/file manager |
| `strip-ansi` | ANSI escape sequence stripping (for search) |
| `chalk` | Color helpers (Ink uses chalk internally) |

### Dev Dependencies

| Library | Purpose |
|---------|---------|
| `vitest` | Unit and integration tests |
| `ink-testing-library` | Component-level Ink testing |
| `@playwright/test` | E2E tests (driving the TUI via PTY) |
| `@types/node` | Node.js type definitions |
| `biome` | Linting and formatting |

---

## 2. Architecture Overview

### Single-Process Model

Unlike the Electron app (main + renderer processes), the TUI runs as a single
Node.js process. There is no IPC bridge — services are called directly.

```
┌──────────────────────────────────────────────────────────────┐
│                    Node.js Process                           │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐     │
│  │               React / Ink UI Layer                  │     │
│  │                                                     │     │
│  │  <App>                                              │     │
│  │    <AppProvider>           (services context)       │     │
│  │      <ThemeProvider>       (dark/light)             │     │
│  │        <KeybindingProvider>(shortcut dispatch)      │     │
│  │          <FocusProvider>   (pane focus tracking)    │     │
│  │            <Layout>                                 │     │
│  │              <Sidebar />                            │     │
│  │              <MainArea>                             │     │
│  │                <TabBar />                           │     │
│  │                <TerminalPane />  ← active session   │     │
│  │                <DebugPane />                        │     │
│  │              </MainArea>                            │     │
│  │              <NotesPanel />                         │     │
│  │            </Layout>                                │     │
│  │            <StatusBar />                            │     │
│  │            <Overlays />                             │     │
│  │          </FocusProvider>                           │     │
│  │        </KeybindingProvider>                        │     │
│  │      </ThemeProvider>                               │     │
│  │    </AppProvider>                                   │     │
│  └─────────────────────────────────────────────────────┘     │
│                          │                                    │
│                     direct calls                              │
│                          │                                    │
│  ┌─────────────────────────────────────────────────────┐     │
│  │               Service Layer (singletons)            │     │
│  │                                                     │     │
│  │  ProjectService    ConfigService    LogService      │     │
│  │  TerminalService   HookService      NotesService    │     │
│  │  StateService      ThemeService     NotificationSvc │     │
│  └─────────────────────────────────────────────────────┘     │
│                          │                                    │
│  ┌─────────────────────────────────────────────────────┐     │
│  │               PTY Pool                              │     │
│  │                                                     │     │
│  │  PTY#1 (bash)  PTY#2 (claude)  PTY#3 (zsh)  ...   │     │
│  │       ↕              ↕               ↕              │     │
│  │  xterm#1         xterm#2         xterm#3            │     │
│  │  (headless)      (headless)      (headless)         │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                              │
│  ┌──────────────────┐                                        │
│  │  Hook HTTP Server │  (localhost, dynamic port)            │
│  └──────────────────┘                                        │
└──────────────────────────────────────────────────────────────┘
```

### Data Flow

```
User keystroke
  → stdin (raw mode)
  → KeybindingProvider (intercept app shortcuts)
  → if not intercepted → TerminalService.write(activeSessionId, rawBytes)
  → node-pty.write(data)
  → PTY process receives input

PTY output
  → node-pty.onData(chunk)
  → @xterm/headless.write(chunk)   ← ANSI parsing + state update
  → TerminalService emits 'output' event
  → TerminalPane re-renders (serializes xterm buffer → Ink <Text>)
  → Ink reconciler diffs → stdout
```

---

## 3. The PTY Embedding Problem

This is the single most critical technical challenge. Ink renders its own layout
to stdout and conflicts with raw PTY streams. No production Ink app has solved
embedded PTY rendering at scale.

### Chosen Solution: Headless Terminal Emulator

We use a **three-layer pipeline**:

```
node-pty (PTY) → @xterm/headless (emulator) → Ink <Text> (render)
```

1. **node-pty** spawns the child process with a real PTY
2. **@xterm/headless** processes the raw ANSI output, maintaining:
   - Screen buffer (viewport + scrollback)
   - Cursor position
   - Cell attributes (colors, bold, italic, underline, etc.)
   - Alternate screen mode (for vim, htop, etc.)
3. **Serializer** reads the xterm buffer and converts it to Ink-compatible output

### Serialization Strategy

```typescript
interface TerminalCell {
  char: string;
  fg: string | number;    // foreground color
  bg: string | number;    // background color
  bold: boolean;
  italic: boolean;
  underline: boolean;
  dim: boolean;
  inverse: boolean;
  strikethrough: boolean;
}

// Serialize a terminal buffer row into Ink <Text> elements
function serializeRow(buffer: IBuffer, row: number): InkElement {
  const spans: TextSpan[] = [];
  let currentSpan: TextSpan | null = null;

  for (let col = 0; col < buffer.cols; col++) {
    const cell = buffer.getLine(row)?.getCell(col);
    if (!cell) continue;

    const attrs = extractAttributes(cell);

    if (currentSpan && sameAttributes(currentSpan.attrs, attrs)) {
      currentSpan.text += cell.getChars() || ' ';
    } else {
      if (currentSpan) spans.push(currentSpan);
      currentSpan = { text: cell.getChars() || ' ', attrs };
    }
  }
  if (currentSpan) spans.push(currentSpan);

  return spans; // Each span becomes a <Text color={...} bold={...}>
}
```

### Performance Optimizations

| Optimization | Description |
|-------------|-------------|
| Dirty-line tracking | Only re-serialize lines that changed since last render |
| Span coalescing | Adjacent cells with same attributes merge into one `<Text>` |
| Render throttling | PTY output batched at 33ms intervals (~30fps, matching Ink) |
| Viewport-only render | Only serialize visible rows, not full scrollback |
| Memoization | `React.memo` on row components, keyed by line content hash |

### Adaptive Batching

```typescript
class OutputBatcher {
  private buffer: string = '';
  private timer: NodeJS.Timeout | null = null;
  private interval: number = 4;       // ms, baseline
  private bytesPerSecond: number = 0;

  onData(data: string) {
    this.buffer += data;
    this.bytesPerSecond += data.length;

    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.interval);
    }
  }

  private flush() {
    this.timer = null;
    const data = this.buffer;
    this.buffer = '';

    // Write accumulated data to xterm headless
    this.xterm.write(data);
    this.emit('render');

    // Adapt interval based on throughput
    if (this.bytesPerSecond > 32768) {
      this.interval = Math.min(32, this.interval * 2);
    } else if (this.bytesPerSecond < 4096) {
      this.interval = Math.max(4, this.interval / 2);
    }
  }
}
```

### Fallback: Raw Passthrough Mode

For maximum fidelity when a single terminal pane is maximized:

1. Suspend Ink rendering (`clear()`)
2. Exit alternate screen buffer
3. Pipe stdin/stdout directly to/from the PTY (zero overhead)
4. On prefix key (e.g., `Ctrl+B`), reclaim control and re-render Ink UI

This is optional and can be implemented as a later optimization.

---

## 4. Project Structure

```
claudiu-tui/
├── package.json
├── tsconfig.json
├── biome.json
├── esbuild.config.ts
├── bin/
│   └── claudiu-tui.ts              # CLI entry point
├── src/
│   ├── app.tsx                      # Root <App> component
│   ├── cli.ts                       # Commander setup, render() call
│   │
│   ├── components/                  # Ink UI components
│   │   ├── layout/
│   │   │   ├── Layout.tsx           # Top-level grid (sidebar + main + notes)
│   │   │   ├── Sidebar.tsx          # Project list panel
│   │   │   ├── MainArea.tsx         # Tab bar + content + debug
│   │   │   ├── TabBar.tsx           # Horizontal tab strip
│   │   │   ├── StatusBar.tsx        # Bottom info bar
│   │   │   ├── DebugPane.tsx        # Log viewer panel
│   │   │   └── NotesPanel.tsx       # Right-side notes editor
│   │   │
│   │   ├── terminal/
│   │   │   ├── TerminalPane.tsx     # PTY output renderer
│   │   │   ├── TerminalRow.tsx      # Single row of terminal output
│   │   │   ├── SearchBar.tsx        # Inline search overlay
│   │   │   └── EmptyState.tsx       # No-session placeholder
│   │   │
│   │   ├── overlays/
│   │   │   ├── ProjectPicker.tsx    # Fuzzy project finder (Ctrl+E)
│   │   │   ├── ShortcutHelp.tsx     # Keybinding reference (Ctrl+/)
│   │   │   ├── ContextMenu.tsx      # Action list overlay
│   │   │   └── ConfirmDialog.tsx    # Yes/No confirmation
│   │   │
│   │   ├── settings/
│   │   │   ├── SettingsTab.tsx      # Settings form container
│   │   │   ├── SettingsField.tsx    # Single config field renderer
│   │   │   └── ScopeToggle.tsx      # Global / Project scope switch
│   │   │
│   │   └── shared/
│   │       ├── ScrollView.tsx       # Virtual scrolling container
│   │       ├── TextInput.tsx        # Text input with cursor
│   │       ├── SelectInput.tsx      # Arrow-key list selection
│   │       └── Badge.tsx            # Activity/status badge
│   │
│   ├── hooks/                       # React hooks
│   │   ├── useTerminal.ts           # Terminal state for a session
│   │   ├── useKeybindings.ts        # Keybinding registration + dispatch
│   │   ├── useScreenSize.ts         # Terminal dimensions (resize-aware)
│   │   ├── useInterval.ts           # setInterval as a hook
│   │   ├── useDebounce.ts           # Debounced value/callback
│   │   ├── usePrevious.ts           # Previous value ref
│   │   └── useOverlay.ts            # Overlay open/close/toggle
│   │
│   ├── providers/                   # React context providers
│   │   ├── AppProvider.tsx          # Service instances context
│   │   ├── ThemeProvider.tsx        # Theme context (colors, styles)
│   │   ├── KeybindingProvider.tsx   # Shortcut dispatch context
│   │   └── FocusProvider.tsx        # Pane focus tracking context
│   │
│   ├── services/                    # Business logic (no React dependency)
│   │   ├── ProjectService.ts        # Project CRUD, persistence
│   │   ├── ConfigService.ts         # Global config, schema, resolution
│   │   ├── ProjectConfigService.ts  # Per-project config overrides
│   │   ├── TerminalService.ts       # PTY pool, xterm instances
│   │   ├── SessionService.ts        # Session lifecycle, persistence
│   │   ├── HookService.ts           # Hook HTTP server, emit script
│   │   ├── NotesService.ts          # Notes file I/O
│   │   ├── LogService.ts            # Ring buffer logger
│   │   ├── StateService.ts          # Window/layout state persistence
│   │   ├── NotificationService.ts   # Notification theme dispatch
│   │   └── ClipboardService.ts      # Clipboard read/write
│   │
│   ├── core/                        # Shared utilities
│   │   ├── types.ts                 # TypeScript type definitions
│   │   ├── constants.ts             # App-wide constants
│   │   ├── schema.ts                # Zod config schema
│   │   ├── projectColor.ts          # Deterministic color assignment
│   │   ├── keybindings.ts           # Default keybinding map
│   │   ├── serializer.ts            # xterm buffer → Ink element conversion
│   │   ├── batcher.ts               # Adaptive output batcher
│   │   └── paths.ts                 # App data directory resolution
│   │
│   └── themes/                      # Theme definitions
│       ├── dark.ts                  # Dark theme color map
│       ├── light.ts                 # Light theme color map
│       └── types.ts                 # Theme type definitions
│
├── assets/
│   └── notifications/               # Built-in notification themes
│       └── default/
│           └── theme.json
│
└── tests/
    ├── unit/                        # Service unit tests (vitest)
    │   ├── ConfigService.test.ts
    │   ├── ProjectService.test.ts
    │   ├── serializer.test.ts
    │   └── ...
    ├── components/                  # Component tests (ink-testing-library)
    │   ├── TabBar.test.tsx
    │   ├── Sidebar.test.tsx
    │   └── ...
    └── e2e/                         # E2E tests (Playwright)
        ├── session.test.ts
        ├── projects.test.ts
        └── ...
```

---

## 5. Component Architecture

### Component Hierarchy

```
<App>
├── <AppProvider services={...}>
│   ├── <ThemeProvider>
│   │   ├── <KeybindingProvider>
│   │   │   ├── <FocusProvider>
│   │   │   │   ├── <FullScreenBox>           ← fullscreen-ink
│   │   │   │   │   ├── <Layout>
│   │   │   │   │   │   ├── <Sidebar>
│   │   │   │   │   │   │   ├── <SidebarHeader>
│   │   │   │   │   │   │   └── <ProjectList>
│   │   │   │   │   │   │       └── <ProjectItem> × N
│   │   │   │   │   │   │
│   │   │   │   │   │   ├── <MainArea>
│   │   │   │   │   │   │   ├── <TabBar>
│   │   │   │   │   │   │   │   ├── <Tab> × N
│   │   │   │   │   │   │   │   └── <NewTabButton>
│   │   │   │   │   │   │   │
│   │   │   │   │   │   │   ├── <ContentArea>      ← flexGrow={1}
│   │   │   │   │   │   │   │   ├── <TerminalPane>  (if claude/terminal)
│   │   │   │   │   │   │   │   │   ├── <SearchBar>  (conditional)
│   │   │   │   │   │   │   │   │   └── <TerminalRow> × rows
│   │   │   │   │   │   │   │   ├── <NotesTab>      (if notes)
│   │   │   │   │   │   │   │   ├── <SettingsTab>   (if settings)
│   │   │   │   │   │   │   │   └── <EmptyState>    (if no session)
│   │   │   │   │   │   │   │
│   │   │   │   │   │   │   └── <DebugPane>        (conditional)
│   │   │   │   │   │   │
│   │   │   │   │   │   └── <NotesPanel>           (conditional)
│   │   │   │   │   │
│   │   │   │   │   └── <StatusBar>
│   │   │   │   │
│   │   │   │   └── <Overlays>                     (portal-like layer)
│   │   │   │       ├── <ProjectPicker>            (conditional)
│   │   │   │       ├── <ShortcutHelp>             (conditional)
│   │   │   │       ├── <ContextMenu>              (conditional)
│   │   │   │       └── <ConfirmDialog>            (conditional)
```

### Key Component Specifications

#### `<TerminalPane>`

The most complex component. Responsible for:

1. Subscribing to `TerminalService` output events for the active session
2. Reading the xterm headless buffer on each render
3. Serializing visible rows into `<TerminalRow>` components
4. Forwarding unhandled keystrokes to the PTY
5. Managing search state
6. Handling resize (debounced, 150ms)

```typescript
interface TerminalPaneProps {
  sessionId: string;
  isFocused: boolean;
  width: number;       // available columns
  height: number;      // available rows
}
```

#### `<TerminalRow>`

Memoized row component. Only re-renders when its content hash changes.

```typescript
interface TerminalRowProps {
  spans: TextSpan[];    // coalesced attribute spans
  rowIndex: number;
  searchMatches?: SearchMatch[];  // highlight positions
  isCursorRow: boolean;
  cursorCol?: number;
}
```

Uses `React.memo` with a custom comparator based on content hash.

#### `<Sidebar>`

```typescript
interface SidebarProps {
  mode: 'pinned' | 'autohide';
  width: number;
  projects: Project[];
  selectedProjectId: string | null;
  onSelect: (projectId: string) => void;
  onAdd: () => void;
}
```

Renders project items with:
- Colored markers (project color)
- Session count badges
- Activity indicators (background output detection)
- Keyboard navigation (up/down arrows when focused)

#### `<TabBar>`

Renders horizontally. Each tab is a `<Box>` with:
- Type icon: `[C]`, `[$]`, `[N]`, `[⚙]`
- Label text (truncated with `wrap="truncate"` if space is tight)
- Activity dot (blue `●` for background activity, brief flash for bell)
- Active tab distinguished by inverse colors or underline

#### `<StatusBar>`

Single row, flexDirection="row":
- Left: project name (project color), session type, uptime
- Right: terminal dimensions, app version
- Uses `<Spacer />` between left and right groups

#### `<SearchBar>`

Overlays the top of the terminal pane:
- Text input with `ink-text-input`
- Match counter: "N of M"
- Navigation: Enter (next), Shift+Enter (prev)
- Searches the xterm scrollback buffer using `strip-ansi` + substring match
- Highlights are rendered as inverse-color spans in `<TerminalRow>`

#### `<ProjectPicker>`

Full-screen overlay (absolute positioned, z-layered):
- Text input at top (fuzzy filter)
- Scrollable project list (virtual scrolling for 100+ projects)
- Each item: color marker + bold name + dim path
- Arrow key navigation, Enter to select, Escape to dismiss
- MRU ordering (most recently used first)

#### `<SettingsTab>`

Form rendered inside the content area (replaces terminal pane):
- Scope toggle: two buttons ("All Projects" / project name)
- For each schema field, renders appropriate control:
  - `string` → `<TextInput>`
  - `select` → `<SelectInput>`
  - `range` → text-based slider (`[===|----]` style)
  - `file` → `<TextInput>` with path
- Autosave on 400ms debounce after any change
- Singleton: only one settings tab, survives project switching

#### `<ScrollView>`

Custom component (Ink has no native scrolling):

```typescript
interface ScrollViewProps {
  height: number;
  children: React.ReactNode[];
  scrollOffset?: number;
  onScroll?: (offset: number) => void;
}
```

Implementation:
- Tracks `scrollOffset` in state
- Only renders `children.slice(scrollOffset, scrollOffset + height)`
- Up/Down arrow keys adjust offset
- Auto-scroll to bottom when new items added (unless user has scrolled up)

---

## 6. Service Layer

All services are plain TypeScript classes (no React dependency). They are
instantiated once at startup and passed to the UI via `<AppProvider>`.

### ServiceContainer

```typescript
class ServiceContainer {
  readonly log: LogService;
  readonly config: ConfigService;
  readonly projectConfig: ProjectConfigService;
  readonly project: ProjectService;
  readonly terminal: TerminalService;
  readonly session: SessionService;
  readonly hook: HookService;
  readonly notes: NotesService;
  readonly state: StateService;
  readonly notification: NotificationService;
  readonly clipboard: ClipboardService;

  async initialize(): Promise<void>;  // startup sequence
  async shutdown(): Promise<void>;    // cleanup sequence
}
```

### TerminalService

The core service. Manages the PTY pool and xterm headless instances.

```typescript
class TerminalService extends EventEmitter {
  // PTY + xterm instance map
  private sessions: Map<string, {
    pty: IPty;
    xterm: Terminal;  // @xterm/headless Terminal
    batcher: OutputBatcher;
  }>;

  // Create a new terminal session
  create(params: {
    sessionId: string;
    type: 'claude' | 'terminal';
    cwd: string;
    cols: number;
    rows: number;
    env?: Record<string, string>;
    command?: string;
    args?: string[];
  }): void;

  // Send input to a session's PTY
  write(sessionId: string, data: string): void;

  // Resize a session's PTY + xterm
  resize(sessionId: string, cols: number, rows: number): void;

  // Kill a session's PTY
  kill(sessionId: string): void;

  // Get the xterm buffer for rendering
  getBuffer(sessionId: string): IBuffer;

  // Get cursor position
  getCursor(sessionId: string): { row: number; col: number };

  // Search scrollback
  search(sessionId: string, query: string): SearchResult[];

  // Events
  on(event: 'output', listener: (sessionId: string) => void): this;
  on(event: 'exit', listener: (sessionId: string, code: number) => void): this;
  on(event: 'bell', listener: (sessionId: string) => void): this;

  // Active session count
  count(): number;
}
```

### ProjectService

```typescript
class ProjectService extends EventEmitter {
  private projects: Project[];
  private storePath: string;

  list(): Project[];
  add(path: string): Project;
  remove(path: string): void;
  select(path: string): void;
  getSelected(): Project | null;

  // Events
  on(event: 'added', listener: (project: Project) => void): this;
  on(event: 'removed', listener: (path: string) => void): this;
  on(event: 'selected', listener: (project: Project) => void): this;
}
```

### ConfigService

```typescript
class ConfigService {
  private schema: ConfigSchema[];
  private global: Record<string, unknown>;

  getSchema(): ConfigSchema[];
  getGlobal(): Record<string, unknown>;
  setGlobal(values: Record<string, unknown>): void;
  getProject(projectPath: string): Record<string, unknown>;
  setProject(projectPath: string, values: Record<string, unknown>): void;
  resolve<T>(key: string, projectPath?: string): T;
  resolveAll(projectPath?: string): Record<string, unknown>;
}
```

### HookService

```typescript
class HookService extends EventEmitter {
  private server: http.Server;
  private port: number;

  async start(): Promise<void>;           // Start HTTP server
  async installHooks(): Promise<void>;    // Write to ~/.claude/settings.json
  async removeHooks(): Promise<void>;     // Clean up
  async stop(): Promise<void>;            // Stop HTTP server

  // Events
  on(event: 'hook', listener: (event: HookEvent) => void): this;
}

interface HookEvent {
  hookName: string;
  sessionId: string;        // Claudiu session ID (from env)
  claudeSessionId?: string; // Claude's own session ID
  payload: unknown;
}
```

### LogService

```typescript
class LogService {
  private buffer: LogEntry[];
  private maxSize: number = 500;

  log(source: string, message: string, level?: 'info' | 'warn' | 'error'): void;
  getHistory(): LogEntry[];
  clear(): void;
  onEntry(callback: (entry: LogEntry) => void): () => void;  // returns unsubscribe
}
```

### StateService

Persists layout state (sidebar width, debug pane height, etc.) with debounced writes.

```typescript
class StateService {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;  // auto-saves with 300ms debounce
  async load(): Promise<void>;
  async save(): Promise<void>;
}
```

---

## 7. State Management

### Approach: React Context + Service Events

State is split into two categories:

1. **UI state** — managed in React via `useState` / `useReducer` within providers
2. **Domain state** — managed in services, surfaced to React via event subscriptions

### UI State (React)

```typescript
// In FocusProvider
const [focusedPane, setFocusedPane] = useState<PaneId>('terminal');
const [overlayStack, setOverlayStack] = useState<Overlay[]>([]);

// In Layout component
const [sidebarWidth, setSidebarWidth] = useState(30);
const [sidebarMode, setSidebarMode] = useState<'pinned' | 'autohide'>('pinned');
const [debugPaneHeight, setDebugPaneHeight] = useState(10);
const [debugPaneOpen, setDebugPaneOpen] = useState(false);
const [notesPanelWidth, setNotesPanelWidth] = useState(40);
const [notesPanelOpen, setNotesPanelOpen] = useState(false);
```

### Domain State (Services → React)

Custom hooks subscribe to service events:

```typescript
// useProjects.ts
function useProjects() {
  const { project } = useServices();
  const [projects, setProjects] = useState(project.list());
  const [selected, setSelected] = useState(project.getSelected());

  useEffect(() => {
    const onAdded = () => setProjects(project.list());
    const onRemoved = () => setProjects(project.list());
    const onSelected = (p: Project) => setSelected(p);

    project.on('added', onAdded);
    project.on('removed', onRemoved);
    project.on('selected', onSelected);

    return () => {
      project.off('added', onAdded);
      project.off('removed', onRemoved);
      project.off('selected', onSelected);
    };
  }, [project]);

  return { projects, selected };
}
```

### Tab/Session State

```typescript
interface TabState {
  id: string;               // session ID
  type: 'claude' | 'terminal' | 'notes' | 'settings';
  label: string;
  projectPath: string;
  hasActivity: boolean;
  hasBell: boolean;
  createdAt: number;
  claudeSessionId?: string;
}
```

Managed via `useReducer` in a `TabProvider`:

```typescript
type TabAction =
  | { type: 'ADD_TAB'; tab: TabState }
  | { type: 'REMOVE_TAB'; id: string }
  | { type: 'SET_ACTIVE'; id: string }
  | { type: 'RENAME_TAB'; id: string; label: string }
  | { type: 'MOVE_TAB'; id: string; direction: 'left' | 'right' }
  | { type: 'SET_ACTIVITY'; id: string; hasActivity: boolean }
  | { type: 'SET_BELL'; id: string; hasBell: boolean }
  | { type: 'CLEAR_ACTIVITY'; id: string };
```

---

## 8. Input Handling & Keybinding System

### Architecture

```
stdin (raw mode)
  ↓
Ink's internal input parser
  ↓
useInput() in KeybindingProvider (top-level, always active)
  ↓
Match against keybinding registry?
  ├── YES → dispatch action, stop propagation
  └── NO  → falls through to focused component's useInput()
              ↓
           TerminalPane? → forward raw bytes to PTY
           NotesTab?     → handle text editing
           Overlay?      → handle overlay-specific keys
```

### Keybinding Registry

```typescript
interface Keybinding {
  key: string;           // e.g., "ctrl+n", "ctrl+shift+w"
  action: string;        // action name, e.g., "newClaudeSession"
  category: string;      // for shortcut help grouping
  label: string;         // human-readable description
  when?: string;         // optional context condition
}

const defaultKeybindings: Keybinding[] = [
  { key: 'ctrl+n', action: 'newClaudeSession', category: 'Sessions', label: 'New Claude Session' },
  { key: 'ctrl+t', action: 'newTerminalSession', category: 'Sessions', label: 'New Terminal' },
  { key: 'ctrl+w', action: 'closeTab', category: 'Sessions', label: 'Close Tab' },
  // ... 28 total bindings (see PRD Appendix)
];
```

### Action Registry

```typescript
type ActionHandler = () => void;

class ActionRegistry {
  private handlers: Map<string, ActionHandler> = new Map();

  register(action: string, handler: ActionHandler): void;
  dispatch(action: string): boolean;  // returns true if handled
}
```

### Raw Input Forwarding

For PTY input, we need raw bytes, not Ink's parsed key objects. Solution:

```typescript
// In TerminalPane, when focused and no overlay is active
const { stdin, setRawMode } = useStdin();

useEffect(() => {
  if (!isFocused || overlayActive) return;

  const onData = (data: Buffer) => {
    // Check if this is an app keybinding first
    if (!keybindingProvider.wouldHandle(data)) {
      terminalService.write(sessionId, data.toString());
    }
  };

  stdin.on('data', onData);
  return () => stdin.off('data', onData);
}, [isFocused, overlayActive, sessionId]);
```

### Key Normalization

Terminal key sequences are normalized to canonical form:

| Raw Sequence | Normalized |
|-------------|-----------|
| `\x01` | `ctrl+a` |
| `\x1b[A` | `up` |
| `\x1b[1;5C` | `ctrl+right` |
| `\x1b[1;6C` | `ctrl+shift+right` |
| `\x0e` | `ctrl+n` |

### Conflict Resolution

Some keybindings conflict with terminal programs (e.g., `Ctrl+A` is "select all"
in our app but "go to line start" in bash). Resolution strategy:

1. Application keybindings are checked first
2. If a keybinding is registered AND the focused pane is a terminal, the binding
   takes priority
3. Users can remap keybindings via config to resolve personal conflicts
4. `Ctrl+A` specifically: we use it only when no session is active or in
   selection mode, otherwise it passes through to the PTY

---

## 9. Terminal Rendering Pipeline

### Full Pipeline (per render cycle)

```
1. PTY output arrives (node-pty onData)
   ↓
2. OutputBatcher accumulates chunks (4-32ms adaptive)
   ↓
3. Flush: write accumulated data to @xterm/headless
   ↓
4. xterm processes ANSI sequences, updates internal buffer
   ↓
5. TerminalService emits 'output' event with sessionId
   ↓
6. TerminalPane component re-renders (React state update)
   ↓
7. Serializer reads xterm buffer viewport (rows × cols)
   ↓
8. For each dirty row:
   a. Read cells left-to-right
   b. Coalesce adjacent cells with same attributes into spans
   c. Convert spans to <Text color={fg} backgroundColor={bg} bold={...}>
   ↓
9. React reconciler diffs against previous render
   ↓
10. Ink writes changes to stdout (ANSI escape codes)
```

### Buffer Reading

```typescript
function readViewport(xterm: Terminal): TerminalLine[] {
  const buffer = xterm.buffer.active;
  const lines: TerminalLine[] = [];

  for (let y = 0; y < xterm.rows; y++) {
    const bufferLine = buffer.getLine(buffer.viewportY + y);
    if (!bufferLine) {
      lines.push({ spans: [{ text: ' '.repeat(xterm.cols), attrs: DEFAULT_ATTRS }] });
      continue;
    }

    const spans = coalesceRow(bufferLine, xterm.cols);
    lines.push({ spans, dirty: bufferLine.isWrapped !== undefined });
  }

  return lines;
}
```

### Cursor Rendering

The cursor is rendered as an inverse-color cell at the cursor position:

```typescript
// In TerminalRow, if isCursorRow && cursorCol matches span position
<Text inverse>{cursorChar}</Text>
```

Cursor blink is handled by toggling inverse on a 500ms interval (using `useInterval`).

---

## 10. Layout Engine

### Ink's Yoga Flexbox

Every `<Box>` is `display: flex`. The entire layout is nested flex containers.

### Main Layout Structure

```typescript
function Layout() {
  const { width, height } = useScreenSize();
  const statusBarHeight = 1;
  const tabBarHeight = 1;
  const contentHeight = height - statusBarHeight;

  return (
    <Box flexDirection="column" width={width} height={height}>
      {/* Main content row */}
      <Box flexDirection="row" flexGrow={1}>

        {/* Sidebar (conditional) */}
        {sidebarVisible && (
          <Box width={sidebarWidth} flexDirection="column"
               borderStyle="single" borderRight borderTop={false}
               borderBottom={false} borderLeft={false}>
            <Sidebar />
          </Box>
        )}

        {/* Center area */}
        <Box flexDirection="column" flexGrow={1}>
          {/* Tab bar */}
          <Box height={tabBarHeight} flexDirection="row">
            <TabBar />
          </Box>

          {/* Content + Debug split */}
          <Box flexDirection="column" flexGrow={1}>
            {/* Active pane content */}
            <Box flexGrow={1} overflow="hidden">
              <ContentArea />
            </Box>

            {/* Debug pane (conditional) */}
            {debugPaneOpen && (
              <Box height={debugPaneHeight} borderStyle="single"
                   borderTop borderBottom={false}
                   borderLeft={false} borderRight={false}>
                <DebugPane />
              </Box>
            )}
          </Box>
        </Box>

        {/* Notes panel (conditional) */}
        {notesPanelOpen && (
          <Box width={notesPanelWidth} flexDirection="column"
               borderStyle="single" borderLeft borderTop={false}
               borderBottom={false} borderRight={false}>
            <NotesPanel />
          </Box>
        )}
      </Box>

      {/* Status bar */}
      <Box height={1} flexDirection="row">
        <StatusBar />
      </Box>
    </Box>
  );
}
```

### Available Space Calculation

The terminal pane needs to know its exact dimensions for PTY resize:

```typescript
function useAvailableSpace(
  screenWidth: number,
  screenHeight: number,
  sidebarVisible: boolean,
  sidebarWidth: number,
  notesPanelOpen: boolean,
  notesPanelWidth: number,
  debugPaneOpen: boolean,
  debugPaneHeight: number,
): { cols: number; rows: number } {
  // Subtract sidebar (width + 1 for border)
  let cols = screenWidth;
  if (sidebarVisible) cols -= sidebarWidth + 1;
  if (notesPanelOpen) cols -= notesPanelWidth + 1;

  // Subtract tab bar (1) + status bar (1)
  let rows = screenHeight - 2;
  if (debugPaneOpen) rows -= debugPaneHeight + 1; // +1 for border

  return { cols: Math.max(10, cols), rows: Math.max(5, rows) };
}
```

### Resize Handling

```typescript
function useResizeHandler(sessionId: string, cols: number, rows: number) {
  const { terminal } = useServices();
  const debouncedResize = useDebounce(
    (c: number, r: number) => terminal.resize(sessionId, c, r),
    150
  );

  useEffect(() => {
    debouncedResize(cols, rows);
  }, [cols, rows]);
}
```

### Panel Resize (Keyboard-Based)

Since Ink doesn't support mouse drag, panel resizing uses keyboard shortcuts:

```typescript
// Sidebar resize: Ctrl+Shift+< / Ctrl+Shift+>
// Or: when sidebar is focused, Left/Right arrows adjust width
registerAction('sidebarShrink', () => setSidebarWidth(w => Math.max(20, w - 2)));
registerAction('sidebarGrow', () => setSidebarWidth(w => Math.min(maxWidth, w + 2)));
```

---

## 11. Focus Management

### Focus Zones

```
┌─────────────────────────────────────────────┐
│ Zone: 'sidebar'  │  Zone: 'content'         │
│                  │                           │
│ (j/k navigate    │  (terminal input or       │
│  projects)       │   settings/notes focus)   │
│                  │                           │
│                  ├───────────────────────────│
│                  │  Zone: 'debug'            │
│                  │  (scroll log)             │
└─────────────────────────────────────────────┘
```

### Focus Context

```typescript
type FocusZone = 'sidebar' | 'content' | 'debug' | 'notes';

interface FocusContextValue {
  activeZone: FocusZone;
  setActiveZone: (zone: FocusZone) => void;
  isZoneFocused: (zone: FocusZone) => boolean;
}
```

### Focus Navigation

- `Tab` cycles between zones: sidebar → content → notes → debug → sidebar
- When an overlay is open, it captures all focus
- `Escape` from overlays returns to the previous zone

### Overlay Stack

Overlays (project picker, shortcut help, context menu, confirm dialog) are
rendered in a layer above the main layout. When active, they:

1. Capture all keyboard input
2. Render with absolute positioning over the main layout
3. Dismiss with Escape, returning focus to the previous zone

```typescript
interface OverlayState {
  type: 'projectPicker' | 'shortcutHelp' | 'contextMenu' | 'confirm';
  props?: unknown;
}

// Only one overlay at a time
const [overlay, setOverlay] = useState<OverlayState | null>(null);
```

---

## 12. Data Persistence

### App Data Directory

```typescript
function getAppDataDir(): string {
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin': return path.join(home, 'Library', 'Application Support', 'claudiu-tui');
    case 'win32':  return path.join(process.env.APPDATA || home, 'claudiu-tui');
    default:       return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'claudiu-tui');
  }
}
```

### File Layout

```
~/.local/share/claudiu-tui/        (Linux, XDG)
~/Library/Application Support/claudiu-tui/  (macOS)
├── projects.json                   # Project list
├── config.json                     # Global config
├── window-state.json               # Layout state
└── themes/                         # Notification themes
    └── default/
        └── theme.json

{projectPath}/.claudiu/
├── sessions.json                   # Project UUID + session history
├── config.json                     # Project config overrides
└── notes.md                        # Project notes
```

### Write Safety

All file writes use atomic write (write to temp file, then rename):

```typescript
async function atomicWrite(filePath: string, data: string): Promise<void> {
  const tempPath = `${filePath}.tmp.${process.pid}`;
  await fs.writeFile(tempPath, data, 'utf-8');
  await fs.rename(tempPath, filePath);
}
```

### Legacy Migration

On first startup, check for `.cct/` directories in known projects and rename
to `.claudiu/`.

---

## 13. Hook System

### Hook Server

A minimal HTTP server on `127.0.0.1` with a dynamic port:

```typescript
class HookService {
  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/hook') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          const event = JSON.parse(body);
          this.emit('hook', event);
          res.writeHead(200);
          res.end('ok');
        });
      }
    });

    // Bind to dynamic port
    await new Promise<void>(resolve => {
      this.server.listen(0, '127.0.0.1', resolve);
    });
    this.port = (this.server.address() as AddressInfo).port;
  }
}
```

### Emit Script

Installed at `~/.claude/claudiu-emit.sh`:

```bash
#!/bin/bash
curl -s -X POST "http://127.0.0.1:${CLAUDIU_HOOK_PORT}/hook" \
  -H "Content-Type: application/json" \
  -d "{
    \"hookName\": \"$1\",
    \"sessionId\": \"${CLAUDIU_SESSION_ID}\",
    \"claudeSessionId\": \"${CLAUDE_SESSION_ID:-}\",
    \"payload\": $(cat -)
  }" 2>/dev/null || true
```

### Hook Installation

Modifies `~/.claude/settings.json` to add command hooks:

```json
{
  "hooks": {
    "SessionStart": [
      { "type": "command", "command": "~/.claude/claudiu-emit.sh SessionStart" }
    ],
    "PostToolUse": [
      { "type": "command", "command": "~/.claude/claudiu-emit.sh PostToolUse" }
    ]
  }
}
```

### Cleanup

On shutdown (and on startup to clean stale hooks), the service:
1. Reads `~/.claude/settings.json`
2. Removes only hooks containing `claudiu-emit.sh`
3. Writes back the cleaned config
4. Deletes `~/.claude/claudiu-emit.sh`

---

## 14. Notification System

### TUI Adaptation

Since audio is unavailable, notifications use:

| Action | Implementation |
|--------|---------------|
| Terminal bell | Write `\x07` to stdout (triggers host terminal bell) |
| Tab flash | Set `hasBell: true` on tab, clear after 1 second |
| Status bar flash | Brief inverse-color flash on status bar |
| Activity badge | Persistent badge on background tabs/projects |

### Notification Theme Engine

```typescript
class NotificationService {
  private themes: Map<string, NotificationTheme>;
  private activeTheme: string | null = null;
  private muted: boolean = false;

  dispatch(hookName: string): void {
    if (this.muted || !this.activeTheme) return;
    const theme = this.themes.get(this.activeTheme);
    if (!theme?.events[hookName]) return;

    // Trigger visual notification
    this.emit('notify', { hookName, action: theme.events[hookName] });
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }
}
```

### Theme Management

- Built-in themes are read-only (bundled in `assets/notifications/`)
- Custom themes stored in `{appDataDir}/themes/`
- Copy-on-write: editing a built-in theme auto-forks to a custom copy
- Operations: list, duplicate, rename, delete, export (as JSON/ZIP)

---

## 15. Theming

### Theme Type

```typescript
interface Theme {
  name: string;

  // Backgrounds
  bgApp: string;
  bgSurface: string;
  bgOverlay: string;

  // Borders
  border: string;
  borderFocused: string;

  // Text
  textPrimary: string;
  textSecondary: string;
  textDim: string;

  // Semantic
  accent: string;
  danger: string;
  success: string;
  warning: string;

  // Tab
  tabActive: string;
  tabInactive: string;
  tabActivity: string;

  // Status bar
  statusBg: string;
  statusFg: string;
}
```

### Theme Provider

```typescript
const ThemeContext = createContext<Theme>(darkTheme);

function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { config } = useServices();
  const themeName = config.resolve<string>('theme');
  const theme = themeName === 'light' ? lightTheme : darkTheme;

  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
}

function useTheme(): Theme {
  return useContext(ThemeContext);
}
```

### Usage in Components

```typescript
function StatusBar() {
  const theme = useTheme();
  return (
    <Box>
      <Text backgroundColor={theme.statusBg} color={theme.statusFg}>
        {projectName}
      </Text>
    </Box>
  );
}
```

### Project Colors

16 colors, deterministic assignment via golden ratio hash:

```typescript
const PROJECT_PALETTE = [
  '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71',
  '#1abc9c', '#3498db', '#9b59b6', '#e91e63',
  '#ff5722', '#ff9800', '#cddc39', '#00bcd4',
  '#2196f3', '#673ab7', '#795548', '#607d8b',
];

function getProjectColor(name: string): string {
  const GOLDEN_RATIO = 0.618033988749895;
  let hash = 0;
  for (const char of name) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  const index = Math.floor(((Math.abs(hash) * GOLDEN_RATIO) % 1) * PROJECT_PALETTE.length);
  return PROJECT_PALETTE[index];
}
```

---

## 16. Build & Distribution

### Build Pipeline

```
TypeScript source
  → esbuild (bundle + transpile)
  → Single output file: dist/claudiu-tui.js
  → Shebang prepended: #!/usr/bin/env node
```

### esbuild Configuration

```typescript
// esbuild.config.ts
import { build } from 'esbuild';

await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/claudiu-tui.js',
  external: ['node-pty'],      // native addon, cannot be bundled
  banner: {
    js: '#!/usr/bin/env node',
  },
  sourcemap: true,
  minify: false,               // keep readable for debugging
});
```

### package.json Scripts

```json
{
  "name": "claudiu-tui",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "claudiu-tui": "./dist/claudiu-tui.js"
  },
  "scripts": {
    "build": "node esbuild.config.ts",
    "dev": "node --watch src/cli.ts",
    "start": "node dist/claudiu-tui.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "lint": "biome check src/",
    "lint:fix": "biome check --fix src/",
    "typecheck": "tsc --noEmit"
  }
}
```

### Distribution

| Method | Details |
|--------|---------|
| npm | `npm install -g claudiu-tui` (primary) |
| npx | `npx claudiu-tui /path/to/project` (zero-install) |
| Binary | pkg or bun compile for single-binary distribution |
| Homebrew | Formula pointing to npm or GitHub release |

### Native Dependency: node-pty

`node-pty` is a C++ addon that requires compilation. Mitigation:

- List as `optionalDependencies` for prebuilt binaries
- Use `node-pty-prebuilt-multiarch` if available for broader prebuilt coverage
- Document build prerequisites (Python 3, C++ compiler) for source compilation
- Consider fallback to `child_process.spawn` with `{ stdio: 'pipe' }` for
  degraded mode without PTY features (no resize, no alternate screen)

---

## 17. Testing Strategy

### Unit Tests (vitest)

Test services and utilities in isolation:

```typescript
// tests/unit/ConfigService.test.ts
describe('ConfigService', () => {
  it('resolves project override over global', () => {
    const config = new ConfigService(tempDir);
    config.setGlobal({ claudeCommand: 'claude' });
    config.setProject('/project', { claudeCommand: 'claude-dev' });

    expect(config.resolve('claudeCommand', '/project')).toBe('claude-dev');
  });

  it('falls back to schema default', () => {
    const config = new ConfigService(tempDir);
    expect(config.resolve('claudeCommand')).toBe('claude');
  });
});
```

Targets:
- `ConfigService` — resolution hierarchy, schema validation
- `ProjectService` — CRUD, persistence, deduplication
- `serializer` — xterm buffer → TextSpan conversion
- `projectColor` — deterministic assignment, distribution
- `batcher` — adaptive interval scaling
- `keybindings` — key normalization, matching

### Component Tests (ink-testing-library)

```typescript
// tests/components/TabBar.test.tsx
import { render } from 'ink-testing-library';

describe('TabBar', () => {
  it('renders tabs with correct labels', () => {
    const tabs = [
      { id: '1', label: 'Claude', type: 'claude', hasActivity: false },
      { id: '2', label: 'Terminal', type: 'terminal', hasActivity: false },
    ];

    const { lastFrame } = render(<TabBar tabs={tabs} activeId="1" />);
    expect(lastFrame()).toContain('[C] Claude');
    expect(lastFrame()).toContain('[$] Terminal');
  });

  it('shows activity indicator on background tab', () => {
    const tabs = [
      { id: '1', label: 'Claude', type: 'claude', hasActivity: false },
      { id: '2', label: 'Terminal', type: 'terminal', hasActivity: true },
    ];

    const { lastFrame } = render(<TabBar tabs={tabs} activeId="1" />);
    expect(lastFrame()).toContain('●');
  });
});
```

Targets:
- `<TabBar>` — rendering, active state, activity indicators
- `<Sidebar>` — project list, selection, session counts
- `<StatusBar>` — project name, session info, uptime, version
- `<SearchBar>` — input, match count, navigation
- `<ProjectPicker>` — fuzzy filter, selection
- `<SettingsTab>` — scope toggle, field rendering

### E2E Tests (Playwright)

Drive the full TUI via a spawned PTY:

```typescript
// tests/e2e/session.test.ts
test('creates a terminal session', async () => {
  const app = await launchApp(['--project', '/tmp/test-project']);

  // Wait for app to render
  await app.waitForText('Projects');

  // Send Ctrl+T (new terminal)
  app.sendKeys('\x14');  // Ctrl+T

  // Verify tab appears
  await app.waitForText('[$] Terminal');

  // Verify shell prompt
  await app.waitForText('$');

  await app.close();
});
```

E2E test harness:

```typescript
class AppDriver {
  private pty: IPty;
  private output: string = '';

  async launch(args: string[]): Promise<void>;
  sendKeys(data: string): void;
  async waitForText(text: string, timeout?: number): Promise<void>;
  getOutput(): string;
  async close(): Promise<void>;
}
```

### Test Isolation

- Each test creates a temp directory for app data and project data
- Tests clean up after themselves
- No shared state between tests
- Parallel execution: 4+ workers

### Coverage Targets

| Area | Target |
|------|--------|
| Services (unit) | 90%+ line coverage |
| Serializer (unit) | 95%+ (critical path) |
| Components (render) | All components have at least basic render tests |
| E2E | Happy path for all 17 PRD features |

---

## 18. Performance Budget

### Render Pipeline

| Stage | Budget | Measurement |
|-------|--------|-------------|
| PTY read → batcher | < 1ms | Time from `onData` to batcher accumulation |
| Batcher → xterm write | 4-32ms | Adaptive interval |
| xterm parse | < 5ms | Time for xterm.write() to complete |
| Buffer serialize | < 10ms | Full viewport serialization (200×50 worst case) |
| React reconcile | < 5ms | Diff + commit |
| Ink render to stdout | < 5ms | ANSI string generation + write |
| **Total pipeline** | **< 60ms** | End-to-end output latency |

### Input Pipeline

| Stage | Budget |
|-------|--------|
| stdin read → keybinding check | < 1ms |
| Keybinding dispatch (if match) | < 5ms |
| PTY write (if passthrough) | < 1ms |
| **Total input latency** | **< 5ms** |

### Memory

| Component | Budget |
|-----------|--------|
| Base app (no sessions) | < 50MB |
| Per terminal session | < 10MB (xterm buffer + PTY handle) |
| Scrollback per session (1000 lines) | ~2MB |
| 10 simultaneous sessions | < 150MB total |

### Startup

| Phase | Budget |
|-------|--------|
| Node.js bootstrap | < 100ms |
| Module load + service init | < 200ms |
| First render | < 200ms |
| **Total startup** | **< 500ms** |

---

## 19. Known Limitations & Mitigations

### Ink Limitations

| Limitation | Impact | Mitigation |
|-----------|--------|------------|
| No native scrolling | ScrollView must be built manually | Custom `<ScrollView>` with windowing |
| `overflow: hidden` clips only, no scroll | Content clipping without scroll | Manual viewport management |
| 30fps render cap | PTY output limited to ~30 updates/sec | Acceptable; matches most terminal emulators |
| No CSS grid | Complex layouts require nested flexbox | Design layout hierarchy carefully |
| No mouse events natively | Panel resize, click-to-focus not automatic | Keyboard-only resize; consider raw mouse escape sequence parsing |
| `<Text>` cannot contain `<Box>` | Terminal rows must be pure text | Each row is a flat `<Text>` with nested `<Text>` spans |
| `minWidth`/`minHeight` no percentages | Can't express "min 20% width" | Use absolute character counts |
| Borders consume content space | Border + content sizing is counter-intuitive | Account for border chars in space calculations |

### PTY Embedding Limitations

| Limitation | Impact | Mitigation |
|-----------|--------|------------|
| No direct PTY → stdout | Can't pipe PTY output directly into Ink layout | xterm/headless serialization pipeline |
| Serialization overhead | CPU cost per render of terminal content | Dirty-line tracking, span coalescing |
| Color precision | Host terminal may not support true color | Detect COLORTERM env, fall back to 256-color |
| Cursor positioning | Can't place real cursor in a sub-region | Rendered cursor (inverse char), real cursor hidden |
| Alternate screen programs | vim/htop in sub-terminals | xterm/headless handles alternate buffer; serialize it correctly |

### Terminal Compatibility

| Terminal | Status | Notes |
|----------|--------|-------|
| iTerm2 | Full support | True color, mouse, Unicode |
| macOS Terminal.app | Partial | 256 color only, limited Unicode |
| GNOME Terminal | Full support | True color, mouse, Unicode |
| Windows Terminal | Full support | True color, mouse, Unicode |
| tmux | Full support | True color with `Tc` terminfo |
| screen | Partial | 256 color, limited true color |
| SSH sessions | Varies | Depends on remote terminal |

---

## 20. Implementation Phases

### Phase 1: Foundation (Week 1-2)

**Goal:** Runnable TUI skeleton with one terminal session.

| Task | Details |
|------|---------|
| Project scaffolding | TypeScript, esbuild, Ink 6, biome |
| CLI entry point | Commander arg parsing, `render()` call |
| Fullscreen layout | `fullscreen-ink` wrapper, basic flexbox grid |
| TerminalService | node-pty spawn, xterm/headless integration |
| Serializer | xterm buffer → Ink `<Text>` conversion |
| TerminalPane | Render one terminal session, forward input |
| StatusBar | Static version number, terminal dimensions |

**Deliverable:** Launch app, see a shell prompt, type commands, see output.

### Phase 2: Multi-Session & Tabs (Week 3-4)

**Goal:** Multiple sessions with tab switching.

| Task | Details |
|------|---------|
| SessionService | Session lifecycle, ID generation |
| TabBar | Tab rendering, active state, navigation |
| Tab actions | Create (Ctrl+N/T), close (Ctrl+W), switch (Ctrl+1-9) |
| Tab reorder | Ctrl+Shift+Left/Right |
| Tab rename | Inline edit mode |
| Activity indicators | Background tab output detection |
| Bell handling | Tab flash on BEL character |
| KeybindingProvider | Data-driven shortcut registry |

**Deliverable:** Create multiple terminals, switch between them, see activity.

### Phase 3: Projects & Sidebar (Week 5-6)

**Goal:** Multi-project workspace with sidebar.

| Task | Details |
|------|---------|
| ProjectService | CRUD, persistence, project store |
| Sidebar | Project list, selection, session counts |
| Project scoping | Tabs filtered by selected project |
| Project colors | Deterministic palette assignment |
| Project picker | Fuzzy finder overlay (Ctrl+E) |
| Sidebar toggle | Pin/unpin mode (Ctrl+B) |
| Project activity | Background project badges |
| CLI invocation | `claudiu-tui /path` auto-adds project |
| StateService | Layout state persistence |

**Deliverable:** Add projects, switch between them, each with independent sessions.

### Phase 4: Configuration & Settings (Week 7-8)

**Goal:** Full configuration system.

| Task | Details |
|------|---------|
| ConfigService | Schema-driven config, global + project |
| SettingsTab | Form UI with scope toggle |
| Config resolution | Project → Global → Default cascade |
| Theme system | Dark/light themes, ThemeProvider |
| Claude command | Configurable claude command per project |

**Deliverable:** Open settings, configure per-project, see theme changes.

### Phase 5: Search, Notes, Debug (Week 9-10)

**Goal:** Remaining UI panels.

| Task | Details |
|------|---------|
| SearchBar | Terminal scrollback search (Ctrl+F) |
| NotesPanel | Right-side notes pane (Ctrl+L) |
| NotesService | File I/O, autosave with debounce |
| DebugPane | Log viewer (Ctrl+J) |
| LogService | Ring buffer, structured entries |
| Shortcut help | Overlay listing all keybindings (Ctrl+/) |
| Context menus | Tab and project context menus |
| Clipboard | Copy/paste integration |

**Deliverable:** Search terminal output, take notes, view debug logs.

### Phase 6: Hooks & Notifications (Week 11-12)

**Goal:** Claude Code integration.

| Task | Details |
|------|---------|
| HookService | HTTP server, emit script, installation |
| Hook events | All 17 event types from PRD |
| Session linking | Map Claude session ID to Claudiu session |
| Session resume | `--resume` flag for Claude sessions |
| NotificationService | Theme-based notification dispatch |
| Notification themes | Built-in + custom, COW editing |
| Mute toggle | Ctrl+M |

**Deliverable:** Hooks fire on Claude events, notifications flash in UI.

### Phase 7: Polish & Testing (Week 13-14)

**Goal:** Production readiness.

| Task | Details |
|------|---------|
| E2E test suite | Cover all 35 PRD test areas |
| Performance tuning | Profile render pipeline, optimize hot paths |
| Error handling | All error scenarios from PRD section 10 |
| Edge cases | Small terminals, 0 projects, 20+ tabs |
| Tab duplication | Duplicate session context menu action |
| Select all | Ctrl+A scrollback selection |
| Clear terminal | Ctrl+K buffer clear |
| Session uptime | Live-updating timer in status bar |
| npm packaging | `bin` field, `files` field, README |
| Crash recovery | Stale hook cleanup, PTY orphan detection |

**Deliverable:** Publishable v1.0.0 on npm.

---

*End of Technical Requirements Document.*

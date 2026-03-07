# Claudiu TUI — Product Requirements Document

> A terminal-native multi-session development environment for managing Claude Code
> and shell sessions across projects, designed to run in remote terminals without
> a graphical display server.

**Version:** 1.0
**Date:** 2026-03-07
**Source:** Derived from Claudiu Electron app (v0.7.0)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Goals & Non-Goals](#2-goals--non-goals)
3. [Architecture](#3-architecture)
4. [Core Concepts](#4-core-concepts)
5. [Feature Specifications](#5-feature-specifications)
   - 5.1 [Project Management](#51-project-management)
   - 5.2 [Session Management](#52-session-management)
   - 5.3 [Terminal Emulation](#53-terminal-emulation)
   - 5.4 [Tab System](#54-tab-system)
   - 5.5 [Sidebar / Project Panel](#55-sidebar--project-panel)
   - 5.6 [Notes](#56-notes)
   - 5.7 [Settings & Configuration](#57-settings--configuration)
   - 5.8 [Search](#58-search)
   - 5.9 [Debug / Log Pane](#59-debug--log-pane)
   - 5.10 [Status Bar](#510-status-bar)
   - 5.11 [Keyboard Shortcuts](#511-keyboard-shortcuts)
   - 5.12 [Hook Integration](#512-hook-integration)
   - 5.13 [Sound / Notification Themes](#513-sound--notification-themes)
   - 5.14 [Theming & Appearance](#514-theming--appearance)
   - 5.15 [Project Picker (Fuzzy Finder)](#515-project-picker-fuzzy-finder)
   - 5.16 [Context Menus](#516-context-menus)
   - 5.17 [Clipboard Operations](#517-clipboard-operations)
6. [Data Model](#6-data-model)
7. [Configuration Schema](#7-configuration-schema)
8. [Layout Specification](#8-layout-specification)
9. [Lifecycle & Startup](#9-lifecycle--startup)
10. [Error Handling & Recovery](#10-error-handling--recovery)
11. [Performance Requirements](#11-performance-requirements)
12. [Accessibility](#12-accessibility)
13. [Testing Strategy](#13-testing-strategy)
14. [Appendix: Keyboard Shortcut Reference](#14-appendix-keyboard-shortcut-reference)

---

## 1. Overview

Claudiu TUI is a terminal-native multiplexer and project organizer designed for
developers working with Claude Code. It provides:

- **Multi-project workspace** — manage multiple codebases, each with its own sessions
- **Tabbed sessions** — run multiple Claude Code instances, shell terminals, and
  note-taking sessions simultaneously within each project
- **Session persistence** — track and optionally resume Claude Code sessions
- **Hook integration** — receive real-time events from Claude Code (tool use,
  session lifecycle, notifications) and trigger actions
- **Remote-friendly** — runs entirely in a terminal, over SSH, in tmux, or in any
  environment without a display server

### Relationship to the Electron App

This spec describes a feature-complete TUI clone of the Claudiu Electron app.
Every user-facing feature of the Electron version is represented here, adapted
for a text-based terminal environment. Features that are inherently graphical
(window chrome, system tray, auto-updater, audio playback) are either dropped or
replaced with terminal equivalents.

---

## 2. Goals & Non-Goals

### Goals

| # | Goal |
|---|------|
| G1 | Run in any terminal (local, SSH, tmux, screen) without X11/Wayland |
| G2 | Feature parity with the Electron app for project/session management |
| G3 | Sub-50ms input latency for terminal passthrough |
| G4 | Persistent configuration and state across restarts |
| G5 | Extensible hook system for Claude Code event integration |
| G6 | Single binary or minimal dependency installation |
| G7 | Cross-platform (Linux, macOS, Windows via WSL) |

### Non-Goals

| # | Non-Goal | Rationale |
|---|----------|-----------|
| NG1 | Audio playback | No reliable cross-platform terminal audio; replaced by visual/bell notifications |
| NG2 | Auto-update mechanism | TUI apps distributed via package managers or manual download |
| NG3 | System tray / dock integration | No graphical shell available |
| NG4 | Waveform audio trim UI | Requires graphical rendering; out of scope |
| NG5 | Custom protocol handlers | No browser environment to register protocols |
| NG6 | macOS vibrancy / transparency | Terminal-only rendering |

---

## 3. Architecture

### Process Model

```
┌──────────────────────────────────────────────┐
│                 TUI Application              │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ UI Layer │  │ Services  │  │ PTY Pool  │  │
│  │ (TUI     │←→│ (Config,  │←→│ (Spawned  │  │
│  │  render)  │  │  Project, │  │  shells,  │  │
│  │          │  │  Hooks,   │  │  claude    │  │
│  │          │  │  Notes,   │  │  procs)    │  │
│  │          │  │  Log)     │  │           │  │
│  └──────────┘  └──────────┘  └───────────┘  │
│       ↕                            ↕         │
│  ┌──────────┐              ┌───────────┐     │
│  │ Terminal  │              │ Hook      │     │
│  │ Input/   │              │ Server    │     │
│  │ Output   │              │ (HTTP     │     │
│  └──────────┘              │  localhost)│     │
│                            └───────────┘     │
└──────────────────────────────────────────────┘
```

### Key Architectural Principles

1. **Single process** — All services, PTY management, and UI rendering run in one
   process (no Electron main/renderer split needed)
2. **PTY multiplexing** — Each session spawns a child PTY; the TUI captures and
   routes output to the correct virtual pane
3. **Service layer** — Business logic (config, projects, hooks, notes, logging)
   is decoupled from the UI layer
4. **Event-driven** — PTY data, hook events, and user input are processed via an
   event loop; UI re-renders only on state changes
5. **Adaptive output batching** — High-throughput PTY output is batched (4ms
   baseline, scaling to 32ms under load) to minimize render overhead

---

## 4. Core Concepts

### Project

A **project** is a directory on the filesystem that the user has registered.
Each project has:

- A stable UUID (generated on first registration, stored in `.claudiu/sessions.json`)
- Zero or more active sessions
- Optional per-project configuration overrides
- Optional notes file (`.claudiu/notes.md`)

### Session

A **session** is a running PTY process associated with a project. Session types:

| Type | Description |
|------|-------------|
| `claude` | A Claude Code process (`claude` command or configured alternative) |
| `terminal` | A user shell (bash, zsh, fish, sh) |
| `notes` | A text editor pane (no PTY, one per project) |
| `settings` | The configuration UI (no PTY, singleton) |

Each session has:
- A unique session ID (UUID)
- A terminal ID (integer, PTY handle)
- A type (`claude` | `terminal`)
- A creation timestamp
- An optional Claude session ID (linked via hooks after SessionStart)

### Tab

A **tab** represents a session in the tab bar. Tabs:
- Display an icon/label indicating type (Claude, Terminal, Notes, Settings)
- Can be renamed by the user
- Can be reordered via keyboard shortcuts
- Show activity indicators when background tabs receive output
- Are scoped to the currently selected project

### Configuration Hierarchy

```
Schema Default → Global Override → Project Override → Effective Value
```

---

## 5. Feature Specifications

### 5.1 Project Management

#### 5.1.1 Project List

- Maintained in a persistent store (`projects.json` in the app data directory)
- Each entry: `{ path: string, name: string }`
- Name derived from directory basename
- Deduplicated by absolute path

#### 5.1.2 Add Project

- **From UI:** Trigger a path input prompt (text input with filesystem completion
  if the TUI framework supports it, or a simple text field accepting an absolute path)
- **From CLI argument:** `claudiu-tui /path/to/project` adds and selects the project
- On first add, creates `.claudiu/sessions.json` with a new UUID

#### 5.1.3 Remove Project

- Removes from the project list (does not delete filesystem data)
- Closes all active sessions for that project
- Confirmation prompt if sessions are active

#### 5.1.4 Project Selection

- Clicking/selecting a project in the sidebar switches the visible tabs to that
  project's sessions
- Most Recently Used (MRU) ordering: the selected project moves to the top of
  the MRU list
- Keyboard navigation: Up/Down arrows in sidebar, or project picker overlay

#### 5.1.5 Project Identity

- Each project is assigned a color from a 16-color palette based on a hash of
  the project name (golden ratio distribution for even spread)
- The color is used for: sidebar icon, tab icon background, status bar accent,
  border/glow effects

#### 5.1.6 Per-Project Data

Stored in `{projectPath}/.claudiu/`:

| File | Purpose |
|------|---------|
| `sessions.json` | Project UUID + session history |
| `config.json` | Project-specific config overrides |
| `notes.md` | Project notes content |

Legacy `.cct/` directories are auto-migrated to `.claudiu/`.

---

### 5.2 Session Management

#### 5.2.1 Creating Sessions

- User selects a type (Claude, Terminal, or Notes) from the new-session menu
- For Claude and Terminal types:
  - A PTY is spawned with the project directory as CWD
  - Environment variables are injected:
    - `CLAUDIU_PROJECT_ID` — the project's stable UUID
    - `CLAUDIU_SESSION_ID` — the new session's UUID
  - Variables that could confuse nested detection are stripped (e.g., `CLAUDECODE`)
  - UTF-8 locale is enforced (`LANG=en_US.UTF-8`)
- For Claude type:
  - The configured `claudeCommand` is resolved (project override → global → "claude")
  - If resuming a previous session, `--resume` flag is appended with the Claude session ID
- The session is recorded in `.claudiu/sessions.json`

#### 5.2.2 Session Resume

- On project selection, previously recorded sessions are loaded
- The user can choose to resume Claude sessions (passing `--resume <sessionId>`)
- Fresh PTYs are spawned; it is not a process restore but a Claude-level resume

#### 5.2.3 Closing Sessions

- Close via tab close button, keyboard shortcut, or context menu
- The PTY process is killed (SIGTERM then SIGKILL)
- The session record is removed from `.claudiu/sessions.json`
- If no sessions remain, an empty state is displayed

#### 5.2.4 Command Allow-List

Only the following commands may be spawned as PTY processes:
- `claude` (or configured alternative)
- `bash`, `zsh`, `sh`, `fish`

Arbitrary command execution is rejected for security.

---

### 5.3 Terminal Emulation

#### 5.3.1 PTY Integration

- Each session spawns a real PTY (pseudo-terminal) child process
- The TUI application acts as a terminal multiplexer, routing PTY output to the
  active pane and forwarding user input to the active PTY
- PTY dimensions (cols, rows) are synchronized when:
  - The pane is first displayed
  - The terminal window is resized
  - The sidebar or other panels are toggled (changing available space)
  - Resize is debounced (150ms) to avoid SIGWINCH flooding

#### 5.3.2 Output Handling

- PTY output is read in chunks and buffered using adaptive batching:
  - Baseline: 4ms flush interval
  - Under heavy load (>32KB/sec): scales to 16ms then 32ms
  - Returns to 4ms during quiet periods
- Full ANSI/VT100 escape sequence support (colors, cursor movement, alternate
  screen, etc.)
- Bell character (0x07) triggers a visual indicator on the tab

#### 5.3.3 Input Handling

- User keystrokes are forwarded to the active PTY in real-time
- Application-level keybindings are intercepted before PTY forwarding
- Special sequences (Ctrl+C, Ctrl+D, Ctrl+Z) pass through to the PTY

#### 5.3.4 Terminal Features

| Feature | Description |
|---------|-------------|
| Unicode | Full Unicode 11+ support |
| True color | 24-bit color (if host terminal supports it) |
| Clickable links | URLs in output are highlighted; action to open in `$BROWSER` or copy |
| Scrollback | Configurable scrollback buffer |
| Search | Find text in scrollback (see 5.8) |
| Select & Copy | Selection mode for copying terminal output |
| Clear | Clear scrollback and screen |

---

### 5.4 Tab System

#### 5.4.1 Tab Bar

- Horizontal strip at the top of the main area (below the title area)
- Each tab displays:
  - An icon indicating type: `[C]` Claude, `[$]` Terminal, `[N]` Notes, `[*]` Settings
  - A label (default: session type name, user-renamable)
  - A close indicator `[x]`
- The active tab is visually distinguished (highlight/underline)
- Tabs are colored with the project's assigned color

#### 5.4.2 Tab Navigation

| Action | Shortcut |
|--------|----------|
| Next tab | `Ctrl+Right` or `Ctrl+Tab` |
| Previous tab | `Ctrl+Left` or `Ctrl+Shift+Tab` |
| Go to tab N (1-8) | `Ctrl+1` through `Ctrl+8` |
| Go to last tab | `Ctrl+9` |
| New Claude session | `Ctrl+N` |
| New Terminal session | `Ctrl+T` |
| Close active tab | `Ctrl+W` |
| Close other tabs | `Ctrl+Shift+W` |

#### 5.4.3 Tab Reordering

- `Ctrl+Shift+Left` / `Ctrl+Shift+Right` — move the active tab left/right
- Wraps around (first ↔ last)
- Reordering is project-scoped (tabs only move within their project)

#### 5.4.4 Tab Renaming

- Trigger: dedicated shortcut or context menu action
- Inline text input replaces the tab label
- Enter confirms, Escape cancels
- Empty input reverts to previous name

#### 5.4.5 Activity Indicators

- When a background tab receives PTY output, its tab shows an activity dot/marker
- Switching to that tab clears the indicator
- Bell events (0x07) trigger a brief flash animation on the tab

#### 5.4.6 Tab Duplication

- Available via context menu
- Creates a new session of the same type in the same project
- The new tab becomes active

---

### 5.5 Sidebar / Project Panel

#### 5.5.1 Layout

- Left-side vertical panel
- Default width: ~30 columns (adjustable)
- Contains:
  - Header: "Projects" label + "Add" action
  - Scrollable project list

#### 5.5.2 Project Items

Each project item displays:
- A colored marker (using project color)
- Project name (truncated if needed)
- Active session count (right-aligned)
- Activity indicator (pulsing dot when a background project has terminal activity)

#### 5.5.3 Sidebar Modes

1. **Pinned** (default)
   - Always visible
   - Width adjustable (min 20 cols, max ~50% of terminal width)
   - Resizable via keyboard or drag

2. **Auto-hide** (`Ctrl+B` toggle)
   - Sidebar collapses to 0 width
   - Revealed by a trigger (e.g., pressing a hotkey or moving focus to the edge)
   - Hides after focus leaves

#### 5.5.4 Sidebar Resize

- Keyboard shortcut or mouse drag on the resize border
- Active terminal pane re-fits on resize
- Width persisted in window state

#### 5.5.5 Project Navigation

| Action | Shortcut |
|--------|----------|
| Next project | `Ctrl+Down` |
| Previous project | `Ctrl+Up` |
| Project picker | `Ctrl+E` |
| Add project | `Ctrl+O` |

---

### 5.6 Notes

#### 5.6.1 Per-Project Notes

- One notes session per project
- Stored at `{projectPath}/.claudiu/notes.md`
- Plain text / markdown editing in a textarea-like pane
- Autosave with 1000ms debounce

#### 5.6.2 Notes Panel

- Toggle: `Ctrl+L`
- Appears as a right-side split pane (default ~40 columns)
- Resizable
- Width persisted in window state
- Auto-loads content when project changes

#### 5.6.3 Notes Tab

- Also accessible as a tab (like Claude/Terminal sessions)
- Shows a notes icon in the tab bar
- Only one notes tab per project

---

### 5.7 Settings & Configuration

#### 5.7.1 Settings Tab

- Opened via `Ctrl+,`
- Singleton (only one settings tab at a time)
- Two scope toggles:
  1. **All Projects** — edit global configuration
  2. **Current Project** — edit project-specific overrides
- Survives project switching (updates to reflect new project context)

#### 5.7.2 Configuration Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `claudeCommand` | string | `"claude"` | Command to launch Claude Code |
| `terminalCommand` | string | `""` | Default shell command (empty = system default) |
| `theme` | select | `"system"` | Color theme: `system`, `dark`, `light` |
| `notificationTheme` | string | `""` | Notification theme name (see 5.13) |
| `glowStyle` | select | `"glow"` | Project decoration style: `glow`, `border`, `none` |
| `glowIntensity` | range | `50` | Decoration intensity (0-100) |

#### 5.7.3 Configuration Files

| Scope | Location |
|-------|----------|
| Global | `{appDataDir}/config.json` |
| Per-project | `{projectPath}/.claudiu/config.json` |
| Schema | Defined in code, drives the settings UI |

#### 5.7.4 Settings UI

- Form-based: one control per config key
- Types: text input, select dropdown, range slider (rendered as text)
- Autosave with 400ms debounce
- Changes take effect immediately (theme changes re-render, command changes
  apply to new sessions)

---

### 5.8 Search

#### 5.8.1 Terminal Search

- Trigger: `Ctrl+F`
- Opens an inline search bar above or below the terminal pane
- Components:
  - Text input field
  - Match count display ("3 of 17")
  - Next/Previous navigation (Enter / Shift+Enter or arrow buttons)
- Searches the terminal scrollback buffer
- Highlights matches in the terminal output
- Escape closes the search bar and returns focus to the terminal

#### 5.8.2 Behavior

- Incremental search (updates as you type)
- Case-insensitive by default
- "No results" displayed when no matches found
- Re-triggering `Ctrl+F` when search is open focuses the existing input

---

### 5.9 Debug / Log Pane

#### 5.9.1 Purpose

- Displays structured application logs for troubleshooting
- Ring buffer of 500 entries maximum

#### 5.9.2 Layout

- Bottom panel, hidden by default
- Toggle: `Ctrl+J`
- Resizable (min 5 rows, max 50% of terminal height)
- Height persisted in window state

#### 5.9.3 Log Entries

Each entry displays:
- Timestamp (HH:MM:SS)
- Source (bracketed, e.g., `[TerminalService]`)
- Message
- Level-based coloring:
  - `info` — dim/default
  - `warn` — yellow
  - `error` — red

#### 5.9.4 Features

- Auto-scroll to newest entry (disabled when user scrolls up)
- Clear button to reset the buffer
- Entry count displayed in header

---

### 5.10 Status Bar

#### 5.10.1 Layout

- Single row at the bottom of the screen
- Sections (left to right):
  1. Project name (with project color)
  2. Session type indicator (Claude / Terminal / Notes / Settings)
  3. Session uptime (live-updating: "0s", "1m 23s", "1h 5m")
  4. Terminal dimensions (e.g., "120x40")
  5. App version (right-aligned)

#### 5.10.2 Behavior

- Updates in real-time as context changes
- Empty/hidden sections when no project or session is selected
- Uptime timer starts on session creation, clears on session close

---

### 5.11 Keyboard Shortcuts

#### 5.11.1 Shortcut System

- Data-driven: shortcuts defined as a mapping of key combination → action name
- Actions registered in a central action registry
- Key normalization: converts raw key events to canonical form (e.g., "Ctrl+Shift+N")
- Application shortcuts take priority over PTY input
- Standard text-editing keys (when in text input fields) are not intercepted

#### 5.11.2 Shortcut Help Overlay

- Trigger: `Ctrl+/`
- Modal overlay listing all registered keybindings
- Grouped by category
- Dismissible via Escape or clicking outside

#### 5.11.3 Default Keybindings

See [Appendix: Keyboard Shortcut Reference](#14-appendix-keyboard-shortcut-reference).

---

### 5.12 Hook Integration

#### 5.12.1 Claude Code Hooks

The application integrates with Claude Code's hook system to receive real-time
events from running Claude sessions.

#### 5.12.2 Supported Hook Events

| Event | Description |
|-------|-------------|
| `SessionStart` | Claude session has started |
| `SessionEnd` | Claude session has ended |
| `PreToolUse` | About to use a tool |
| `PostToolUse` | Tool use completed |
| `PostToolUseFailure` | Tool use failed |
| `PermissionRequest` | Permission requested from user |
| `Notification` | General notification |
| `SubagentStart` | Subagent spawned |
| `SubagentStop` | Subagent terminated |
| `PreCompact` | About to compact context |
| `ConfigChange` | Configuration changed |
| `UserPromptSubmit` | User submitted a prompt |
| `Stop` | Claude stopped |
| `TeammateIdle` | Teammate is idle |
| `TaskCompleted` | Task completed |
| `WorktreeCreate` | Git worktree created |
| `WorktreeRemove` | Git worktree removed |

#### 5.12.3 Hook Architecture

1. **Hook Server** — A local HTTP server bound to `127.0.0.1` on a dynamic port
2. **Emit Script** — A shell script (`claudiu-emit.sh`) installed in
   `~/.claude/` that POSTs hook events to the local server
3. **Hook Installation** — On startup, the app modifies `~/.claude/settings.json`
   to register command hooks that invoke the emit script
4. **Hook Cleanup** — On shutdown, all installed hooks and the emit script are removed
5. **Session Linking** — On `SessionStart`, the Claude session ID is linked to
   the Claudiu session ID for resume support

#### 5.12.4 Hook Event Handling

- Events are broadcast to the UI layer
- The UI can trigger actions based on events (e.g., notifications, visual indicators)
- Events include the hook name and the Claude session ID for routing

---

### 5.13 Sound / Notification Themes

> **TUI Adaptation:** Since audio playback is not reliably available in terminal
> environments, this feature is adapted to visual/bell notifications.

#### 5.13.1 Notification Theme System

- Themes define which hook events trigger notifications
- Each theme maps event names to notification actions
- Built-in themes are bundled; custom themes can be created

#### 5.13.2 Notification Actions (TUI Equivalents)

| Electron Feature | TUI Equivalent |
|-----------------|----------------|
| Sound playback | Terminal bell (BEL character) |
| Sound playback | Visual flash on tab/status bar |
| Audio trim UI | Not applicable (dropped) |

#### 5.13.3 Theme Management

- List installed themes
- Install from directory or archive
- Duplicate / rename / delete custom themes
- Built-in themes are read-only (copy-on-write: auto-fork on first edit)
- Configure which events trigger notifications
- Per-event enable/disable

#### 5.13.4 Mute Toggle

- `Ctrl+M` toggles all notifications
- Visual indicator shown briefly when toggling
- State is ephemeral (resets on restart)

---

### 5.14 Theming & Appearance

#### 5.14.1 Color Themes

Three modes:
1. **Dark** (default) — dark backgrounds, light text
2. **Light** — light backgrounds, dark text
3. **System** — follows terminal/OS preference if detectable, otherwise dark

#### 5.14.2 Dark Theme Colors

| Element | Color |
|---------|-------|
| Background | `#111111` (neutral gray) |
| Surface | `#171717` |
| Border | `#333333` |
| Text primary | `#d4d4d4` |
| Text secondary | `#b0b0b0` |
| Text dim | `#7a7a7a` |
| Accent | `#d4943c` (orange) |
| Danger | `#e85450` (red) |

#### 5.14.3 Light Theme Colors

| Element | Color |
|---------|-------|
| Background | `#f5f5f7` |
| Text primary | `#1a1a1a` |
| Accent | `#0066cc` (blue) |
| Danger | `#d32f2f` |

#### 5.14.4 Project Decorations

- **Glow style:** Colored border or glow effect around the active pane using
  the project's assigned color
- **Border style:** Colored line along the edges of the active pane
- **Intensity:** Configurable 0-100%
- Implementation uses terminal color capabilities (256-color or true-color)

#### 5.14.5 Project Color Palette

16 colors evenly distributed across the hue spectrum. Assignment is deterministic
based on project name hash (golden ratio scatter). Colors are used for:

- Sidebar project markers
- Tab indicators
- Status bar accents
- Pane border decorations

---

### 5.15 Project Picker (Fuzzy Finder)

#### 5.15.1 Trigger

- `Ctrl+E` opens the project picker overlay

#### 5.15.2 Behavior

- Full-screen or centered modal overlay
- Text input at the top for fuzzy filtering
- Project list below, ordered by MRU (most recently used first)
- Each item shows:
  - Project name (bold)
  - Full path (dim)
  - Project color marker
- Arrow keys navigate the list
- Enter selects and switches to the project
- Escape dismisses without action
- Typing filters the list in real-time (fuzzy substring match on name)

---

### 5.16 Context Menus

#### 5.16.1 Tab Context Menu

Triggered via a shortcut or right-click equivalent on a tab:

| Action | Description |
|--------|-------------|
| Duplicate | Create a new session of the same type |
| Rename | Enter rename mode for the tab label |
| Close | Close this tab |
| Close Others | Close all tabs except this one |
| Close All | Close all tabs in the current project |

"Close Others" is disabled when only one tab exists.

#### 5.16.2 Project Context Menu

Triggered via a shortcut or right-click equivalent on a project:

| Action | Description |
|--------|-------------|
| Reveal in File Manager | Open the project directory (if available) |
| Copy Path | Copy the project path to clipboard |
| Project Settings | Open settings scoped to this project |
| Remove | Remove project from the list |

---

### 5.17 Clipboard Operations

#### 5.17.1 Copy

- `Ctrl+Shift+C` — copy the current terminal selection to the system clipboard
- Works with the terminal's selection mechanism

#### 5.17.2 Paste

- `Ctrl+Shift+V` — paste from the system clipboard into the active terminal

#### 5.17.3 Select All

- `Ctrl+A` — select all text in the active terminal's scrollback buffer

---

## 6. Data Model

### 6.1 Project Store

**File:** `{appDataDir}/projects.json`

```json
{
  "projects": [
    { "path": "/home/user/my-project", "name": "my-project" },
    { "path": "/home/user/another-project", "name": "another-project" }
  ]
}
```

### 6.2 Project Config

**File:** `{projectPath}/.claudiu/sessions.json`

```json
{
  "projectId": "550e8400-e29b-41d4-a716-446655440000",
  "sessions": [
    {
      "id": "session-uuid",
      "terminalId": 1,
      "type": "claude",
      "createdAt": "2026-03-07T10:30:00Z",
      "claudeSessionId": "claude-assigned-id"
    }
  ]
}
```

### 6.3 Global Configuration

**File:** `{appDataDir}/config.json`

```json
{
  "claudeCommand": "claude",
  "terminalCommand": "",
  "theme": "dark",
  "notificationTheme": "default",
  "glowStyle": "glow",
  "glowIntensity": 50
}
```

### 6.4 Per-Project Configuration

**File:** `{projectPath}/.claudiu/config.json`

```json
{
  "claudeCommand": "claude-dev",
  "theme": "light"
}
```

Only keys that differ from global are stored.

### 6.5 Window State

**File:** `{appDataDir}/window-state.json`

```json
{
  "sidebarWidth": 30,
  "sidebarMode": "pinned",
  "fontSize": 14,
  "debugPaneHeight": 10,
  "debugPaneOpen": false,
  "notesPanelWidth": 40
}
```

### 6.6 Notes

**File:** `{projectPath}/.claudiu/notes.md`

Plain text content, no structured format.

### 6.7 Notification Themes

**Directory:** `{appDataDir}/themes/{theme-name}/`

```json
// theme.json
{
  "name": "Default Notifications",
  "version": "1.0.0",
  "author": "Claudiu",
  "description": "Default notification set",
  "builtIn": true,
  "events": {
    "SessionStart": "enabled",
    "PostToolUse": "enabled",
    "Notification": "enabled"
  }
}
```

---

## 7. Configuration Schema

The configuration system is **schema-driven**. The schema defines:

```
{
  key: string,           // Config key name
  type: "string" | "select" | "range" | "file",
  label: string,         // Human-readable label
  description: string,   // Help text
  default: any,          // Default value
  options?: string[],    // For select type
  min?: number,          // For range type
  max?: number,          // For range type
  placeholder?: string   // For string type
}
```

The schema is the single source of truth for:
1. Default values
2. Settings UI generation (controls rendered based on type)
3. Validation

Resolution order: **Project override → Global override → Schema default**

---

## 8. Layout Specification

### 8.1 Overall Layout

```
┌─────────────────────────────────────────────────────────────┐
│ [Tab1] [Tab2] [Tab3]                              [+]       │ ← Tab Bar
├──────────┬──────────────────────────────────┬───────────────┤
│          │                                  │               │
│ Projects │     Terminal / Notes / Settings   │  Notes Panel  │
│          │                                  │  (optional)   │
│ ───────  │                                  │               │
│ proj-1   │  $ claude                        │               │
│ proj-2 ● │  > How can I help?               │               │
│ proj-3   │  _                               │               │
│          │                                  │               │
│          │                                  │               │
│          ├──────────────────────────────────┤               │
│          │ [Debug Pane] (optional)          │               │
│          │ 10:30:45 [Hooks] SessionStart    │               │
│          │ 10:30:46 [Terminal] PTY created   │               │
├──────────┴──────────────────────────────────┴───────────────┤
│ my-project │ Claude │ 5m 23s │ 120×40 │              v0.7.0 │ ← Status Bar
└─────────────────────────────────────────────────────────────┘
```

### 8.2 Panel Sizes

| Panel | Default | Min | Max |
|-------|---------|-----|-----|
| Sidebar | 30 cols | 20 cols | 50% of width |
| Notes panel | 40 cols | 20 cols | 50% of width |
| Debug pane | 10 rows | 5 rows | 50% of height |
| Tab bar | 1 row | — | — |
| Status bar | 1 row | — | — |

### 8.3 Panel Visibility

| Panel | Default | Toggle |
|-------|---------|--------|
| Sidebar | Visible (pinned) | `Ctrl+B` |
| Notes panel | Hidden | `Ctrl+L` |
| Debug pane | Hidden | `Ctrl+J` |
| Tab bar | Always visible | — |
| Status bar | Always visible | — |

### 8.4 Empty State

When no sessions exist for the selected project, the main area displays:

- Project name (large, centered)
- Action cards:
  - "New Claude Session" (`Ctrl+N`)
  - "New Terminal" (`Ctrl+T`)
  - "Open Notes" (`Ctrl+L`)
- Each card shows the keyboard shortcut
- Cards are bordered with the project color

---

## 9. Lifecycle & Startup

### 9.1 Startup Sequence

1. **Parse CLI arguments** — extract optional project path
2. **Initialize app data directory** — create if missing; migrate legacy paths
3. **Single-instance check** — if already running, signal the existing instance
   to open the requested project, then exit
4. **Start services** (in order):
   a. Log Service (ring buffer)
   b. Notification Theme Service (seed bundled themes)
   c. Project Config Service
   d. Hook Server (start HTTP listener on dynamic localhost port)
   e. Install Claude Code hooks (modify `~/.claude/settings.json`)
   f. Config Service (load global config)
   g. Window State Service (load persisted layout)
   h. Project Store (load project list)
5. **Initialize UI** — render the TUI layout
6. **Open CLI project** — if a path was provided, add/select it

### 9.2 Shutdown Sequence

1. **Check for active sessions** — if any, prompt user for confirmation
2. **Remove Claude Code hooks** — clean up `~/.claude/settings.json`
3. **Stop Hook Server** — close HTTP listener
4. **Kill all PTYs** — SIGTERM to all child processes
5. **Flush state** — save window state, config, etc.
6. **Exit**

### 9.3 Crash Recovery

- Uncaught exceptions are caught and logged
- PTY processes are cleaned up on abnormal exit (best-effort)
- Stale hooks in `~/.claude/settings.json` are detected and removed on next startup

---

## 10. Error Handling & Recovery

| Scenario | Behavior |
|----------|----------|
| PTY spawn failure | Log error, show message in tab, do not create session |
| PTY unexpected exit | Auto-close the tab, log exit code |
| Config file corrupt | Fall back to defaults, log warning |
| Config file missing | Create with defaults |
| Hook server port conflict | Retry with new dynamic port |
| Hook install failure | Log error, continue without hooks |
| Filesystem permission error | Show error message, continue |
| Notes file read error | Return empty content, log warning |

---

## 11. Performance Requirements

| Metric | Target |
|--------|--------|
| Input-to-PTY latency | < 5ms |
| PTY output render latency | < 50ms (steady state) |
| Tab switch time | < 16ms |
| Project switch time | < 100ms |
| Startup time (no projects) | < 500ms |
| Memory per idle session | < 5MB |
| Adaptive batch ceiling | 32ms under heavy load |

---

## 12. Accessibility

### 12.1 Keyboard-First Design

- Every feature is accessible via keyboard shortcuts
- No mouse-only interactions (all menus navigable via keyboard)
- Modal overlays support Escape to dismiss

### 12.2 Focus Management

- Opening a modal focuses its input field
- Closing a modal returns focus to the previously active pane
- Tab navigation follows logical order

### 12.3 Screen Reader Considerations

- Status bar text is semantic (not decorative)
- Log entries have structured format (timestamp, source, message)
- State changes (mute toggle, theme switch) produce text feedback

---

## 13. Testing Strategy

### 13.1 Test Categories

| Category | Description |
|----------|-------------|
| Unit | Service logic (config resolution, project store, hooks) |
| Integration | PTY spawn + output capture, hook server + emit script |
| E2E | Full TUI interaction (launch, create sessions, switch projects) |
| Regression | Each feature step has regression tests for prior steps |

### 13.2 Test Infrastructure

- Tests run headlessly (no display needed)
- Isolated app data directory per test (no cross-contamination)
- Mock or sandboxed Claude command for CI environments
- Parallel test execution (4+ workers)
- 10-second per-test timeout

### 13.3 Coverage Areas (from Electron test suite, 45 files, 200+ tests)

1. **App lifecycle** — launch, window creation, clean shutdown
2. **Security** — context isolation, no leaked internals
3. **Terminal/PTY** — spawn, output, resize, exit, orphan cleanup
4. **Claude sessions** — launch, UI rendering, ANSI support, help command
5. **Tabs** — create, switch, close, preserve state, empty state
6. **Sidebar** — project list, selection, session scoping, resize, auto-hide
7. **Window state** — persistence, restore, debounced saves
8. **Status bar** — project name, session type, uptime, dimensions, version
9. **Search** — open, find, navigate, close, focus management
10. **Tab context menu** — duplicate, close, close others, close all
11. **Tab reorder** — drag left/right, visual feedback
12. **Tab rename** — double-click, enter, escape, blur, empty revert
13. **Font zoom** — increase, decrease, reset, min/max bounds, persistence
14. **Activity indicators** — background tab output, clear on switch
15. **Close confirmation** — terminal count tracking, graceful shutdown
16. **Shortcut help** — overlay display, keybinding list, dismiss
17. **Tab number shortcuts** — Ctrl+1-8, Ctrl+9 for last
18. **Project activity** — background project badges, clear on switch
19. **Tab duplication** — same type, becomes active, count updates
20. **Terminal bell** — flash animation, active tab exclusion
21. **Clear terminal** — Ctrl+K, buffer cleared, still functional
22. **Clipboard** — read/write, paste into terminal, copy selection
23. **Move tab** — left/right with wrap
24. **Session uptime** — format, live update, clear on close
25. **Select all** — full scrollback selection
26. **Sidebar toggle** — pin/unpin, resize handle visibility
27. **Project context menu** — reveal, copy path, settings, remove
28. **Terminal links** — URL detection, open external
29. **App version** — display, match package.json
30. **Configuration** — settings UI, global/project scope, persistence, resolution
31. **CLI invocation** — auto-add project, auto-select
32. **Debug pane** — toggle, resize, log entries, clear
33. **Dark/light theme** — color variables, inheritance, no bleed-through
34. **Notification themes** — COW, fork, duplicate, rename, delete, export
35. **Settings project switch** — scope updates, single tab, state persistence

---

## 14. Appendix: Keyboard Shortcut Reference

| Shortcut | Action | Category |
|----------|--------|----------|
| `Ctrl+N` | New Claude session | Sessions |
| `Ctrl+T` | New Terminal session | Sessions |
| `Ctrl+W` | Close active tab | Sessions |
| `Ctrl+Shift+W` | Close other tabs | Sessions |
| `Ctrl+E` | Project picker | Projects |
| `Ctrl+O` | Add project | Projects |
| `Ctrl+Up` | Previous project | Projects |
| `Ctrl+Down` | Next project | Projects |
| `Ctrl+Left` | Previous tab | Tabs |
| `Ctrl+Right` | Next tab | Tabs |
| `Ctrl+1` – `Ctrl+8` | Go to tab 1–8 | Tabs |
| `Ctrl+9` | Go to last tab | Tabs |
| `Ctrl+Shift+Left` | Move tab left | Tabs |
| `Ctrl+Shift+Right` | Move tab right | Tabs |
| `Ctrl+F` | Find in terminal | Search |
| `Ctrl+=` / `Ctrl+-` | Zoom in / out | Display |
| `Ctrl+0` | Reset zoom | Display |
| `Ctrl+K` | Clear terminal | Terminal |
| `Ctrl+Shift+C` | Copy selection | Clipboard |
| `Ctrl+Shift+V` | Paste | Clipboard |
| `Ctrl+A` | Select all | Clipboard |
| `Ctrl+B` | Pin/unpin sidebar | Layout |
| `Ctrl+L` | Toggle notes panel | Layout |
| `Ctrl+J` | Toggle debug pane | Layout |
| `Ctrl+,` | Open settings | Config |
| `Ctrl+/` | Show shortcut help | Help |
| `Ctrl+M` | Toggle mute | Notifications |

> **Note:** On macOS terminals, `Ctrl` may need to be mapped to `Cmd` or
> alternate bindings depending on the terminal emulator's key handling.
> The TUI should support configurable keybindings.

---

*End of specification.*

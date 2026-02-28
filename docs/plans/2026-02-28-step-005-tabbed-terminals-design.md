# Step 005 — Tabbed Terminal Area Design

## Summary

Add a tab bar supporting multiple concurrent terminal sessions. Each tab owns an xterm.js instance connected to its own PTY. Switching tabs toggles visibility; terminal state is preserved naturally.

## Decisions

- **Approach**: Show/hide containers (one xterm per tab, toggle `display`)
- **New tab trigger**: `+` button in tab bar + Cmd+T shortcut
- **Tab label**: "Session N" (sequential counter)
- **Last tab closed**: Auto-create a new session (app always has >= 1 tab)

## Architecture

### No main process changes

The existing `TerminalService` already manages multiple PTYs via `Map<id, pty>`. The existing IPC API (`terminal-create`, `terminal-kill`, `terminal-count`, `terminal-input`, `terminal-resize`, `terminal-onData`, `terminal-onExit`) covers all needs.

### Renderer refactor

`src/renderer/index.js` becomes a tab manager with state:

- `sessions: Map<id, { terminal, fitAddon, panelEl, tabEl, cleanup }>` — per-tab resources
- `activeId: number` — currently visible tab
- `sessionCounter: number` — label counter

Key functions:
- `createSession()` — IPC create PTY, instantiate xterm, build DOM, wire I/O, activate
- `activateTab(id)` — hide all panels, show target, fit, update tab highlight
- `closeTab(id)` — kill PTY, dispose xterm, remove DOM, activate neighbor or auto-create

### HTML structure

```html
<div class="app">
  <div class="titlebar-drag-region"></div>
  <div class="tab-bar" data-testid="tab-bar">
    <!-- tab items injected here -->
    <button class="tab-new-btn" data-testid="new-tab-btn">+</button>
  </div>
  <div id="terminals" class="terminals-container">
    <!-- one .terminal-panel per tab -->
  </div>
</div>
```

### Tab DOM per session

```html
<div class="tab-item active" data-testid="tab" data-tab-id="1">
  <span class="tab-label">Session 1</span>
  <button class="tab-close" data-testid="tab-close">&times;</button>
</div>
```

### CSS additions

- `.tab-bar`: horizontal flex, between titlebar and terminals, dark background, no drag region
- `.tab-item`: pill shape, label + close button, active state highlighted
- `.tab-new-btn`: `+` icon at end of tab bar
- `.terminal-panel`: absolute fill inside `.terminals-container`, `display: none` by default, `display: flex` when active
- `.terminals-container`: `position: relative; flex: 1`

### Buffer text helper

`window._cctGetBufferText()` returns active tab's buffer. Optionally accepts an ID parameter for targeted reads during tests.

### Keyboard shortcut

`document.addEventListener('keydown')` — Cmd+T calls `createSession()`, with `preventDefault()` to avoid browser default.

## Test Alignment (10 tests from STEPS.md)

1. Launch → 1 tab exists (`[data-testid="tab"]` count = 1)
2. New session action → count = 2
3. Each tab has visible label
4. Click tab 1 → its terminal visible, tab 2 hidden
5. Click tab 2 → visible, tab 1 hidden
6. Type marker in tab 1, switch away, switch back → marker in buffer
7. Close tab 2 → count = 1
8. Closed tab's PTY gone (terminal-count = 1)
9. Close last tab → no crash, auto-creates new tab
10. Step 004 tests still pass

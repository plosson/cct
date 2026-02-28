# Step 005 — Tabbed Terminal Area

## What was done

Added a tab bar to the Electron app supporting multiple concurrent terminal sessions. Each tab owns an independent xterm.js instance connected to its own PTY process.

**Files created:**
- `tests/step-005-tabbed-terminals.spec.js` — 10 Playwright e2e tests

**Files modified:**
- `index.html` — replaced single `#terminal-container` with `.tab-bar` + `#terminals` container
- `styles/base.css` — added tab bar, tab item, and terminal panel CSS; removed old `.terminal-container`
- `src/renderer/index.js` — complete rewrite from single-terminal to multi-session tab manager
- `tests/step-003-xterm-shell.spec.js` — updated exit test selector for new DOM structure

**No main process changes** — `TerminalService`, `terminal.ipc.js`, and `preload.js` unchanged.

## Choices made

**Show/hide approach over buffer serialization**: Each tab gets its own `<div class="terminal-panel">` with a dedicated xterm.js Terminal instance. Switching tabs toggles `display: none/flex`. The alternative — serializing and replaying terminal buffers — was rejected as fragile (ANSI state, cursor position, alternate screen modes are hard to roundtrip). The memory cost of multiple xterm instances is negligible for the expected 5–10 sessions.

**Auto-create on last tab close** (over empty state): Closing the last tab immediately spawns a fresh session, so the app always has ≥1 tab. Simpler than managing a distinct empty-state UI, and matches Chrome/VS Code behavior.

**"Session N" labels**: Sequential numbering for now. Step 006 will override with project names.

**Both button and shortcut**: `+` button in the tab bar for discoverability, plus Cmd+T for power users.

## Architecture decisions

**Renderer-only refactor**: The existing `TerminalService` already managed a `Map<id, pty>` — no backend changes needed. The renderer's `sessions` Map mirrors the service's Map with UI state (xterm instance, DOM refs, cleanup function).

**Cleanup pattern**: Each session stores a `cleanup()` function that disposes xterm listeners, IPC subscriptions, and the ResizeObserver. Called on tab close to prevent memory leaks.

**ResizeObserver scoped to active tab**: Only fires `fitAddon.fit()` when the panel is active, preventing unnecessary layout thrash for hidden terminals.

**Tab DOM uses data-testid attributes**: `tab`, `tab-close`, `tab-bar`, `new-tab-btn` — all directly matched by Playwright selectors.

## How it was tested

10 Playwright e2e tests covering the full STEPS.md spec:

1. Launch → 1 tab exists
2. Click `+` → 2 tabs
3. Each tab has a visible label
4. Click tab 1 → its panel active, tab 2 hidden
5. Click tab 2 → reverse
6. Type marker in tab 1, switch away and back → marker preserved in buffer
7. Close tab 2 → count back to 1
8. Closed tab's PTY cleaned up (terminal-count = 1)
9. Close last tab → auto-creates new tab, no crash
10. Regression: terminal-create IPC still works

Full suite: **39 tests, all passing** (steps 001–005).

## Lessons / gotchas

**Playwright strict mode with multiple xterm instances**: `.xterm-helper-textarea` resolves to N elements (one per terminal). Must scope selectors to `.terminal-panel.active .xterm-helper-textarea` to avoid strict mode violations.

**`waitForSelector('.xterm')` picks first match in DOM order**: When 2 terminals exist, the first `.xterm` may be in a hidden panel. Use `toHaveCount()` on tab locators instead of waiting for `.xterm` visibility.

**Step 003 test regression**: The exit test referenced `#terminal-container` which was replaced by `.terminal-panel`. Caught by running the full suite — a reminder to always run regression tests, not just new ones.

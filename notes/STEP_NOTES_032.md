# Step 032 — Sidebar Auto-Hide (Dock Mode)

## What was done

Replaced the binary show/hide sidebar toggle with a dock-style auto-hide system. The sidebar now has two modes: **autohide** (default) and **pinned**.

**Modified files:**
- `index.html` — added `sidebar-autohide` class to `.app-body`, added `.sidebar-trigger-zone` element
- `main.js` — added IPC handlers for `get-sidebar-mode` / `set-sidebar-mode`
- `src/main/preload.js` — exposed `getSidebarMode()` / `setSidebarMode()` on context bridge
- `src/main/services/WindowStateService.js` — added `sidebarMode` property (default: `'autohide'`), persisted to disk
- `src/renderer/index.js` — replaced `toggleSidebar()` with mode-based system (`revealSidebar`, `hideSidebar`, `scheduleSidebarHide`, `initSidebarAutoHide`), restored mode from persisted state on init
- `styles/base.css` — added styles for trigger zone, autohide collapse/reveal transitions, hidden resize handle in autohide mode
- `tests/step-027-toggle-sidebar.spec.js` — rewrote 6 tests + added 1 new test for the new autohide behavior

**Resulting behavior:**
- On launch, sidebar is in autohide mode (collapsed to 0 width)
- Hovering over a 6px trigger zone at the left edge reveals the sidebar with a 0.2s slide animation
- Moving the mouse away from the sidebar hides it after a 300ms delay
- Cmd+B toggles between pinned (always visible, resizable) and autohide modes
- Sidebar mode is persisted across restarts via WindowStateService
- Resize handle is hidden in autohide mode
- Shortcut help shows "Pin/Unpin Sidebar" instead of "Toggle Sidebar"

## Choices made

- **Autohide as default**: The sidebar is secondary navigation — the terminal content is the primary focus. Autohide maximizes terminal real estate by default.
- **Trigger zone approach**: A thin invisible strip (6px) at the left edge detects hover intent. This is the standard macOS dock pattern.
- **300ms hide delay**: Prevents accidental hide when briefly moving the mouse away from the sidebar. Matches typical dock hide delay.
- **CSS transitions gated by `.sidebar-transitions`**: Added after first paint via `requestAnimationFrame` to prevent the sidebar from animating on initial load.

## Architecture decisions

- **Mode stored in WindowStateService**: Follows the existing pattern for `sidebarWidth` and `fontSize` — getter/setter with debounced save.
- **Sidebar width preserved separately from mode**: When switching from autohide to pinned, the previously saved width is restored. The width variable tracks the "real" width even when the sidebar is collapsed to 0.
- **CSS-driven collapse**: The sidebar collapses via `width: 0` + `overflow: hidden` + `min-width: 0` rather than `display: none`. This enables smooth CSS transitions and keeps the DOM structure intact.
- **No overlay mode**: The sidebar pushes content rather than floating over it. This avoids z-index complexity and keeps the terminal area predictable.

## How it was tested

7 Playwright tests (rewrote the existing step-027 suite):

1. Sidebar starts in autohide mode (mode check + not visible)
2. Cmd+B pins the sidebar (mode switches to pinned, sidebar visible)
3. Resize handle is visible when pinned
4. Cmd+B returns to autohide (mode switches back, sidebar not visible)
5. Resize handle is hidden in autohide mode
6. Shortcut help overlay shows "Pin/Unpin Sidebar"
7. Trigger zone exists and is visible in autohide mode

All 7 tests pass.

## Lessons / gotchas

- **Transition-on-load prevention**: Without gating CSS transitions behind a class added after first paint, the sidebar would visibly animate from its natural width to 0 on page load. The `sidebar-transitions` class solves this cleanly.
- **Mouseenter/mouseleave coordination**: Both the trigger zone and the sidebar itself need mouseenter/mouseleave handlers. The trigger zone reveals, the sidebar keeps it revealed, and leaving either starts the hide timer. The timer must be cleared when re-entering either element.
- **Resize handle disabled in autohide**: Dragging to resize while in autohide mode would be confusing, so the mousedown handler exits early and the handle is hidden via CSS.

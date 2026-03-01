# Step 014 — Terminal Font Size Zoom

## What was done

Added keyboard shortcuts to zoom terminal font size in/out/reset, with persistence across app restarts.

**Modified files:**
- `src/renderer/index.js` — added `currentFontSize`, `setFontSize()`, `zoomIn()`, `zoomOut()`, `zoomReset()` functions; keybindings `Meta+=`, `Meta+-`, `Meta+0`; restores font size from persisted state on init; new terminals use `currentFontSize`
- `src/main/services/WindowStateService.js` — added `fontSize` to DEFAULTS (14) and getter/setter
- `src/main/preload.js` — added `getFontSize()` and `setFontSize()` to windowState namespace
- `main.js` — added IPC handlers `get-font-size` and `set-font-size`

**New files:**
- `tests/step-014-font-zoom.spec.js` — 7 Playwright tests

**Resulting behavior:**
- `Cmd+=` increases font size by 1
- `Cmd+-` decreases font size by 1
- `Cmd+0` resets to default (14px)
- Font size is clamped between 8px (min) and 32px (max)
- Font size change applies to ALL open terminals (not just active one)
- Font size persists in `window-state.json` and is restored on app restart
- Status bar updates after zoom (terminal dimensions change)

## Choices made

- **Global font size (not per-terminal)**: All terminals share the same font size. This is simpler and matches most terminal emulators (iTerm2, Hyper). Per-terminal zoom would add complexity without clear benefit.
- **1px increments**: Each zoom step changes by 1px. This gives fine control. Many editors use 1px steps (VS Code).
- **Min 8px / Max 32px**: 8px is the smallest readable monospace size. 32px is large enough for presentations.
- **Update all terminals on zoom**: `setFontSize` iterates all sessions and updates `terminal.options.fontSize` + `fitAddon.fit()`. This ensures consistency across tabs.

## Architecture decisions

- **Font size in WindowStateService**: Like sidebar width, font size is a visual preference tied to the window/user, not a project setting. Stored alongside window bounds in `window-state.json`.
- **`TERMINAL_OPTIONS` as base, `currentFontSize` as override**: `TERMINAL_OPTIONS.fontSize` is the initial default. New terminals are created with `{ ...TERMINAL_OPTIONS, fontSize: currentFontSize }` to pick up any zoom changes made before the terminal was created.
- **Keybindings use `=` not `+`**: On most keyboards, `=` is the unshifted key and `+` requires Shift. The keybinding system maps `Meta+=` which matches `Cmd+=` on macOS (the standard zoom-in shortcut).

## How it was tested

7 Playwright tests:

1. Initial font size is 14px (verified via computed style of `.xterm-rows`)
2. Cmd+= increases to 15px
3. Cmd+- decreases back to 14px
4. Cmd+0 resets from 17px to 14px
5. Cannot go below 8px (zoom out 10 times from 14)
6. Cannot go above 32px (zoom in 25 times from 14)
7. Font size persists via IPC (set to 18, read back as 18)

All 7 tests pass. Full suite: 126 tests in ~58s.

## Lessons / gotchas

- **xterm.js computed font size**: The actual font size can be read from the computed style of `.xterm-rows` elements. Using `getComputedStyle().fontSize` gives the rendered size in `"14px"` format, which is reliable for assertions.
- **`terminal.options.fontSize` is writable**: xterm.js allows changing options after creation. Setting `terminal.options.fontSize` immediately updates the terminal rendering. Combined with `fitAddon.fit()`, the terminal columns/rows adjust to the new font size.

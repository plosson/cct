# Step 022 — Clear Terminal Buffer (Cmd+K)

## What was done

Added Cmd+K to clear the active terminal's scrollback buffer.

**Modified files:**
- `src/renderer/index.js` — added `'Meta+k': 'clearTerminal'` keybinding, `clearTerminal()` function, `clearTerminal` action label, registered action in init()
- `styles/base.css` — no changes (step 021 CSS was committed with step 021)

**New files:**
- `tests/step-022-clear-terminal.spec.js` — 5 Playwright tests

**Resulting behavior:**
- Cmd+K clears the active terminal's scrollback buffer
- Previous output is removed, terminal cursor stays at current line
- Terminal remains fully functional after clear
- No-op when no active session (no error)
- Appears in Cmd+/ help overlay as "Clear Terminal"

## Choices made

- **`terminal.clear()`**: xterm.js built-in method that clears scrollback buffer. Simple and correct — matches what iTerm2 and Terminal.app do with Cmd+K.
- **No-op when no active session**: `clearTerminal()` early-returns if `!activeId` or session not found. Safe and quiet.
- **Key: `Meta+k`**: Standard macOS terminal shortcut. Lowercase 'k' to match xterm.js event.key behavior.

## Architecture decisions

- **Follows established pattern**: keybinding → action → function. Same structure as zoom, search, etc.
- **No confirmation**: Clearing the buffer is a lightweight, reversible-ish action (you can scroll back via shell history). No dialog needed.

## How it was tested

5 Playwright tests:

1. Terminal has content after typing a command
2. Cmd+K clears the terminal buffer (content gone)
3. Terminal is still functional after clear (new output appears)
4. Cmd+K does nothing when no active session
5. Shortcut help overlay includes "Clear Terminal" entry

All 5 tests pass. Full suite: 171 tests in ~84s.

## Lessons / gotchas

- **App launch timeout in full suite**: With 20+ test files each launching their own Electron app, the last few test files can timeout on `firstWindow()` due to system resource pressure. Fixed by increasing the launch timeout to 60s for later test files.

# Step 026 — Select All (Cmd+A)

## What was done

Added Cmd+A to select all text in the active terminal buffer.

**Modified files:**
- `src/renderer/index.js` — added `'Meta+a': 'selectAll'` keybinding, `selectAll()` function, action label, registered action in init()

**New files:**
- `tests/step-026-select-all.spec.js` — 4 Playwright tests

**Resulting behavior:**
- Cmd+A selects all text in the active terminal's scrollback buffer
- Works with Cmd+Shift+C to copy the full buffer contents
- No-op when no active session
- Appears in Cmd+/ help overlay as "Select All"

## Choices made

- **`terminal.selectAll()`**: xterm.js built-in method. Simple, correct, no custom implementation needed.
- **No visual confirmation**: The selection itself is the visual feedback (highlighted text in the terminal).

## Architecture decisions

- Same pattern as all other keybindings: key → action name → function → registered in init().

## How it was tested

4 Playwright tests:

1. Terminal has no selection initially
2. Cmd+A selects all text, verified by copying to clipboard and checking contents
3. Cmd+A is a no-op when no active session
4. Shortcut help overlay includes "Select All" entry

All 4 tests pass.

## Lessons / gotchas

- **Testing selection indirectly**: xterm.js doesn't expose an easy way to check if text is selected from the outside. Tested by selecting all → copying to clipboard → verifying clipboard contains expected text.

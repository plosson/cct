# Step 023 — Terminal Clipboard Integration (Cmd+Shift+C/V)

## What was done

Added Cmd+Shift+C to copy terminal selection and Cmd+Shift+V to paste clipboard into terminal.

**Modified files:**
- `src/main/preload.js` — imported `clipboard` from Electron, exposed `clipboard.writeText` and `clipboard.readText` via context bridge
- `src/renderer/index.js` — added `'Shift+Meta+C': 'copySelection'` and `'Shift+Meta+V': 'pasteClipboard'` keybindings, `copySelection()` and `pasteClipboard()` functions, action labels, registered in init()

**New files:**
- `tests/step-023-clipboard.spec.js` — 5 Playwright tests

**Resulting behavior:**
- Cmd+Shift+C copies the terminal's current text selection to the system clipboard
- Cmd+Shift+V reads from the system clipboard and writes it into the active terminal's PTY input
- Both are no-ops when no active session exists
- Appears in Cmd+/ help overlay as "Copy Selection" and "Paste"

## Choices made

- **Electron `clipboard` module in preload**: Used Electron's built-in `clipboard` module directly in the preload script. This avoids IPC round-trips for clipboard operations while remaining safe under context isolation.
- **PTY input for paste**: Paste writes directly to the PTY via `terminal.input()`, which means the pasted text appears as if the user typed it. This is the standard terminal paste behavior.
- **`getSelection()` for copy**: Uses xterm.js `getSelection()` API to get the currently selected text. Returns empty string if nothing is selected, which we skip silently.

## Architecture decisions

- **Key normalization order**: `normalizeKeyEvent()` produces modifiers in the order Ctrl→Alt→Shift→Meta, so keybinding keys must be `'Shift+Meta+C'` not `'Meta+Shift+C'`. This was a lesson learned during implementation.
- **Direct clipboard access**: Rather than routing through IPC, the clipboard module works directly in the preload context. This is one of the few Electron modules available in preload without requiring IPC.

## How it was tested

5 Playwright tests:

1. Clipboard API is available via preload (`writeText` and `readText` functions exist)
2. `writeText` / `readText` round-trip (write a string, read it back)
3. Cmd+Shift+V pastes clipboard into terminal (write to clipboard, press shortcut, check buffer)
4. Cmd+Shift+C copies selection (programmatic verification via clipboard API)
5. Shortcut help overlay includes "Copy Selection" and "Paste" entries

All 5 tests pass. Full suite: 176 tests in ~84s.

## Lessons / gotchas

- **Key normalization order matters**: The keybinding map keys must match the exact order that `normalizeKeyEvent()` produces. Had `'Meta+Shift+C'` initially, but the normalizer produces `'Shift+Meta+C'`. Both tests and shortcuts silently failed until this was corrected.
- **Electron clipboard in preload**: The `clipboard` module is one of the few Electron modules usable in preload scripts. No IPC needed, which simplifies the implementation.

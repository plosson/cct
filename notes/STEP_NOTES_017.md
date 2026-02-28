# Step 017 — Keyboard Shortcut Help Overlay

## What was done

Added a keyboard shortcut help overlay that shows all registered keybindings. Toggled with Cmd+/.

**Modified files:**
- `src/renderer/index.js` — added `'Meta+/': 'showShortcutHelp'` to keybindings, `ACTION_LABELS` map, `formatKeyCombo()`, `showShortcutHelp()`, `closeShortcutHelp()`, registered action in init()
- `styles/base.css` — added `.shortcut-help-overlay`, `.shortcut-help-panel`, `.shortcut-help-title`, `.shortcut-help-list`, `.shortcut-help-row`, `.shortcut-help-label`, `.shortcut-help-key` styles

**New files:**
- `tests/step-017-shortcut-help.spec.js` — 7 Playwright tests

**Resulting behavior:**
- Cmd+/ opens a centered modal overlay with "Keyboard Shortcuts" title
- Lists all 13 keybindings with human-readable action labels and formatted key combos
- Key combos use macOS symbols: ⌘ (Meta), ⌥ (Alt), ⇧ (Shift), ⌃ (Ctrl), arrow symbols
- Escape closes the overlay
- Clicking the backdrop closes the overlay
- Cmd+/ toggles (opens/closes)
- Reuses the project picker animation (`picker-drop-in`)

## Choices made

- **Data-driven from keybindings map**: The overlay reads directly from the `keybindings` object, so if keybindings change, the help updates automatically. No hardcoded shortcut list.
- **ACTION_LABELS map**: Maps action names (e.g., `createClaudeSession`) to human-readable labels (e.g., "New Claude Session"). Falls back to the raw action name if no label is defined.
- **macOS symbol formatting**: `formatKeyCombo()` replaces Meta→⌘, Alt→⌥, etc. This is macOS-standard. Could be extended for Windows/Linux labels later.
- **Same visual language as project picker**: Same overlay background, panel styling, border-radius, animation. Consistent UX pattern.

## Architecture decisions

- **Overlay gets focus via `tabIndex = -1`**: The overlay div receives focus so it can capture Escape key events. This is the standard pattern for modal dialogs.
- **Toggle pattern**: `showShortcutHelp()` checks if `shortcutHelpOverlay` is already open and closes it if so. Same toggle behavior as the project picker.
- **`kbd` element for key combos**: Semantically appropriate HTML element for keyboard shortcuts. Styled with a subtle border and background.
- **No separate keybinding for close**: Escape and backdrop click both close. The Cmd+/ keybinding itself toggles, so pressing it again also closes.

## How it was tested

7 Playwright tests:

1. Cmd+/ opens the shortcut help overlay
2. Overlay shows "Keyboard Shortcuts" title
3. Overlay lists all 13+ registered keybindings (rows count check)
4. Key combos use macOS symbols (⌘ present in first key)
5. Escape closes the overlay
6. Cmd+/ toggles overlay (open then close)
7. Clicking backdrop closes the overlay

All 7 tests pass. Full suite: 145 tests in ~66s.

## Lessons / gotchas

- **Overlay focus**: Without `tabIndex = -1`, the overlay div can't receive focus, and the Escape keydown listener wouldn't fire. The overlay must be focusable.
- **Key event on overlay vs document**: Using the overlay's own keydown listener with `e.stopPropagation()` prevents Escape from propagating to other handlers (e.g., closing the search bar too).

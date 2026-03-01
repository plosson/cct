# Step 018 — Tab Number Shortcuts (Cmd+1-9)

## What was done

Added Cmd+1 through Cmd+9 keyboard shortcuts to switch directly to a specific tab by position.

**Modified files:**
- `src/renderer/index.js` — added 9 keybindings (`Meta+1` through `Meta+9`), `goToTab()` function, ACTION_LABELS entries, action registrations in init()

**New files:**
- `tests/step-018-tab-number-shortcuts.spec.js` — 6 Playwright tests

**Resulting behavior:**
- Cmd+1 activates the first tab in the current project
- Cmd+2 activates the second tab, etc.
- Cmd+9 always activates the last tab (browser convention)
- If the number exceeds the tab count, the last tab is activated (clamped)
- All 9 shortcuts appear in the Cmd+/ help overlay

## Choices made

- **Cmd+9 = last tab**: Following browser and terminal emulator convention. Cmd+9 doesn't go to tab 9 — it always goes to the last tab.
- **Clamping for out-of-range numbers**: If you have 3 tabs and press Cmd+5, it goes to tab 3 (the last one). This is forgiving and consistent with the Cmd+9 behavior.
- **Individual keybinding entries**: Each Cmd+1 through Cmd+8 has its own keybinding entry and action name (`goToTab1` through `goToTab8`, `goToLastTab`). This keeps the keybinding system purely declarative — no special parsing needed.
- **Loop registration**: Actions are registered via a `for` loop in init() to avoid 8 duplicate lines.

## Architecture decisions

- **`goToTab(n)` function**: Takes a 0-indexed position, or -1 for "last tab". Resolves tab IDs from `sessionsForProject()` and clamps the index. This is a thin wrapper around `activateTab()`.
- **Consistent with data-driven keybindings**: All 9 shortcuts flow through the same `keybindings → actions` dispatch system. They appear in the help overlay automatically.

## How it was tested

6 Playwright tests:

1. Cmd+1 activates the first tab
2. Cmd+3 activates the third tab
3. Cmd+9 activates the last tab
4. Cmd+N beyond tab count goes to last tab (clamping)
5. Cmd+2 activates second tab from first
6. Shortcut help overlay includes "Go to Tab 1" and "Go to Last Tab" entries

All 6 tests pass. Full suite: 151 tests in ~72s.

## Lessons / gotchas

- **No conflicts with Electron**: On macOS, Cmd+1-9 is not claimed by Electron's default menu. The renderer receives these key events normally.
- **Tab order = DOM order**: `sessionsForProject()` returns sessions in Map insertion order, which matches the visible tab order in the tab bar (except when reordered via drag, which changes DOM order but not Map order). This is a known limitation — tab number shortcuts follow creation order, not visual order after drag reordering.

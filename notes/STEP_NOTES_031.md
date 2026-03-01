# Step 031 — Close Other Tabs Shortcut (Cmd+Shift+W)

## What was done

Added Cmd+Shift+W keyboard shortcut to close all tabs except the active one.

**Modified files:**
- `src/renderer/index.js` — added `'Shift+Meta+W': 'closeOtherTabs'` keybinding, action label, registered action in init()

**New files:**
- `tests/step-031-close-others-shortcut.spec.js` — 4 Playwright tests

**Resulting behavior:**
- Cmd+Shift+W closes all tabs except the active one in the current project
- The active tab remains and stays active
- No-op when only one tab exists (doesn't close the last tab)
- Appears in Cmd+/ help overlay as "Close Other Tabs"

## Choices made

- **Reuses `closeOtherTabs(activeId)`**: No new function needed — the existing function from step 011 already does exactly this.
- **Key combo `Shift+Meta+W`**: Natural extension of `Meta+W` (close active tab). The Shift modifier means "close others instead."

## Architecture decisions

- Zero new code needed for the action itself — just a keybinding + action registration that delegates to the existing function.

## How it was tested

4 Playwright tests:

1. Three tabs exist initially
2. Cmd+Shift+W closes all tabs except active (3→1)
3. Cmd+Shift+W is a no-op with only one tab
4. Shortcut help overlay includes "Close Other Tabs" entry

All 4 tests pass.

## Lessons / gotchas

- None — straightforward keybinding addition leveraging existing code.

# Step 020 — Duplicate Tab via Context Menu

## What was done

Added a "Duplicate" option in the tab context menu that creates a new session of the same type in the same project.

**Modified files:**
- `src/renderer/index.js` — added "Duplicate" item to context menu with separator, added `duplicate` case in switch, updated `_cctGetTabContextMenuItems` test helper, added `_cctDuplicateTab` test helper
- `tests/step-011-tab-context-menu.spec.js` — updated test 1 to expect 4 items (was 3) including the new Duplicate item

**New files:**
- `tests/step-020-duplicate-tab.spec.js` — 6 Playwright tests

**Resulting behavior:**
- Right-clicking a tab shows: Duplicate | separator | Close, Close Others, Close All
- "Duplicate" creates a new session of the same type (terminal or claude) in the current project
- The duplicate becomes the active tab
- Session count updates in the sidebar

## Choices made

- **Separator between Duplicate and Close actions**: Visual grouping separates the constructive action (Duplicate) from destructive actions (Close/Close Others/Close All).
- **Duplicate spawns fresh session**: Does not resume the original Claude session — creates a brand new session of the same type. This is the expected behavior (like "Duplicate Tab" in iTerm2).
- **No keyboard shortcut**: Duplicate is not a frequent enough action to warrant a keybinding. Context menu is sufficient.

## Architecture decisions

- **Reuses `createSession(session.type)`**: The duplicate action simply calls the existing `createSession()` with the original tab's type. No new infrastructure needed — maximum code reuse.
- **Test helper `_cctDuplicateTab`**: Exposed for testing since we can't trigger native context menus from Playwright.

## How it was tested

6 Playwright tests:

1. Context menu includes "Duplicate" option
2. Duplicating a terminal tab creates a new terminal tab
3. Duplicated tab has the same type (T icon for terminal)
4. Duplicated tab becomes the active tab
5. Session count updates in sidebar after duplicate
6. Duplicating a claude tab creates a claude tab (CC icon)

Also updated step 011 test 1 to expect 4 context menu items instead of 3.

All 6 tests pass. Full suite: 162 tests in ~78s.

## Lessons / gotchas

- **Existing test breakage**: Adding a new context menu item broke step 011 test 1 which asserted exact item count and positions. This is expected when modifying shared behavior — always run the full suite.

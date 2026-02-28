# Step 024 — Move Tab with Keyboard (Cmd+Shift+Left/Right)

## What was done

Added Cmd+Shift+Left and Cmd+Shift+Right shortcuts to move the active tab left/right in the tab bar.

**Modified files:**
- `src/renderer/index.js` — added `'Shift+Meta+ArrowLeft': 'moveTabLeft'` and `'Shift+Meta+ArrowRight': 'moveTabRight'` keybindings, `moveTab(direction)` function, action labels, registered actions in init(), added `_cctGetTabOrder` test helper

**New files:**
- `tests/step-024-move-tab.spec.js` — 6 Playwright tests

**Resulting behavior:**
- Cmd+Shift+Left moves the active tab one position left in the tab bar
- Cmd+Shift+Right moves the active tab one position right in the tab bar
- Wraps around: first tab moved left goes to last position, last tab moved right goes to first
- Only considers tabs within the current project (hidden tabs for other projects are not affected)
- No-op when only one tab or no active session
- Appears in Cmd+/ help overlay as "Move Tab Left" / "Move Tab Right"

## Choices made

- **DOM `insertBefore` for reordering**: Moving tabs by repositioning DOM elements in the tab bar container. This is the simplest approach and matches how the drag-and-drop reordering already works.
- **Wrap around**: Moving the first tab left wraps to the last position, and vice versa. This is consistent with how tab cycling (Cmd+Left/Right) works.
- **Project-scoped**: Only tabs for the current project participate in reordering. Tabs from other projects (hidden with `display:none`) are ignored.

## Architecture decisions

- **Filter visible project tabs from DOM**: Instead of maintaining a separate ordering data structure, we read the current tab order directly from the DOM. This keeps the source of truth in one place (the DOM) and is consistent with drag-and-drop.
- **Test helper `_cctGetTabOrder`**: Returns an array of visible tab labels in their DOM order. Filters out `display:none` tabs so it only returns tabs for the current project.

## How it was tested

6 Playwright tests:

1. Three tabs exist with correct initial order
2. Cmd+Shift+Left moves active tab left (from position 2 to position 1)
3. Cmd+Shift+Right moves active tab right (from position 1 back to position 2)
4. Move left wraps first tab to last position
5. Move right wraps last tab to first position
6. Shortcut help overlay includes "Move Tab Left" and "Move Tab Right" entries

All 6 tests pass.

## Lessons / gotchas

- **Key normalization order**: As established in step 023, modifier order must be Shift+Meta (not Meta+Shift) to match the normalizer.
- **dist/ is gitignored**: The build artifacts in dist/ are not committed — only source files and tests.

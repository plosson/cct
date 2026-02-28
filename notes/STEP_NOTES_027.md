# Step 027 — Toggle Sidebar Visibility (Cmd+B)

## What was done

Added Cmd+B to toggle the sidebar visibility. When hidden, the main area takes full width.

**Modified files:**
- `src/renderer/index.js` — added `'Meta+b': 'toggleSidebar'` keybinding, `toggleSidebar()` function, `sidebarVisible` state variable, action label, registered action in init(), added `_cctIsSidebarVisible` test helper

**New files:**
- `tests/step-027-toggle-sidebar.spec.js` — 6 Playwright tests

**Resulting behavior:**
- Cmd+B hides the sidebar and the resize handle
- Pressing Cmd+B again restores them
- Terminal refits when sidebar is toggled (via `requestAnimationFrame`)
- Appears in Cmd+/ help overlay as "Toggle Sidebar"

## Choices made

- **`display: none`**: Simplest way to hide the sidebar. CSS flexbox handles the reflow automatically.
- **Also hides resize handle**: Without the sidebar, the resize handle serves no purpose and would leave an awkward sliver.
- **`requestAnimationFrame` for refit**: Defers the terminal refit to after the layout reflow, ensuring correct dimensions.

## Architecture decisions

- **Boolean state variable `sidebarVisible`**: Tracks whether the sidebar is shown. Starts true. No persistence needed — sidebar visibility resets on app restart (always visible).
- **Standard VS Code shortcut**: Cmd+B is the established convention for toggling the sidebar.

## How it was tested

6 Playwright tests:

1. Sidebar is visible by default
2. Cmd+B hides the sidebar
3. Resize handle is also hidden when sidebar is hidden
4. Cmd+B shows the sidebar again
5. Resize handle is visible again
6. Shortcut help overlay includes "Toggle Sidebar" entry

All 6 tests pass.

## Lessons / gotchas

- None — straightforward implementation following established patterns.

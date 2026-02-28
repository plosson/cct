# Step 011 — Tab Context Menu

## What was done

Added right-click context menu on tabs with Close, Close Others, and Close All actions. Uses Electron's native `Menu.popup()` for OS-native look and feel.

**Modified files:**
- `main.js` — added generic `show-context-menu` IPC handler that builds an Electron `Menu` from items, shows it, and returns the selected action
- `src/main/preload.js` — added `contextMenu.show(items)` to context bridge
- `src/renderer/index.js` — added `contextmenu` event listener on tabs, `showTabContextMenu()`, `closeOtherTabs()`, `closeAllTabs()` functions, and test helpers

**New files:**
- `tests/step-011-tab-context-menu.spec.js` — 7 Playwright tests

**Resulting behavior:**
- Right-click on any tab shows a native macOS context menu
- "Close" closes the right-clicked tab
- "Close Others" closes all tabs in the same project except the right-clicked one (disabled when only one tab exists)
- "Close All" closes every tab in the project, showing the empty state
- After "Close Others", the kept tab becomes the active tab

## Choices made

- **Native Electron menu (not custom HTML)**: `Menu.popup()` provides OS-native context menus that match the platform style. Simpler and more polished than building a custom dropdown.
- **Generic IPC handler**: The `show-context-menu` handler accepts an array of `{ label, action, enabled }` items and returns the selected action string (or `null` if dismissed). This is reusable for future context menus (e.g., sidebar project right-click).
- **Project-scoped operations**: "Close Others" and "Close All" operate within the current project only, not across all projects. This matches the mental model — you're managing tabs for one project at a time.
- **Test via helpers, not native menu**: Since Electron's native menus can't be interacted with from Playwright (they're OS-level windows), tests verify the underlying functions (`closeOtherTabs`, `closeAllTabs`) and the menu item structure via test helpers.

## Architecture decisions

- **Promise-based IPC for menu**: The `show-context-menu` handler wraps `Menu.popup()` in a promise. Each item's `click` callback resolves the promise with the action string. The `callback` parameter of `popup()` resolves with `null` when the menu is dismissed without selection. This gives the renderer a clean async API: `const action = await api.contextMenu.show(items)`.
- **Separator support**: The IPC handler supports `{ type: 'separator' }` items for future use, even though the current tab context menu doesn't use separators.
- **`closeOtherTabs` activates the kept tab**: After closing all other tabs, it explicitly activates the kept tab. This ensures the kept tab's terminal is focused and the status bar is updated.

## How it was tested

7 Playwright tests:

1. Context menu items are generated correctly (3 items with correct labels and actions)
2. "Close Others" is disabled with only one tab (`enabled: false`)
3. "Close Others" is enabled with multiple tabs (`enabled: true`)
4. `closeOtherTabs` keeps only the specified tab (3 tabs → 1)
5. `closeAllTabs` closes every tab (3 tabs → 0)
6. Empty state is visible after Close All
7. `closeOtherTabs` activates the kept tab (verified via `_cctActiveTabId`)

All 7 tests pass. Full suite: 105 tests in ~52s.

## Lessons / gotchas

- **`contextBridge` creates sealed proxies**: Cannot monkey-patch `window.electron_api` properties from the renderer. Initial test approach of overriding `contextMenu.show` failed because the object is frozen by context isolation. Had to use test helpers exposed via `window._cct*` instead.
- **Native menu blocks the event loop**: Dispatching a `contextmenu` event from `window.evaluate()` triggers `showTabContextMenu()` which calls `api.contextMenu.show()`. Since `Menu.popup()` is modal, the IPC promise never resolves in test, causing timeouts. Solution: test the functions directly rather than going through the event/IPC path.
- **Generic context menu is reusable**: The IPC handler is not tab-specific. It can be reused for project sidebar context menus, terminal panel context menus, etc. The renderer decides what items to show.

# Step 010 — Terminal Search (Cmd+F)

## What was done

Added in-terminal search using xterm.js SearchAddon. Cmd+F opens a search bar above the terminal, allowing text search within the terminal buffer.

**Modified files:**
- `package.json` — added `@xterm/addon-search` dependency
- `src/renderer/index.js` — imported `SearchAddon`, loads addon per session, added `openSearchBar()`, `focusSearchBar()`, `closeSearchBar()` functions, registered `Meta+f` keybinding
- `styles/base.css` — added search bar styles (`.search-bar`, `.search-bar-input`, `.search-bar-count`, `.search-bar-btn`, `.search-bar-close`)

**New files:**
- `tests/step-010-terminal-search.spec.js` — 8 Playwright tests

**Resulting behavior:**
- `Cmd+F` opens a search bar between the tab bar and terminal area
- Input field with placeholder "Search…", result count, prev/next arrows, close button
- Typing searches the terminal buffer in real-time
- Enter moves to next match, Shift+Enter moves to previous
- Prev/Next buttons (↑↓) navigate matches
- "No results" shown when search term has no matches
- Escape closes the search bar and refocuses the terminal
- Cmd+F when bar is open refocuses it and selects existing text
- Search decorations are cleared when bar is closed

## Choices made

- **`@xterm/addon-search`**: Official xterm.js search addon. Handles highlight decoration and buffer traversal. No need to implement search logic manually.
- **One SearchAddon per session**: Each terminal gets its own addon instance stored in the session Map. This ensures search state is independent per terminal.
- **Search bar in main area (not per-panel)**: A single search bar is created/destroyed globally. It always operates on the active session's SearchAddon. Simpler than managing per-panel search bars.
- **Result count is simple**: Shows empty string when matches exist, "No results" when `findNext`/`findPrevious` returns false. The SearchAddon doesn't provide a match count API, so we can't show "2 of 5" style counts.
- **`clearDecorations()` on close**: Removes search highlight markers when the search bar is dismissed, leaving the terminal clean.

## Architecture decisions

- **SearchAddon loaded in createSession**: Following the same pattern as FitAddon — loaded once when the terminal is created. Available throughout the session's lifetime.
- **Search bar inserted into DOM dynamically**: Created on `Cmd+F`, removed on close/Escape. No persistent DOM element — keeps the HTML clean when search isn't active.
- **Search bar positioned via flex layout**: Inserted before `terminalsContainer` in the main area's flex column. The terminal area shrinks to accommodate it automatically.
- **Keybinding via data-driven system**: Added `'Meta+f': 'openSearchBar'` to the keybindings map and registered the action. Consistent with all other keyboard shortcuts.

## How it was tested

8 Playwright tests:

1. Cmd+F opens the search bar (visible, input focused)
2. Typing in search finds text in buffer (echoed "SEARCH_TARGET_UNIQUE_42" then searched for "SEARCH_TARGET")
3. Searching for non-existent text shows "No results"
4. Enter navigates to next match (doesn't break, still shows results)
5. Escape closes the search bar (not visible)
6. After close, terminal regains focus (checks `document.activeElement`)
7. Prev/Next buttons navigate matches (click ↑ and ↓, results still shown)
8. Cmd+F again focuses existing search bar and preserves input text

Test setup: creates a terminal, types `echo SEARCH_TARGET_UNIQUE_42`, waits for output via `_cctGetBufferText()`, then runs all search tests.

All 8 tests pass. Full suite: 98 tests in ~43s.

## Lessons / gotchas

- **SearchAddon `findNext` returns boolean**: Returns `true` if a match was found, `false` otherwise. No match count or index available. This limits the UX to "found/not found" rather than "match N of M".
- **`clearDecorations()` vs dispose**: Using `clearDecorations()` to remove highlights without disposing the addon. The addon is reusable if the user opens search again on the same session.
- **Input `select()` on re-focus**: When Cmd+F is pressed while the bar is already open, `focusSearchBar()` calls `input.select()` to highlight existing text. This matches browser behavior where Cmd+F selects the search field content.

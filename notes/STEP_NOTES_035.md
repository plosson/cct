# Step 035 — Debug Pane

## What was done

Added a collapsible bottom panel ("Debug Log") inside `.main-area` that displays structured log entries, replacing DevTools as the primary diagnostic tool for users.

**New files:**
- `src/main/services/LogService.js` — singleton with ring buffer (500 entries), `info`/`warn`/`error` methods, broadcasts to all BrowserWindows via IPC
- `src/main/ipc/log.ipc.js` — `log-get-history` (invoke), `log-clear` (on)
- `tests/step-035-debug-pane.spec.js` — 8 Playwright tests

**Modified files:**
- `index.html` — debug pane DOM (resize handle + pane with header/entries)
- `styles/base.css` — debug pane CSS (resize handle, pane, header, entry rows with level coloring)
- `src/renderer/index.js` — toggle (Cmd+J), resize, entry rendering, auto-scroll, clear, state restore, shortcut help entry
- `src/main/preload.js` — `log` and `windowState` debug pane bridge
- `main.js` — LogService instantiation (first, before other services), IPC handlers, wiring
- `src/main/services/WindowStateService.js` — `debugPaneHeight`/`debugPaneOpen` properties
- `src/main/services/HooksService.js` — `setLogService()` setter, replaced 3 `console.error` calls
- `src/main/services/ConfigService.js` — optional `logService` in constructor, logged config load failures
- `src/main/services/TerminalService.js` — optional `logService`, logged PTY resize failures
- `src/main/services/ProjectStore.js` — optional `logService`, logged project load failures
- `src/main/services/UpdaterService.js` — optional `logService`, logged update events

## Choices made

- **LogService as standalone singleton** (not monkey-patching `console.*`): structured entries with source tags are far more useful than raw console output. Source filtering and level styling give users actionable diagnostics.
- **Ring buffer (500)** vs unbounded: prevents memory growth in long-running sessions. 500 entries is enough for recent history without being overwhelming.
- **Optional logService in constructors** (default `null` with guard checks): backward-compatible — existing tests that don't pass logService continue to work unchanged. No forced refactoring.
- **HooksService uses module-level setter** instead of constructor injection: it uses standalone functions, not a class. A setter keeps the existing API intact.
- **border-top moved to `.open` state**: a 1px border on the collapsed pane would make `offsetHeight` = 1 instead of 0, breaking the collapsed state assertion.

## Architecture decisions

- **Pane inside `.main-area`** (not at `.app` level): scoped to the content area alongside terminals, doesn't extend under sidebar. Resize only affects terminal height, not sidebar.
- **Same resize pattern as sidebar**: mousedown/mousemove/mouseup with drag state, cursor override, `userSelect: none`, persist on mouseup. Consistent UX.
- **State persisted via WindowStateService**: height and open/closed state survive app restarts. Same debounced-save pattern as sidebar width.
- **IPC design**: `log-entry` (send, main→renderer) for real-time streaming, `log-get-history` (invoke) for catching up on entries logged before pane was opened, `log-clear` (send) for clearing.

## How it was tested

8 Playwright tests in `tests/step-035-debug-pane.spec.js`:

1. `log-get-history` IPC returns array
2. Startup logs appear in history with proper shape (`timestamp`, `level`, `source`, `message`)
3. Debug pane state defaults are persisted (height=200, open=false)
4. Debug pane exists in DOM and is collapsed by default (height=0)
5. Cmd+J toggles debug pane open and closed
6. Debug pane is resizable via drag handle (drag up increases height)
7. Log entries appear in the debug pane (via test helper)
8. Clear button removes all entries

All 252 tests pass (8 new + 244 existing), zero regressions.

## Lessons / gotchas

- **LogService must be created before other services** in `main.js` — services log during their constructors (`_load()` calls), so logService must exist first.
- **Renderer bundle rebuild required**: source changes in `src/renderer/` don't take effect until `node scripts/build-renderer.js` runs. Easy to forget when iterating.
- **CSS border-top on collapsed flex child**: even a 1px border gives the element a non-zero offsetHeight, which breaks "is collapsed" checks. Move decorative borders to the open state.

# Step 029 — Terminal Link Handler (Clickable URLs)

## What was done

Added clickable URLs in terminal output using xterm.js's web links addon.

**Modified files:**
- `main.js` — added `shell-open-external` IPC handler using Electron's `shell.openExternal()`
- `src/main/preload.js` — exposed `shell.openExternal` via context bridge
- `src/renderer/index.js` — imported `WebLinksAddon` from `@xterm/addon-web-links`, loaded it for each terminal session with a click handler that calls `api.shell.openExternal(uri)`
- `package.json` — added `@xterm/addon-web-links` dependency

**New files:**
- `tests/step-029-terminal-links.spec.js` — 4 Playwright tests

**Resulting behavior:**
- URLs in terminal output (http://, https://) are automatically detected and rendered as clickable links
- Clicking a URL opens it in the system's default browser
- Works in both Claude and terminal sessions

## Choices made

- **`@xterm/addon-web-links`**: The official xterm.js addon for URL detection. Handles all the regex matching and DOM rendering automatically.
- **`shell.openExternal` via IPC**: Standard Electron pattern for opening URLs in the default browser. Requires main process for security.
- **Custom click handler**: The addon's callback receives `(event, uri)` — we call `event.preventDefault()` to prevent default behavior and then route through our IPC bridge.

## Architecture decisions

- **Addon loaded per session**: Each terminal instance gets its own `WebLinksAddon` instance, loaded before `terminal.open()`.
- **IPC for external links**: `shell.openExternal` must run in the main process. Added alongside the existing `shell-show-item-in-folder` handler.

## How it was tested

4 Playwright tests:

1. `shell.openExternal` API is available in preload bridge
2. Terminal contains a URL after echoing one
3. Terminal has xterm DOM structure (link layer exists)
4. Web links addon is loaded (verified by echoing another URL)

All 4 tests pass. Note: we can't easily test the actual click-to-open behavior in Playwright (it would open a real browser), so tests verify the infrastructure is in place.

## Lessons / gotchas

- **Can't test link clicks in E2E**: Opening external URLs would launch a browser window which interferes with tests. Tests verify the API exists and URLs appear in the terminal.
- **Addon load order**: The web links addon should be loaded before `terminal.open()` to catch all content written to the terminal from the start.

# Step 003 — xterm.js Renders a Local Shell

## What was done

Transformed CCT from a static Electron window into a working terminal emulator. Added xterm.js in the renderer connected to a real zsh PTY via node-pty through Electron IPC.

**Files created:**
- `scripts/build-renderer.js` — esbuild config bundling `src/renderer/index.js` → `dist/renderer.bundle.js` (browser, IIFE, chrome120, sourcemaps)
- `src/main/services/TerminalService.js` — PTY lifecycle manager with `Map<id, pty>`, adaptive data batching (4→16→32ms), disposable cleanup pattern
- `src/main/ipc/terminal.ipc.js` — IPC handlers bridging renderer ↔ TerminalService (handle for request/response, on for fire-and-forget)
- `src/renderer/index.js` — xterm.js Terminal + FitAddon initialization, PTY wiring, ResizeObserver, exit detection
- `tests/step-003-xterm-shell.spec.js` — 8 Playwright e2e tests

**Files modified:**
- `package.json` — added deps (node-pty, @xterm/xterm, @xterm/addon-fit, esbuild), postinstall script, updated start/build/test scripts to include renderer bundling
- `main.js` — wired TerminalService + IPC registration in `app.whenReady()`, added `before-quit` cleanup
- `src/main/preload.js` — added `terminal` namespace with create/input/resize/kill/onData/onExit/count
- `index.html` — replaced static content with terminal container, added xterm CSS + renderer bundle script
- `styles/base.css` — replaced `.content`/`h1`/`p` with `.terminal-container { flex: 1; overflow: hidden }`
- `electron-builder.config.js` — added `dist/renderer.bundle.js*` and `node_modules/@xterm/xterm/css/**` to files

## Choices made

- **esbuild over webpack/vite**: Minimal config, sub-100ms builds, perfect for bundling xterm.js imports into a single IIFE for the renderer. No need for HMR or dev server complexity at this stage.
- **IIFE format**: The renderer bundle runs in Electron's main world via `<script>` tag — IIFE is the simplest format, no module system needed.
- **Adaptive batching (4/16/32ms)**: Prevents flooding the IPC channel under heavy PTY output (e.g. `cat` a large file) while keeping latency low for interactive typing. Batch interval doubles when throughput exceeds 32KB/flush, resets to 4ms when idle.
- **fire-and-forget for input/resize/kill**: These are high-frequency, unidirectional operations — `ipcRenderer.send` avoids unnecessary round-trip overhead vs `invoke`.
- **`window._cctGetBufferText` for test assertions**: xterm.js renders to canvas, not DOM text. Exposed the buffer API via a global function for Playwright to query. Placed before async IPC calls to avoid timing issues.

## Architecture decisions

- **TerminalService as a class with Map**: Designed for multi-terminal support (Step 005) from the start. Each PTY gets a unique incrementing ID. The Map stores both the pty process and disposable references for clean teardown.
- **IPC separation**: `terminal.ipc.js` is a standalone module that receives the service as a parameter — keeps IPC registration decoupled from service logic. Pattern: `handle` for request/response (create, count), `on` for fire-and-forget (input, resize, kill).
- **Preload bridge namespace**: Added `terminal` sub-object to `electron_api` — keeps the API organized as more namespaces are added in future steps.
- **Data flow**: `Renderer (xterm.onData) → IPC send → Main (pty.write)` and `PTY onData → adaptive batch → IPC send → Renderer (terminal.write)`. Clean unidirectional flows.

## How it was tested

**8 Playwright e2e tests** in `tests/step-003-xterm-shell.spec.js`:

1. `.xterm` visible in DOM — confirms xterm.js initialized
2. `.xterm-screen` has non-zero dimensions — confirms layout/fit
3. Screenshot non-empty — visual sanity check
4. Type `echo HELLO_CCT` + Enter → buffer contains output — full roundtrip (input → PTY → output)
5. Buffer still contains `HELLO_CCT` — persistence check
6. Type `exit` → `data-terminal-exited="true"` attribute set — exit handler works
7. `terminal.count() === 0` — no orphan PTY processes after exit
8. `electron_api` bridge still exposed — step-001 regression check

**Full suite**: 22 tests pass (9 step-001 + 5 step-002 + 8 step-003) in ~3s.
**Build**: `npm run build` packages successfully with electron-builder.

## Lessons / gotchas

- **Native module ABI mismatch**: `node-pty` must be rebuilt for Electron's Node.js ABI. Adding `"postinstall": "electron-builder install-app-deps"` to package.json handles this automatically, but if deps are installed before the script exists, a manual `npx electron-builder install-app-deps` is needed. Symptom: `posix_spawnp failed` at runtime.
- **xterm.js renders to canvas**: Can't query terminal text via DOM selectors (`.xterm-rows > div`). Must use the `terminal.buffer.active` API to read buffer contents. Exposed via `window._cctGetBufferText()` for test access.
- **Timing of global function exposure**: The `_cctGetBufferText` function must be assigned to `window` before any `await` calls in the renderer init, otherwise a failed IPC call would prevent the assignment and tests would get `not a function`.

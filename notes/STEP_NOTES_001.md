# Step 001 - Electron macOS Skeleton

## What was done

Created a minimal Electron app with the following files:

- `main.js` — Entry point. PATH fix for macOS Finder launch, single instance lock, app lifecycle (`whenReady`, `window-all-closed`, `activate`).
- `src/main/windows/MainWindow.js` — BrowserWindow factory with macOS `hiddenInset` titlebar, traffic light positioning, secure `webPreferences`.
- `src/main/preload.js` — Context bridge exposing `electron_api` with a placeholder `getVersion` method and a reusable `createListener` helper.
- `index.html` — Minimal page with CSP header, loads `styles/base.css`, displays "CCT".
- `styles/base.css` — Dark theme, draggable titlebar region, centered content.
- `playwright.config.js` + `tests/step-001-skeleton.spec.js` — 9 Playwright e2e tests.

## Choices made

- **No esbuild yet** — The renderer is a plain HTML file with no bundling. esbuild will be added when we have JS modules to bundle (step 003+).
- **No window state persistence** — Skipped `loadWindowState`/`saveWindowState` from the reference project. Not needed at this stage; avoids premature complexity.
- **Vanilla CSS** — Matches the reference project. No CSS framework.
- **`sandbox: false`** — Required for preload to use Node.js APIs (`contextBridge`, `ipcRenderer`). Same choice as the reference project.

## Architecture decisions

- **Process separation**: Main → Preload → Renderer follows the Electron security model exactly as the reference project. `contextIsolation: true`, `nodeIntegration: false`.
- **`createListener` helper** in preload: adopted from the reference project. Returns an unsubscribe function — clean pattern for IPC event listeners.
- **macOS conventions**: `hiddenInset` titlebar with custom traffic light position (`x:12, y:10`), `-webkit-app-region: drag` on a dedicated titlebar div.
- **Single instance lock**: Prevents multiple app instances, same as reference.

## How it was tested

9 Playwright tests using `_electron.launch`:

```
✓ app launches without timeout (2ms)
✓ a window is created (0ms)
✓ window title contains CCT (25ms)
✓ screenshot is non-empty (253ms)
✓ app is not packaged (dev mode) (3ms)
✓ contextIsolation is true and nodeIntegration is false (5ms)
✓ preload bridge is exposed as electron_api (5ms)
✓ require is not leaked to renderer (1ms)
✓ app closes cleanly (0ms)

9 passed (2.7s)
```

Key assertions: window creation, title, security preferences via `getLastWebPreferences()`, preload bridge existence, no `require` leak, clean shutdown.

## Lessons / gotchas

- `getLastWebPreferences()` is the right method to inspect actual runtime preferences (not the options object passed to BrowserWindow constructor).
- Playwright Electron tests use `_electron` (underscore prefix) — still experimental but works reliably with Electron 28.
- Tests run with a single worker by default for Electron (can't share app instances). This is fine — 2.7s total.

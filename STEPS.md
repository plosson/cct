# CCT - Development Steps

## Testing Strategy

All steps are validated with **Playwright for Electron** (`@playwright/test` with `_electron.launch`).
Tests live in `tests/` and run via `npx playwright test`. Each step adds tests that remain green going forward.

```js
// Pattern used across all tests
import { test, expect, _electron as electron } from '@playwright/test';
const electronApp = await electron.launch({ args: ['.'] });
const window = await electronApp.firstWindow();
// ... assertions ...
await electronApp.close();
```

---

## Step 001 - Electron macOS skeleton
Create a minimal Electron app that launches a proper macOS window with titlebar-style traffic lights, correct `BrowserWindow` settings (`contextIsolation`, no `nodeIntegration`, preload script), and a basic HTML page. App should open, display "CCT" in the window, and quit cleanly.

**Validation (Playwright e2e + unit)**:
1. `electron.launch({ args: ['.'] })` succeeds without timeout
2. `electronApp.firstWindow()` resolves — a window is created
3. `window.title()` contains "CCT"
4. Screenshot of the window is taken and is non-empty (visual smoke test)
5. `electronApp.evaluate(({ app }) => app.isPackaged)` returns `false` (dev mode sanity)
6. `electronApp.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; return win.webPreferences })` confirms `contextIsolation: true` and `nodeIntegration: false`
7. `window.evaluate(() => typeof window.electron_api)` returns `'object'` (preload bridge exposed)
8. `window.evaluate(() => typeof require)` returns `'undefined'` (node not leaked to renderer)
9. `electronApp.close()` resolves cleanly — no crash, no zombie process

---

## Step 002 - CI/CD with GitHub Actions
Set up GitHub Actions pipelines: a **CI workflow** (lint, build, test on every push/PR) and a **release workflow** (build + publish macOS `.dmg`/`.zip` via `electron-builder` on tags). Include code signing placeholders.

**Validation (file checks + dry-run + CI itself)**:
1. `.github/workflows/ci.yml` exists and is valid YAML (parsed without error)
2. `.github/workflows/release.yml` exists and is valid YAML
3. CI workflow has jobs for: install, lint, build, test
4. Release workflow triggers on `v*` tags and uses `electron-builder`
5. `npm run build` succeeds locally (exit code 0)
6. `npm run lint` succeeds locally (exit code 0)
7. All Playwright tests from step 001 still pass
8. After pushing the branch, `gh run list --workflow=ci.yml` shows a run (CI triggered)

---

## Step 003 - xterm.js renders a local shell
Add xterm.js to the renderer. Spawn a basic shell (`zsh`) via `node-pty` in the main process. Wire PTY ↔ xterm through IPC. The terminal should be interactive.

**Validation (Playwright e2e)**:
1. `window.locator('.xterm')` is visible — xterm.js mounted in the DOM
2. `window.locator('.xterm-screen')` has non-zero dimensions (rendered, not collapsed)
3. Screenshot shows terminal content (not a blank black box)
4. Type `echo HELLO_CCT` into the terminal via keyboard: `window.locator('.xterm-helper-textarea').type('echo HELLO_CCT\n')`
5. Wait, then evaluate xterm buffer: `window.evaluate(() => document.querySelector('.xterm').innerText)` contains `HELLO_CCT`
6. Type `exit\n`, wait — PTY exit event fires, confirmed via `window.evaluate()` on a status flag or DOM change
7. `electronApp.evaluate(() => { /* check no orphan pty processes */ })` — process count is 0 after exit
8. All step 001 tests still pass

---

## Step 004 - Spawn a Claude Code session
Replace the plain shell with a `claude` CLI session. Spawn `claude` in a given directory via `node-pty`. Verify Claude Code's TUI renders correctly in xterm.js.

**Validation (Playwright e2e)**:
1. `electronApp.evaluate(({ app }) => { /* verify 'claude' is on PATH */ })` — `which claude` resolves
2. Launch app configured to spawn `claude` in a temp directory
3. `window.locator('.xterm')` is visible within 10s (Claude may take a moment to start)
4. Screenshot captured — visual confirmation that Claude TUI rendered (not raw escape codes)
5. Terminal buffer text (via xterm DOM) contains recognizable Claude UI markers (e.g. `>` prompt or Claude branding)
6. Send a keypress (e.g. `/help\n`) and verify terminal buffer updates with new content within 15s
7. Verify ANSI colors are rendered: `window.locator('.xterm span[style*="color"]')` count > 0 (colored output present)
8. Close the session — PTY terminates, no zombie `claude` process left (check via `electronApp.evaluate`)
9. All step 003 tests still pass (can still spawn a plain shell)

---

## Step 005 - Tabbed terminal area
Support multiple terminal instances with a tab bar. Each tab = one session. Clicking a tab switches the visible terminal. Tabs can be closed (kills the PTY).

**Validation (Playwright e2e)**:
1. On launch, one tab exists: `window.locator('[data-testid="tab"]')` count is 1
2. Trigger "new session" action — tab count becomes 2
3. Each tab has a label visible in the tab bar
4. Click tab 1: associated terminal is visible, tab 2's terminal is hidden
5. Click tab 2: it becomes visible, tab 1's terminal is hidden
6. Type a unique marker in tab 1 (`echo TAB1_MARKER`), switch to tab 2, switch back — marker still present in buffer (state preserved)
7. Close tab 2 via close button: `window.locator('[data-testid="tab"]')` count back to 1
8. After closing tab 2, its PTY process is gone: `electronApp.evaluate()` confirms active PTY count is 1
9. Close last tab — app handles gracefully (no crash), either shows empty state or creates a new tab
10. All step 004 tests still pass

---

## Step 006 - Sidebar with projects and sessions
Add a left sidebar listing projects (folders). Under each project, show its active sessions. Clicking a project creates a new session. Projects persisted to JSON.

**Validation (Playwright e2e)**:
1. `window.locator('[data-testid="sidebar"]')` is visible
2. Sidebar initially shows empty state or instructions
3. Add a project (trigger add-project action pointing to a temp directory): sidebar shows the project name
4. Click the project in sidebar: a new session tab appears, terminal starts in that folder
5. Verify terminal's working directory: type `pwd\n`, buffer contains the temp directory path
6. Add a second project: sidebar shows both, sorted or in insertion order
7. First project shows 1 active session indicator; second project shows 0
8. Create a second session under project 1: session count indicator updates to 2
9. Remove a project from sidebar: project disappears, its sessions are closed, tab count decreases accordingly
10. Restart the app (`electronApp.close()` then `electron.launch()`): sidebar still shows the previously added projects (persistence)
11. `window.evaluate(() => JSON.parse(require('fs').readFileSync(configPath, 'utf8')))` — projects JSON file contains expected entries
12. All step 005 tests still pass

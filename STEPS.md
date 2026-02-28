# CCT - Development Steps

## Step 001 - Electron macOS skeleton
Create a minimal Electron app that launches a proper macOS window with titlebar-style traffic lights, correct `BrowserWindow` settings (`contextIsolation`, no `nodeIntegration`, preload script), and a basic HTML page. App should open, display "CCT" in the window, and quit cleanly.

**Validates**: Electron boots, window appears, preload wiring works, macOS conventions respected.

## Step 002 - xterm.js renders a local shell
Add xterm.js to the renderer. Spawn a basic shell (zsh) via node-pty in the main process. Wire PTY ↔ xterm through IPC. The terminal should be interactive — you can type commands and see output.

**Validates**: node-pty spawns a process, IPC data flows both ways, xterm.js renders real terminal output.

## Step 003 - Spawn a Claude Code session
Replace the plain shell with a `claude` CLI session. Spawn `claude` in a given directory via node-pty. Verify that Claude Code's TUI renders correctly in xterm.js (colors, cursor, interactive prompts).

**Validates**: Claude Code runs inside xterm.js, TUI renders properly, input/output works end-to-end.

## Step 004 - Tabbed terminal area
Support multiple terminal instances. Add a tab bar above the terminal area. Each tab corresponds to one session. Clicking a tab switches the visible terminal. Tabs can be closed (kills the PTY).

**Validates**: Multiple concurrent PTY sessions, tab switching preserves terminal state, clean teardown on close.

## Step 005 - Sidebar with projects and sessions
Add a left sidebar listing projects (folders). Under each project, show its active sessions. Clicking a project creates a new session in that folder. Projects are persisted to a simple JSON file. The sidebar ↔ tab area are wired together.

**Validates**: Project add/remove, session creation from sidebar, sidebar reflects running sessions, state persists across restart.

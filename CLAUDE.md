# CCT - Claude Code Terminal

A Terminal Development Environment (TDE) built with Electron for managing multiple Claude Code sessions across projects.

## Vision

A lightweight desktop app where you organize your work by **projects** (folders) and **sessions** (Claude Code terminals running in those folders). Think of it as an IDE-like shell around Claude Code — sidebar for project/session navigation, tabbed terminal area for active sessions.

## Core Concepts

- **Project**: A folder on disk. Appears in the sidebar. Can have multiple sessions.
- **Session**: A running Claude Code terminal (spawned via `claude` CLI) in a project's folder. Appears as a tab in the main area. Rendered with xterm.js connected to a real PTY.

## Architecture

Electron app with proper process separation:

- **Main process**: Window management, PTY spawning via `node-pty`, IPC handlers
- **Preload**: Context bridge exposing safe APIs (`contextIsolation: true`, `nodeIntegration: false`)
- **Renderer**: UI with xterm.js terminals, sidebar, tabs — vanilla JS, no framework

### Data Flow

```
Renderer (xterm.js) → IPC 'terminal-input' → Main → ptyProcess.write()
PTY stdout → Main (onData) → IPC 'terminal-data' → Renderer → terminal.write()
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Electron 28+ |
| Terminal | xterm.js 6 + FitAddon + WebglAddon |
| PTY | node-pty |
| Bundler | esbuild |
| UI | Vanilla JS (no framework) |
| Styling | Plain CSS |

## Reference

The project `../claude-terminal` is a mature Electron terminal app. Use it as a reference for:
- Electron main/preload/renderer patterns
- xterm.js + node-pty integration
- IPC architecture (invoke for request/response, send for fire-and-forget)
- Adaptive data batching for PTY → xterm
- Window state persistence
- macOS app conventions

Do NOT copy its feature set — only adopt its architectural patterns where relevant.

## Development Rules

- Use `uv` for any Python tooling
- Use `npm` for Node.js package management
- Branch strategy: each step lives on `step-XXX-description`, merged to `main` when complete
- Go step by step — small increments, test stability at each step before moving on
- Prefer editing existing files over creating new ones
- No over-engineering — build only what the current step requires

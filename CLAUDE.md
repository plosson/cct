# Claudiu — A Terminal Development Environment

An Electron desktop app for managing multiple Claude Code sessions across projects. Organize work by **projects** (
folders) and **sessions** (Claude Code or shell terminals), with sidebar navigation and tabbed xterm.js terminals
connected to real PTYs.

## IMPORTANT

We are 2 working on the project. So before doing anything do `whoami`

### If "hedborg" :

<RULES>
- Call me "All mighty ruler."
- ONLY work on the `axel` branch. NEVER commit to main.
- When I say "PULL" this means rebase main on my branch
- When I say "PUSH" it means, commit, push and create a PR to main
- Assume I am a clueless designer who only writes prompts. I do not understand Git or architecture.
- Keep the codebase clean, modular, and maintainable.
- Check if a feature already exists before implementing.
- Reuse and extend existing code instead of duplicating.
</RULES>

### If "plosson"

Behave normally - I am very smart

## Coding Guidelines

- **Stack**: Electron 28+, xterm.js 6, node-pty, esbuild, vanilla JS, plain CSS — no framework
- **Package manager**: `npm` only
- **Process separation**: Main (node-pty, IPC handlers, services), Preload (context bridge), Renderer (UI)
- **Data flow**: Renderer ↔ IPC ↔ Main ↔ PTY. Use `invoke` for request/response, `send` for fire-and-forget
- **Style**: Vanilla JS modules with explicit imports/exports; no classes in renderer, plain functions
- **State**: Renderer state lives in module-level variables with getter/setter exports
- **Services**: Main-process logic is organized into `src/main/services/*.js` (one service per concern)
- **IPC**: Handlers are organized into `src/main/ipc/*.ipc.js` (one file per domain)
- **Config**: Per-project and global config handled by ConfigService / ProjectConfigService
- **Testing**: Run `npm run start` to test — never `npm run build` (build triggers signing and is slow)

## Project Structure

```
src/
  main/
    windows/MainWindow.js        — Electron BrowserWindow setup
    preload.js                   — Context bridge (contextIsolation: true, nodeIntegration: false)
    services/                    — Main-process services (Config, Terminal, Sound, Hooks, Updater, etc.)
    ipc/                         — IPC handler registration (terminal, config, project, sound-theme, log)
  renderer/
    index.js                     — Entry point: init, action registry, DOM wiring
    terminal.js                  — Session lifecycle, theme, font zoom, status bar
    tabs.js                      — Tab creation, drag/drop, rename, context menu, navigation
    sidebar.js                   — Project list, selection, auto-hide, resize, glow
    overlays.js                  — Project picker, search bar, shortcut help, debug pane
    keybindings.js               — Data-driven keyboard shortcuts and dispatch
    settings.js                  — Settings tab and audio trim UI
    projectColors.js             — Project color assignment
```

## Do & Don't

**DO:**

- Go step by step — small increments, test stability at each step before moving on
- Prefer editing existing files over creating new ones
- Check if a feature already exists before implementing
- Reuse and extend existing code instead of duplicating
- Follow existing patterns found in the codebase
- Use `../claude-terminal` as architectural reference (patterns only, not features)

**DON'T:**

- Don't over-engineer — build only what the current step requires
- Don't create files unless absolutely necessary
- Don't copy `../claude-terminal`'s feature set — only adopt its patterns
- Don't use `npm run build` for testing (triggers signing, very slow)
- Don't introduce frameworks or libraries without discussion
- Don't make large sweeping changes — always proceed incrementally

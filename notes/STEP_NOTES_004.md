# Step 004 — Spawn a Claude Code Session

## What was done

Extended the terminal infrastructure to spawn `claude` CLI sessions instead of just plain shells. The `TerminalService.create()` now accepts `command` and `args` parameters, allowing the caller to specify what to spawn. The renderer reads a config value (`CCT_COMMAND` env var) to determine the spawn command, defaulting to shell for backward compatibility.

**Files modified:**
- `src/main/services/TerminalService.js` — added `command` and `args` params to `create()`, clean `CLAUDECODE` env var from PTY env to avoid nested-session detection
- `src/main/preload.js` — added `config.spawnCommand` to the bridge, read from `CCT_COMMAND` env var
- `src/renderer/index.js` — reads `api.config.spawnCommand` to decide what to spawn (undefined = default shell)

**Files created:**
- `tests/step-004-claude-session.spec.js` — 8 Playwright e2e tests for Claude session validation

## Choices made

- **Generic `command` param over typed `type` enum**: `create({ command: 'claude' })` is simpler and more flexible than `create({ type: 'claude' })`. No premature abstraction — the caller decides what to spawn.
- **Env var (`CCT_COMMAND`) over app args**: The preload has direct access to `process.env`, making this zero-IPC overhead. Tests control behavior via `electron.launch({ env: { CCT_COMMAND: 'claude' } })`.
- **Default to shell, not claude**: Keeps Step 003 tests passing without modification. The app's real default will change in later steps when sessions are user-initiated.
- **Strip `CLAUDECODE` env var**: Claude Code sets this to detect nested sessions and refuses to start inside another Claude Code. Since CCT spawns Claude in a PTY that inherits the parent env, this var must be removed.

## Architecture decisions

- **Config via preload bridge**: `electron_api.config.spawnCommand` — lightweight, no IPC round-trip. The preload reads `process.env.CCT_COMMAND` at load time and exposes it statically. Pattern extends naturally to other config values later.
- **No changes to IPC layer or preload terminal API**: The `terminal.create(params)` already passes arbitrary params through. Adding `command`/`args` was purely a TerminalService change.

## How it was tested

**8 Playwright e2e tests** in `tests/step-004-claude-session.spec.js`:

1. `which claude` resolves — Claude CLI available on PATH
2. `.xterm` visible — xterm.js mounted when spawning Claude
3. Screenshot non-empty, no raw escape codes in buffer — TUI renders properly
4. Buffer contains Claude UI markers (`>`, `claude`, `tips`, `help`)
5. `.xterm-rows span[style*="color"]` count > 0 — ANSI colors rendered via DOM renderer
6. Type `/help` + Enter → buffer content changes — interactive command works
7. Escape + `/exit` → terminal count drops to 0 — no zombie process
8. `terminal.create({ cols: 80, rows: 24 })` (no command) → still spawns shell — regression check

**Full suite**: 30 tests pass (9 step-001 + 5 step-002 + 8 step-003 + 8 step-004) in ~9s.
**Build**: `npm run build` succeeds. `npm run lint` passes.

## Lessons / gotchas

- **`CLAUDECODE` env var blocks nesting**: Claude Code sets `CLAUDECODE` in its environment. Child processes that inherit this env will be detected as nested sessions and refuse to launch with "Claude Code cannot be launched inside another Claude Code session." Must explicitly delete this from the PTY env.
- **xterm.js DOM renderer**: Without loading `WebglAddon` or `CanvasAddon`, xterm.js 6 falls back to DOM rendering (class `xterm-dom-renderer-owner-1`). Color detection works via `.xterm-rows span[style*="color"]`, not canvas pixel sampling.
- **Test ordering matters with Claude TUI**: Claude's TUI redraws the screen on commands like `/help`. Tests that check DOM state (like color spans) must run before tests that trigger redraws, or use polling/retry patterns.
- **`/exit` needs Escape first**: After sending `/help`, Claude may be in a state where `/exit` doesn't immediately register. Sending Escape first clears any pending state and makes `/exit` reliable.

# Step 039 — Generic HTTP Hook System

## What was done

Replaced the single `SessionStart` command hook with a hook system covering all 17 Claude Code events. Uses HTTP hooks for 16 events and a command hook for `SessionStart` (Claude Code doesn't support HTTP hooks for that event).

**Files created:**
- `src/main/services/HookServerService.js` — Local HTTP server (127.0.0.1:0) that receives POST /hooks from Claude Code, links Claude session IDs to Claudiu sessions on SessionStart, logs all events to debug pane, and broadcasts to renderer via IPC.

**Files modified:**
- `src/main/services/HooksService.js` — Two event lists: `HTTP_HOOK_EVENTS` (16 events) and `COMMAND_HOOK_EVENTS` (SessionStart). HTTP hooks use `X-Claudiu-Hook: true` header for detection. SessionStart uses a curl command hook that forwards stdin and passes `$CLAUDIU_SESSION_ID` via header.
- `src/main/services/ProjectConfigService.js` — Added `updateClaudeSessionId()` to link Claude's session ID to a Claudiu session.
- `src/main/ipc/terminal.ipc.js` — Removed pre-generation of `claudeSessionId`. Claude generates its own ID; linked via SessionStart hook. `--resume` passed when restoring sessions with a known `claudeSessionId`.
- `main.js` — Async startup: start HookServerService, install hooks, then create window. Stop server on before-quit.
- `src/main/preload.js` — Added `hooks: { onEvent }` namespace to electron_api.
- `tests/step-006-sidebar-projects.spec.js` — Test 30 verifies 16 HTTP hooks + 1 command hook. Test 31 verifies POST returns 200.

**Files deleted:**
- `src/main/hooks/claudiu-hook-handler.js` — Replaced by HookServerService.

## Choices made

- **HTTP hooks for most events**: Claude Code's `type: "http"` hooks POST JSON directly. Server returns 200 immediately (observe-only, never blocks Claude).
- **Command hook for SessionStart**: Claude Code explicitly skips HTTP hooks for SessionStart (`Skipping HTTP hook — HTTP hooks are not supported for SessionStart`). Workaround: a command hook that reads stdin and curls the HTTP server, passing `$CLAUDIU_SESSION_ID` from the environment.
- **No pre-generated session IDs**: Claude generates its own `session_id`. On SessionStart, the command hook passes `$CLAUDIU_SESSION_ID` (set by Claudiu in the PTY environment) as a header. The hook server links the two IDs via `updateClaudeSessionId()`.
- **Dynamic port (port 0)**: OS assigns an available port. No conflicts.
- **`X-Claudiu-Hook: true` marker**: Used to detect Claudiu hooks in both HTTP headers and command strings. Enables clean coexistence with user hooks.

## Architecture decisions

- Session resume flow: Claudiu spawns Claude → SessionStart hook fires → command hook curls server with `CLAUDIU_SESSION_ID` header + Claude's `session_id` in body → server links them in `.claudiu/sessions.json` → on Claudiu restart, reads `claudeSessionId` from sessions.json → passes `--resume <claudeSessionId>`.
- HTTP hooks don't expand env vars in headers (discovered during debugging). Only command hooks have access to shell env vars via `allowedEnvVars`.
- `isActuallyClaude` guard was removed — if `type === 'claude'` and there's a `resumeId`, always pass `--resume`. The guard was blocking resume when the claude command resolved to a full path (e.g., `/Users/.../.local/bin/claude`).

## How it was tested

- **Test 30**: Verifies 16 HTTP hooks + 1 command hook are installed with correct structure.
- **Test 31**: POSTs to hook server, asserts 200 response.
- **Manual testing**: Confirmed SessionStart, UserPromptSubmit, Stop events appear in debug pane. Confirmed session resume works across Claudiu restarts.

## Lessons / gotchas

- **Claude Code doesn't support HTTP hooks for SessionStart** — explicitly logged in debug: `Skipping HTTP hook — HTTP hooks are not supported for SessionStart`. Must use command hooks for this event.
- **HTTP hooks don't expand env vars in headers** — `$CLAUDIU_SESSION_ID` in HTTP header values arrives as empty string. `allowedEnvVars` only works for command hooks.
- **Command resolution vs resume** — `configService.resolve('claudeCommand')` can return a full path like `/Users/.../.local/bin/claude`. Any string comparison against bare `'claude'` will fail. Use `path.basename()` or avoid the check entirely.
- The `before-quit` handler calls `hookServerService.stop()` without await — best-effort cleanup.

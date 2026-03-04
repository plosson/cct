# Step 039 — Generic HTTP Hook System

## What was done

Replaced the single `SessionStart` command hook with a full HTTP hook system covering all 17 Claude Code events.

**Files created:**
- `src/main/services/HookServerService.js` — Local HTTP server (127.0.0.1:0) that receives POST /hooks from Claude Code, identifies CCT sessions via custom headers, handles SessionStart specially (links Claude session ID), and broadcasts all events to renderer via IPC.

**Files modified:**
- `src/main/services/ProjectConfigService.js` — Added `updateClaudeSessionId()` method that searches across all cached projects to find and update a session entry.
- `src/main/services/HooksService.js` — Expanded from 1 to 17 hook definitions, switched from `type: "command"` to `type: "http"`, detection via `X-CCT-Hook` header instead of command string, `installHooks()` now takes port parameter. Exported `HOOK_DEFINITIONS` for test use.
- `main.js` — Made `app.whenReady()` async, instantiate and start HookServerService before installHooks, stop server on before-quit.
- `src/main/preload.js` — Added `hooks: { onEvent }` namespace to electron_api.
- `tests/step-006-sidebar-projects.spec.js` — Rewrote test 30 (verifies all 17 HTTP hooks with correct structure), added test 31 (POST to hook server returns 200).

**Files deleted:**
- `src/main/hooks/cct-hook-handler.js` — No longer needed; HTTP server replaces the standalone Node script.
- `src/main/hooks/` directory — Empty after handler removal.

## Choices made

- **HTTP over command hooks**: Claude Code's `type: "http"` hooks POST JSON directly to a URL, eliminating the stdin→file workaround. The hook server returns 200 immediately (observe-only, never blocks Claude).
- **Dynamic port (port 0)**: OS assigns an available port — no port conflict possible. Port is passed to `installHooks()` at startup.
- **Header-based session identification**: `X-CCT-Session-Id` and `X-CCT-Project-Id` headers use env var interpolation (`$CCT_SESSION_ID`). Non-CCT sessions have unexpanded `$VAR` literals → silently ignored.
- **`X-CCT-Hook: true` marker**: Replaces the old `cct-hook-handler` command string for detecting our hooks. Clean separation from user hooks.

## Architecture decisions

- HookServerService follows the existing service pattern (constructor injection, start/stop lifecycle).
- `updateClaudeSessionId` searches across the ProjectConfigService cache — no need to know which project a session belongs to, matching by CCT session UUID.
- All 17 events installed even though only SessionStart has special handling today — this gives CCT visibility into the full Claude Code lifecycle for future features without reinstalling hooks.
- Events with matcher support get `matcher: ""` (catch-all); events without matchers omit the field entirely.

## How it was tested

- **Test 30**: Reads the isolated settings file, verifies all 17 hook events are present with `type: "http"`, correct URL pattern, `X-CCT-Hook` header, and session/project header templates.
- **Test 31**: Extracts the port from installed hooks, POSTs a JSON payload to the hook server, asserts 200 response with `{}` body.
- All 256 tests pass (29.1s).

## Lessons / gotchas

- The old `getHandlerPath()` function referenced the hooks/ directory — deleting the directory required also cleaning up all references (the function was removed as part of the rewrite).
- `allowedEnvVars` must be set at the hook entry level (not inside individual hooks) for Claude Code to interpolate env vars in headers.
- The `before-quit` handler calls `hookServerService.stop()` without await since the app is shutting down — the server close is best-effort.

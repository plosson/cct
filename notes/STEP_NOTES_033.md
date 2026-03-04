# Step 033 — Configuration Screen

## What was done

Added a global configuration system with a settings overlay (Cmd+,) for managing claude and terminal command settings at both global and per-project levels.

**New files:**
- `src/main/services/ConfigService.js` — Typed, extensible config service with schema-driven settings. Stores global config in `userData/config.json`, per-project config in `.claudiu/config.json`. Hierarchy resolution: project → global → schema default.
- `src/main/ipc/config.ipc.js` — IPC handlers for get/set global, get/set project, resolve, resolveAll, getSchema.
- `tests/step-033-configuration.spec.js` — 13 Playwright tests covering overlay open/close, save/cancel, global persistence, project overrides, config resolution hierarchy, and schema API.

**Modified files:**
- `main.js` — Instantiate ConfigService, register config IPC, pass configService to terminal IPC.
- `src/main/ipc/terminal.ipc.js` — Resolve command from ConfigService hierarchy instead of relying on renderer-provided command. Simplified to a single branch for both claude/terminal.
- `src/main/preload.js` — Added `appConfig` namespace to context bridge API.
- `src/renderer/index.js` — Settings overlay UI (Cmd+, keybinding), Global/Project tab switching, form fields generated from schema, save/cancel flow. Also removed old `api.config.spawnCommand` usage. Added "Project Settings…" to project context menu.
- `styles/base.css` — Settings overlay, tabs, input rows, action buttons CSS.
- `tests/step-028-project-context-menu.spec.js` — Updated to expect 4 items (added "Project Settings…").

## Choices made

- **Schema-driven config** — Settings defined once in `CONFIG_SCHEMA` object (label, type, default, description). The UI and validation are generated from the schema, so adding new settings in the future requires only a schema entry — no UI or IPC changes.
- **Hierarchy resolution in main process** — The renderer no longer resolves commands; the main process does it in terminal IPC. This ensures config is always authoritative and avoids stale values.
- **Overlay pattern** — Reused the same overlay/panel pattern as project picker and shortcut help for consistency.
- **`_applyValues` helper** — Consolidated the repeated clear-or-set logic into a single private method to avoid duplication across set methods.

## Architecture decisions

- **ConfigService is a standalone service** (not merged into ProjectConfigService) because it handles global state and has a different lifecycle — ProjectConfigService manages session tracking per-project, ConfigService manages user preferences.
- **Config stored in separate files** — Global in `userData/config.json` (alongside `projects.json`, `window-state.json`), per-project in `.claudiu/config.json` (alongside existing `.claudiu/sessions.json`). Keeps concerns separated.
- **`appConfig` preload namespace** — Chose a distinct name to avoid collision with the existing `config` namespace (which had `spawnCommand`).

## How it was tested

13 Playwright tests in `step-033-configuration.spec.js`:
1. Cmd+, opens overlay
2. Global and Project tabs present
3. Inputs for claudeCommand and terminalCommand
4. Default placeholder shows "claude"
5. Escape closes overlay
6. Saving persists to `config.json`
7. Re-opening shows saved value
8. Project tab shows empty with global as placeholder
9. Project save persists to `.claudiu/config.json`
10. Config resolution returns project override
11. Config resolution falls back to global
12. Cancel closes without saving
13. Schema available via IPC

All 18 tests pass (13 new + 5 existing step-028 after update).

## Lessons / gotchas

- The old `api.config.spawnCommand` (from preload's `process.env.CLAUDIU_COMMAND`) is still respected in tests via `CLAUDIU_COMMAND` env var, but production command resolution now goes through ConfigService. The env var continues to work for test isolation.
- Project tab is disabled when no project is selected — prevents confusion.
- The settings input event handler was simplified to use the already-bound `values` reference instead of branching on `isProject`.

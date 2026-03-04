# Step 041 — Rename CCT to Claudiu

## What was done

Renamed the entire app from "CCT" (Claude Code Terminal) to "Claudiu" across all source code, tests, documentation, and CI/CD.

### Files modified (~70 files total)

**App identity:**
- `package.json` — name, description, bin field
- `electron-builder.config.js` — appId, productName
- `index.html` — window title
- `main.js` — startup log message, comment

**CLI binary:**
- `bin/cct` renamed to `bin/claudiu` — all contents updated (comments, variables, `/Applications/Claudiu.app`)

**Environment variables (5 vars across 6 source files):**
- `CCT_HEADLESS` → `CLAUDIU_HEADLESS`
- `CCT_USER_DATA` → `CLAUDIU_USER_DATA`
- `CCT_COMMAND` → `CLAUDIU_COMMAND`
- `CCT_SESSION_ID` → `CLAUDIU_SESSION_ID`
- `CCT_PROJECT_ID` → `CLAUDIU_PROJECT_ID`

**HTTP hook headers:**
- `X-CCT-Hook` → `X-Claudiu-Hook`
- `X-CCT-Session-Id` → `X-Claudiu-Session-Id`

**Custom protocol:**
- `cct-sound://` → `claudiu-sound://`

**Per-project config directory:**
- `.cct/` → `.claudiu/` with auto-migration in ProjectConfigService and ConfigService

**Electron userData migration:**
- Auto-copies `projects.json`, `config.json`, `window-state.json` from `~/Library/Application Support/cct/` to `~/Library/Application Support/claudiu/` on first launch

**Window globals (18 functions):**
- All `window._cct*` → `window._claudiu*` in `src/renderer/index.js`

**Tests (33 files):**
- All test helpers and 32 spec files updated for new naming

**Documentation (~25 files):**
- `CLAUDE.md`, `STEPS.md`, all `notes/STEP_NOTES_*.md`, all `docs/plans/*.md`

**CI/CD:**
- `.github/workflows/release.yml` — artifact name prefix

## Choices made

- **Auto-migrate `.cct/` → `.claudiu/`**: Both ProjectConfigService and ConfigService independently check for the legacy directory and rename it. Idempotent and handles either service being first to access the project.
- **Copy (not move) userData**: The old `~/Library/Application Support/cct/` directory is preserved in case the old app version is still installed. Only 3 files are copied.
- **GitHub repo stays `cct`**: The `publish.repo` field in electron-builder.config.js is unchanged — the owner will rename the GitHub repo separately.
- **Tab icon type classes**: Added `tab-icon-claude` and `tab-icon-terminal` CSS classes to fix tests that relied on type-specific selectors.

## Architecture decisions

- **Dual migration in both config services**: ProjectConfigService and ConfigService both check for `.cct/` → `.claudiu/` migration independently. This avoids coupling them and handles the case where either is accessed first.
- **`LEGACY_CONFIG_DIR` constant**: The old `.cct` name is preserved as a named constant for clarity, not a magic string.
- **userData migration before single-instance lock**: The migration runs early in `main.js` to ensure data is available before any service initialization.

## How it was tested

260 Playwright tests — all passing. Tests cover:
- Window title says "Claudiu"
- CLI binary `bin/claudiu` exists and is executable
- `.claudiu/sessions.json` created in project dirs
- `$CLAUDIU_PROJECT_ID` and `$CLAUDIU_SESSION_ID` env vars set in terminals
- Hook headers use `X-Claudiu-Hook`
- All existing functionality unchanged

Also fixed 5 pre-existing test failures during the rename:
- Hook server test used wrong event type (SessionStart is command, not HTTP)
- Duplicate tab tests expected CSS classes that didn't exist (added `tab-icon-claude`/`tab-icon-terminal`)
- Dark theme tests expected wrong CSS values (rgba with transparency, not opaque hex)

## Lessons / gotchas

- **macOS vibrancy makes background checks tricky**: With `transparent: true` and vibrancy enabled, computed `backgroundColor` on body and `.app` is `rgba(0, 0, 0, 0)`. Tests must check CSS custom property values directly.
- **SessionStart hooks are command type, not HTTP**: Claude Code explicitly skips HTTP hooks for SessionStart. Tests that extract the hook server URL must use a different event.
- **Plan documents got self-referentially renamed**: The docs subagent renamed "CCT" to "Claudiu" inside the rename plan itself, making the plan read "Rename Claudiu → Claudiu". Harmless but amusing.

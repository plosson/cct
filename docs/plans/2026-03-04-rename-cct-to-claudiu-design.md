# Rename Claudiu → Claudiu — Design

## Summary

Rename the app from "Claudiu" (Claude Code Terminal) to "Claudiu" across the entire codebase. The GitHub repo name (`cct`) will be changed separately by the owner.

## Decisions

- **Auto-migrate** `.claudiu/` → `.claudiu/`: On first read, if `.claudiu/` doesn't exist but `.claudiu/` does, rename it automatically.
- **Description**: "Claudiu — A Terminal Development Environment"
- **GitHub publish.repo**: Stays `"claudiu"` for now (owner will change repo name separately)

## Scope

### App identity
| File | Old | New |
|------|-----|-----|
| `package.json` | `"name": "claudiu"` | `"name": "claudiu"` |
| `package.json` | `"description": "Claude Code Terminal..."` | `"Claudiu — A Terminal Development Environment"` |
| `package.json` | `"bin": { "claudiu": "bin/claudiu" }` | `"bin": { "claudiu": "bin/claudiu" }` |
| `electron-builder.config.js` | `appId: "com.claudiu.app"` | `appId: "com.claudiu.app"` |
| `electron-builder.config.js` | `productName: "Claudiu"` | `productName: "Claudiu"` |
| `index.html` | `<title>Claudiu</title>` | `<title>Claudiu</title>` |
| `main.js` | `'Claudiu started'` | `'Claudiu started'` |

### CLI binary
- Rename file `bin/claudiu` → `bin/claudiu`
- Update all references inside the script (comments, `CCT_APP`, `/Applications/Claudiu.app` → `/Applications/Claudiu.app`)

### Custom protocol
- `claudiu-sound://` → `claudiu-sound://` in `main.js` and `SoundThemeService.js`

### Environment variables
| Old | New |
|-----|-----|
| `CLAUDIU_HEADLESS` | `CLAUDIU_HEADLESS` |
| `CLAUDIU_USER_DATA` | `CLAUDIU_USER_DATA` |
| `CLAUDIU_COMMAND` | `CLAUDIU_COMMAND` |
| `CLAUDIU_SESSION_ID` | `CLAUDIU_SESSION_ID` |
| `CLAUDIU_PROJECT_ID` | `CLAUDIU_PROJECT_ID` |

### HTTP hook headers
| Old | New |
|-----|-----|
| `X-Claudiu-Hook` | `X-Claudiu-Hook` |
| `X-Claudiu-Session-Id` | `X-Claudiu-Session-Id` |

### Per-project config directory
- `CONFIG_DIR = '.cct'` → `'.claudiu'` in `ProjectConfigService.js`
- Same in `ConfigService.js`
- `.gitignore`: `.claudiu/` → `.claudiu/`
- Auto-migration: in the config read path, if `.claudiu/` doesn't exist but `.claudiu/` does, rename it

### Window globals (test helpers)
- All `window._claudiu*` → `window._claudiu*` in `src/renderer/index.js` (~20 exports)
- All test files that reference `_claudiu*` helpers

### Test temp dirs
- `claudiu-test-*` → `claudiu-test-*` in all test files and `tests/helpers.js`

### Code comments & variable names
- `claudiuSessionId` → `claudiuSessionId` in HookServerService.js, ProjectConfigService.js
- All comments mentioning Claudiu in source files

### Documentation
- `CLAUDE.md` — update title and all Claudiu references
- `STEPS.md` — update CLI examples
- `notes/STEP_NOTES_*.md` — update all Claudiu mentions
- `docs/plans/*.md` — update all Claudiu mentions

### CI/CD
- `.github/workflows/release.yml` — artifact name `claudiu-dev-` → `claudiu-dev-`
- `package-lock.json` — regenerated via `npm install`

### Electron userData migration
- On startup (in `main.js`, before any service init), check if `~/Library/Application Support/claudiu/` is empty/missing but `~/Library/Application Support/cct/` exists
- Copy `projects.json`, `window-state.json`, `config.json`, `claude-settings.json` from old to new
- Log the migration

## Risk

- Existing user installations have `.claudiu/` directories — handled by auto-migration
- Claude hooks in `~/.claude/settings.json` still reference old `X-Claudiu-Hook` headers — these get rewritten on next app launch via `HooksService.installHooks()`
- Electron userData migration handled automatically on first launch

# Step 046 — Tests for Copy-on-Write Themes

## What was done

- Created `tests/step-045-cow-themes.spec.js` with 13 tests covering the COW theme system introduced in step 045
- **Bug fix**: Fixed `src/main/ipc/sound-theme.ipc.js` — the `saveTrim` and `uploadSound` handlers called `configService.setGlobal()` and `configService.setProject()`, which don't exist. The correct methods are `configService.setGlobalAll()` and `configService.setProjectAll()` with a read-merge-write pattern to preserve other config keys

## Tests

### IPC/Service Tests (1–10)
| # | Test | Verifies |
|---|------|----------|
| 1 | listThemes includes builtIn flag | `soundThemes.list()` returns default with `builtIn: true` |
| 2 | getSounds returns claudiu-sound:// URLs | All URLs use the custom protocol |
| 3 | forkTheme creates writable copy | `default-custom/` dir created, theme.json has "(Custom)" name, `forkedFrom`, no `builtIn` |
| 4 | forkTheme fails on non-existent theme | Returns `{ success: false }` |
| 5 | saveTrim on built-in auto-forks | Returns `{ forked: true }`, config.json updated to `default-custom`, trim data in theme.json |
| 6 | saveTrim on custom theme no fork | Returns `{ forked: false }` |
| 7 | removeSound blocked on built-in | Returns `{ success: false }` with error mentioning "built-in" |
| 8 | removeSound works on custom theme | Event removed from theme.json, audio file deleted |
| 9 | upload to built-in forks then accepts sound | Fork + manual file placement verified via `list()` |
| 10 | legacy sound-overrides cleaned up | Directory absent after launch |

### UI Tests (11–13)
| # | Test | Verifies |
|---|------|----------|
| 11 | Built-in source label | Source column shows "Built-in" for default theme |
| 12 | Remove button hidden | No `[data-testid="settings-sound-remove-*"]` elements for built-in themes |
| 13 | Export button visible | "Export as ZIP" button exists in the install row |

## Choices made

- **Test 9 (upload)**: The upload IPC handler opens a native file dialog that can't be automated. Instead of trying to `require` the service inside `electronApp.evaluate` (which doesn't support `require`), the test forks via IPC and manually places a file + updates theme.json, then verifies via `list()`. This tests the same logical outcome.
- **Config reset via IPC**: For UI tests, we reset the active theme via `appConfig.setGlobal()` rather than writing config.json directly, since the ConfigService caches values in memory.

## Architecture decisions

- The bug fix uses a read-merge-write pattern (`{ ...configService.getGlobal(), soundTheme: newValue }`) to avoid wiping other config keys when `setGlobalAll` replaces the entire config object.

## How it was tested

```
npx playwright test tests/step-045-cow-themes.spec.js  → 13 passed
npx playwright test                                     → 275 passed (29.8s)
```

## Lessons / gotchas

- `configService.setGlobal()` was never tested before because upload/trim for built-in themes had no test coverage — this was a real bug in production code that would cause a crash when auto-forking via saveTrim or upload
- `electronApp.evaluate()` in Playwright Electron does NOT have access to `require()` — only the destructured Electron module is available as the first argument
- Writing config.json from Node.js (test process) does not update the in-memory ConfigService — always use IPC to change config when the app is running

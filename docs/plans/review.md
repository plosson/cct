# Code Review — Copy-on-Write Sound Theme System

**Date**: 2026-03-04
**Branch**: `step-046-cow-theme-tests`
**Reviewers**: 3 parallel agents (architecture, duplication, test coverage)

## Files Reviewed

- `src/main/ipc/sound-theme.ipc.js` (115 lines, 10 IPC handlers)
- `src/main/services/SoundThemeService.js` (637 lines, ~20 methods)
- `src/main/services/ConfigService.js` (config dependency)
- `src/main/preload.js` (context bridge)
- `tests/step-045-cow-themes.spec.js` (226 lines, 13 tests)

## Critical Issues: None

## High Priority

### H1. Duplicated config-update-after-fork logic

**Location**: `sound-theme.ipc.js:86-92, 103-109`

The "if forked, update config" block is copy-pasted identically for `upload-sound` and `save-trim`. If the config-update
logic ever changes, it must be changed in two places. The uncommitted diff already had to fix both in lockstep.

**Recommendation**: Extract `_updateThemeInConfig(configService, projectPath, dirName)` helper.

### H2. Dead code: `installBuiltInThemes()` overlaps with `_seedDefaultTheme()`

**Location**: `SoundThemeService.js:84-112`

Both methods seed the default theme but use different path resolution strategies. The constructor calls
`_seedDefaultTheme()`, making `installBuiltInThemes()` a runtime no-op. The "mark as builtIn" block is copy-pasted
verbatim in both.

**Recommendation**: Consolidate into a single seeding method. Remove `installBuiltInThemes()`.

### H3. No `dirName`/`eventName` input validation in IPC layer

**Location**: `sound-theme.ipc.js:36,40,49,53`

`dirName` and `eventName` come from the renderer without validation. While `removeTheme()` and `getSoundPath()` have
path traversal guards, `forkTheme()`, `removeSoundFromTheme()`, `exportThemeAsZip()`, and `uploadSoundToTheme()` do not.

**Recommendation**: Add centralized `_validateDirName(dirName)` in `SoundThemeService` rejecting `..`, `/`, `\`, null
bytes. Also validate `eventName` to alphanumeric + expected characters.

### H4. Test 9 doesn't test actual code

**Location**: `step-045-cow-themes.spec.js`

Test 9 manually writes files to simulate upload instead of calling the `sound-theme-upload-sound` IPC handler. The real
upload COW logic (fork + config update + file copy) is never executed.

**Recommendation**: Rewrite to call the actual IPC handler, or mark it as a simulation and add a real integration test.

### H5. 5 of 10 IPC handlers untested

**Location**: `step-045-cow-themes.spec.js`

| IPC Handler                  | Tested?        | Testable?         |
|------------------------------|----------------|-------------------|
| `sound-theme-list`           | Yes            | —                 |
| `sound-theme-install-zip`    | No             | Needs dialog mock |
| `sound-theme-install-github` | No             | Yes               |
| `sound-theme-remove`         | No             | Yes               |
| `sound-theme-fork`           | Yes            | —                 |
| `sound-theme-get-sounds`     | Yes            | —                 |
| `sound-theme-remove-sound`   | Yes            | —                 |
| `sound-theme-export`         | No             | Needs dialog mock |
| `sound-theme-upload-sound`   | Simulated only | Yes               |
| `sound-theme-save-trim`      | Yes            | —                 |

## Medium Priority

### M1. Inconsistent path traversal checks

**Location**: `SoundThemeService.js`

Only `removeTheme()` (line 331) and `getSoundPath()` (lines 353-355) have path containment checks. Other methods that
accept `dirName` do not.

**Recommendation**: Centralize via `_resolveAndValidateThemeDir(dirName)` that all public methods call.

### M2. Repeated `BrowserWindow.fromWebContents` pattern

**Location**: `sound-theme.ipc.js:19, 54, 70`

Three handlers have identical inline `require('electron')` + `BrowserWindow.fromWebContents(event.sender)`.

**Recommendation**: Extract `getWindowFromEvent(event)` helper at top of file.

### M3. Duplicated value normalization pattern

**Location**: `SoundThemeService.js` (4 locations: `getSoundMap`, `removeSoundFromTheme`, `_modifyThemeEvent`,
`saveTrimData`)

The pattern `Array.isArray(value) ? value : [value]` + `typeof item === 'string' ? item : item.file` appears 3-4 times.

**Recommendation**: Extract `_normalizeEventItems(value)` and `_getFilename(item)` helpers.

### M4. Magic string `'none'`

**Location**: `sound-theme.ipc.js:81,98` and `SoundThemeService.js:501`

The sentinel value `'none'` for "no theme active" is a bare string in 3 places.

**Recommendation**: Define `const NO_THEME = 'none'` and use consistently.

### M5. Zero security-path tests

**Location**: `step-045-cow-themes.spec.js`

Path traversal guards in `removeTheme()` and `getSoundPath()` are never exercised by tests.

**Recommendation**: Add tests with `../../` payloads to verify guards work.

### M6. Sequential test coupling

**Location**: `step-045-cow-themes.spec.js`

Tests 3->5->6->8->9 depend on each other's filesystem state. If test 3 fails, tests 5-9 cascade. Test 6 explicitly
says "default-custom should exist from test 5."

**Recommendation**: Use `test.describe.serial()` or isolate state per test with proper setup.

## Low Priority / Info

### L1. `getResolvedSoundMap()` is a trivial wrapper

**Location**: `SoundThemeService.js:500-503`

Leftover from the old override system. Now just a null guard around `getSoundMap()`.

### L2. Inconsistent logging bypasses `_log()` helper

**Location**: `SoundThemeService.js:61, 77`

Two lines in `_seedDefaultTheme()` directly access `this._logService` instead of using `this._log()`.

### L3. Test 10 (legacy cleanup) is a no-op

**Location**: `step-045-cow-themes.spec.js`

Checks that a legacy directory doesn't exist, but it was never seeded. Always passes regardless.

**Recommendation**: Pre-seed `sound-overrides/` in `beforeAll` to actually test cleanup.

### L4. Weak assertions in tests 2, 4, 10, 12

- Test 2: Only checks URL scheme, not event content
- Test 4: Only checks `success: false`, not error message
- Test 10: Smoke test, always passes
- Test 12: Checks button count but not why

### L5. Uncommitted diff is a genuine bug fix

**Location**: `sound-theme.ipc.js`

The change from `setProject`/`setGlobal` to `setProjectAll`/`setGlobalAll` with spread is correct. The old code replaced
the entire config with just `{ soundTheme: ... }`, nuking other settings. Should be committed.

### L6. `forkTheme()` silently overwrites existing fork

**Location**: `SoundThemeService.js:131-133`

If `default-custom` already exists, it's deleted and re-created from built-in. Customizations in the existing fork are
lost without warning.

## Positive Findings

- IPC pattern is consistent with other IPC files (single register function, `ipcMain.handle`, service injection)
- Preload bridge correctly wraps all IPC calls; dialog operations stay in main process
- COW `ensureWritable()` pattern is clean and centralized
- Legacy migration (`_cleanupLegacyOverrides`) is a nice touch
- Synchronous file I/O is acceptable for the use case (small theme files)

## Test Coverage Estimate

~40-45% of service code paths, 50% of IPC handlers.

## Top 3 Recommendations

1. **Extract helpers** — `_updateThemeInConfig()` for fork config logic, `_resolveAndValidateThemeDir()` for centralized
   path validation
2. **Add missing tests** — `removeTheme` happy/error paths, `save-trim` with no active theme, path traversal guards, fix
   test 9 to call actual IPC
3. **Remove dead code** — consolidate `installBuiltInThemes()` into `_seedDefaultTheme()`

# Step 047 — Remove Multi-Sound-Per-Event Support

## What was done

Simplified the sound theme system from supporting arrays of sounds per event (with random selection) to exactly 1 sound per event. Changed 5 files:

- **`SoundThemeService.js`** — `getSoundMap()` returns `{ url, trimStart?, trimEnd? }` per event (not arrays). `removeSoundFromTheme()` handles a single value. `_modifyThemeEvent()` removed `fileIndex` param, applies transform directly. `saveTrimData()` and `removeTrimData()` lost their `fileIndex` params.
- **`sound-theme.ipc.js`** — Removed `fileIndex` from `sound-theme-save-trim` handler destructuring.
- **`preload.js`** — `saveTrim()` signature: `(eventName, trimStart, trimEnd, projectPath)`.
- **`renderer/index.js`** — Removed sub-row loop (`for fi`), count badges, sub-row indentation, `fileIndex` from `openTrimUI()`. `loadSoundTheme()` caches single objects. `playEventSound()` plays directly (no random pick).
- **`step-045-cow-themes.spec.js`** — Test 2 expects objects not arrays. Tests 5/6 call `saveTrim` without `fileIndex`.

## Choices made

- Kept backward-compatible `Array.isArray` checks in `getSoundMap()` and `removeSoundFromTheme()` to gracefully handle any legacy theme.json that still has arrays (takes first element). This is a defensive choice since theme files on disk aren't migrated.
- Removed CSS class references (`settings-sound-sub`, `settings-sound-count`) that were only used in the deleted code — no CSS cleanup needed since they weren't defined in CSS either.

## Architecture decisions

- The sound cache in the renderer now stores `{ audio, trimStart, trimEnd }` per event instead of an array, removing the Map → Array → random-pick indirection.
- The `_modifyThemeEvent()` helper lost one parameter, making calls simpler and removing dead index-validation code.

## How it was tested

- All 13 COW theme tests pass (`npx playwright test tests/step-045-cow-themes.spec.js`)
- Full suite: **275 passed** (`npx playwright test`)

## Lessons / gotchas

- The renderer bundle (`dist/renderer.bundle.js`) must be rebuilt before running Playwright tests — the test runner uses the bundled output, not source files directly. Initial test failures (tests 11, 13) were caused by stale bundle.

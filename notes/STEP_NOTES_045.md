# Step 045: Replace Override System with Copy-on-Write Themes

## What was done

Replaced the confusing two-layer sound system (themes + overrides) with a clean copy-on-write (CoW) theme model.

### Files modified:
- **SoundThemeService.js**: Added `builtIn` flag, `forkTheme()`, `ensureWritable()`, `uploadSoundToTheme()`, `removeSoundFromTheme()`, `exportThemeAsZip()`. Removed all override methods (`getOverrideDir`, `getOverridePath`, `saveOverride`, `removeOverride`, `_layerOverrides`, `_removeOverrideFiles`). Simplified `getResolvedSoundMap()` to just call `getSoundMap()`. Added legacy override dir cleanup.
- **sound-theme.ipc.js**: Added handlers for `sound-theme-fork`, `sound-theme-upload-sound`, `sound-theme-remove-sound`, `sound-theme-export`. Removed `sound-override-upload` and `sound-override-remove`. Updated `saveTrimData` and `uploadSoundToTheme` to auto-switch config when a theme is forked.
- **preload.js**: Added `fork`, `uploadSound`, `removeSound`, `export` to `soundThemes`. Removed entire `soundOverrides` object.
- **main.js**: Removed `claudiu-sound-override` protocol registration and handler.
- **index.html**: Removed `claudiu-sound-override:` from CSP `media-src` and `connect-src`.
- **src/renderer/index.js**: Replaced override upload with CoW upload, added export button, added remove-sound button for custom themes. Source column shows "Built-in" or theme name instead of "Theme"/"Override". Removed all `api.soundOverrides` references.

### Resulting behavior:
- Built-in themes are read-only (marked with `builtIn: true`)
- Uploading/trimming on a built-in theme auto-forks to "{Name} (Custom)"
- Custom themes support direct upload, trim, and remove
- Export any theme as ZIP
- Legacy `sound-overrides/` directory cleaned up on startup

## Choices made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Fork naming | Auto `{name}-custom`, no prompt | Silent, no UI friction |
| Built-in detection | `builtIn` flag in theme.json | Simple, explicit, survives copies |
| Export format | macOS `zip` command | Consistent with existing `unzip` for import |
| Legacy cleanup | Delete on startup | Small user base, overrides are recent |

## Architecture decisions

- **Copy-on-write pattern**: `ensureWritable()` is the single chokepoint — both `uploadSoundToTheme()` and `saveTrimData()` call it. If the theme is built-in, it forks first. This keeps the logic DRY and predictable.
- **Config auto-switch on fork**: The IPC layer handles updating config when a fork happens, so the renderer doesn't need to manually save config — it just refreshes the theme list.
- **No more protocol layering**: Removed the entire `claudiu-sound-override://` protocol. All sounds now go through `claudiu-sound://` only.

## How it was tested

- All 261 existing Playwright tests pass (1 pre-existing dark theme flake)
- Renderer bundle builds successfully
- No remaining references to `soundOverrides`, `sound-override`, or `claudiu-sound-override` in JS/HTML (except cleanup code)

## Lessons / gotchas

- The `AUDIO_DOT_EXTENSIONS` constant became unused after removing `_layerOverrides` — cleaned up to avoid dead code
- `_seedDefaultTheme()` also needed the `builtIn` flag to be set, not just `installBuiltInThemes()`, since seeding happens on first launch before install
- The renderer needed to resolve the current theme's `builtIn` status from the themes array (already fetched) rather than making an extra IPC call

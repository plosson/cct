# Step 036 — npm start auto-opens CWD as project

## What was done

Fixed `npm start` so it auto-adds and selects the current working directory as a project when Claudiu launches.

**Modified files:**
- `package.json` — changed `start` script from `electron .` to `electron . $PWD`

**New files:**
- `tests/step-036-npm-start-project.spec.js` — 4 Playwright tests

## Choices made

- **`$PWD` appended to `electron .`**: The `.` in `electron .` is consumed by Electron to locate the app (resolves to main.js). It does NOT appear in `process.argv`. Appending `$PWD` as a second argument makes the current working directory available as `argv[2]` where `parseProjectPath` already handles it correctly.
- **Reused existing `parseProjectPath` + `openProjectFromCLI`**: No main process changes needed — the path-detection logic from step 034 already handles this case. The only missing piece was the `npm start` script not passing the CWD.

## Architecture decisions

- **Minimal change** — one word added to `package.json`. All the logic for opening a project from CLI was already in place (step 034).
- **Consistent with `claudiu .`**: Running `npm start` in a project dir now behaves identically to running `claudiu .`, just without the single-instance check that brings an existing window forward.

## How it was tested

4 Playwright tests in `tests/step-036-npm-start-project.spec.js`:

1. Launching without a project arg does NOT auto-select any project (baseline)
2. Launching with CWD as extra arg auto-adds and selects the project (core behaviour)
3. The project appears in the sidebar DOM
4. `package.json` start script contains `$PWD` (regression guard)

All 255 tests pass (4 new + 251 existing), zero regressions.

## Lessons / gotchas

- **`electron .` does not expose `.` in argv**: Electron resolves `.` to find the app's `package.json` → `main.js`, but the `.` itself is not preserved in `process.argv`. This is why `parseProjectPath` saw nothing — the CWD was never forwarded.
- **Test-driven debugging was effective**: Writing a failing test (test 4) instantly confirmed the root cause and the scope of the fix.

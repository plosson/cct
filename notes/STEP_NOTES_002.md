# Step 002 - CI/CD with GitHub Actions

## What was done

- `.github/workflows/ci.yml` — CI pipeline triggered on push/PR to main. Runs on `macos-latest`: install, lint, build, Playwright tests.
- `.github/workflows/release.yml` — Release pipeline triggered on `v*` tags. Builds macOS DMG for both arm64 and x64 using electron-builder with `--publish always`. Uses `nick-fields/retry` for hdiutil flakiness.
- `electron-builder.config.js` — Minimal config: appId, mac target (dmg), GitHub publish settings. Code signing set to `identity: null` (placeholder for future certs).
- `package.json` updated: `build` script now uses `electron-builder --dir` (unpacked, fast), `build:dist` for full packaging. Added `electron-builder` as devDependency.
- `playwright.config.js` — Set `workers: 1` to avoid single-instance lock conflicts.
- `tests/step-002-ci-cd.spec.js` — 5 file-based validation tests (no Electron launch needed).

## Choices made

- **macOS-only CI for now** — The app targets macOS first. No Windows/Linux matrix yet (saves CI minutes, can be added when needed).
- **`build --dir` for CI, not full DMG** — `npm run build` produces an unpacked app (fast, sufficient for CI validation). Full DMG packaging happens only in the release workflow.
- **`nick-fields/retry` for DMG build** — Adopted from reference project. hdiutil is notoriously flaky on GitHub Actions runners.
- **Separate arch builds (arm64 + x64)** — Uses `macos-latest` (arm64) and `macos-13` (last Intel runner). Matches reference project pattern.
- **No merge-mac-yml job** — The reference project has a complex job to merge latest-mac.yml for auto-updater. Skipped — we don't have auto-update yet.
- **Placeholder lint** — `npm run lint` is still `echo 'lint: ok'`. Will be replaced with a real linter when we have enough code to lint.

## Architecture decisions

- **Code signing placeholders** in release.yml as commented-out env vars (`CSC_LINK`, `APPLE_ID`, etc.). Ready to enable when certificates are available.
- **`identity: null`** in electron-builder config explicitly skips signing locally and in CI — avoids confusing error messages.
- **workers: 1** in Playwright config — Electron's single-instance lock (`requestSingleInstanceLock`) means only one app can run at a time. This is a permanent constraint for our Electron tests.

## How it was tested

14 Playwright tests (9 from step 001 + 5 new):

```
✓ ci.yml exists and is valid YAML (2ms)
✓ release.yml exists and is valid YAML (1ms)
✓ CI workflow has install, lint, build, test steps (1ms)
✓ release workflow triggers on v* tags and uses electron-builder (0ms)
✓ electron-builder config exists and is valid (18ms)

14 passed (1.2s)
```

Local dry-runs:
- `npm run lint` → exit 0
- `npm run build` → electron-builder produces unpacked app in `dist/mac-arm64/`

CI validation: branch will be pushed and `gh run list --workflow=ci.yml` checked after merge.

## Lessons / gotchas

- Two Playwright test files running in parallel both tried to launch Electron → single-instance lock caused the second to fail with "Failed to create SingletonLock: File exists". Fixed by setting `workers: 1`.
- Step-002 tests are pure file checks (no Electron launch) — keeps them fast and avoids unnecessary app spawning. Step-001 tests cover the Electron regression.
- `electron-builder --dir` is much faster than full DMG build (~5s vs ~30s) — good default for `npm run build`.

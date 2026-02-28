# Step 025 — Session Uptime in Status Bar

## What was done

Added a live session uptime display to the status bar showing how long the active session has been running.

**Modified files:**
- `src/renderer/index.js` — added `formatUptime()`, `startUptimeTimer()`, `stopUptimeTimer()` functions, `statusUptimeEl` DOM reference, updated `updateStatusBar()` to show/clear uptime
- `index.html` — added `<span data-testid="status-uptime">` element in the status bar

**New files:**
- `tests/step-025-session-uptime.spec.js` — 5 Playwright tests

**Resulting behavior:**
- Status bar shows session uptime for the active tab (e.g., "3s", "2m 15s", "1h 5m")
- Updates every second via `setInterval`
- Clears when no active session (all tabs closed, no selection)
- Timer starts when a session becomes active, stops when cleared

## Choices made

- **Format tiers**: `Xs` for under 1 minute, `Xm Ys` for under 1 hour, `Xh Ym` for 1 hour+. Seconds are dropped in the hour tier to keep it compact.
- **`createdAt` timestamp**: Already stored on each session (added in an earlier step). Uptime is simply `Date.now() - session.createdAt`.
- **1-second interval**: Standard refresh rate for a clock-like display. Timer is started/stopped cleanly to avoid leaks.

## Architecture decisions

- **Single global timer**: One `setInterval` for uptime, started when there's an active session and stopped when there isn't. Avoids per-session timers.
- **Positioned before terminal size**: Uptime sits between the spacer and the terminal size in the status bar, keeping project name and session type on the left and metrics on the right.

## How it was tested

5 Playwright tests:

1. Uptime element exists in status bar
2. Uptime is empty when no active session
3. Uptime shows after creating a session (matches `\d+s` pattern)
4. Uptime updates over time (value increases after 2 seconds)
5. Uptime clears when tab is closed

All 5 tests pass.

## Lessons / gotchas

- **Timer cleanup**: Must `clearInterval` when no active session to prevent the timer from updating a stale element.
- **Test timing**: Test 4 waits 2 seconds and compares before/after uptime values. Works reliably since the interval ticks every second.

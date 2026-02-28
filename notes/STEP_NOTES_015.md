# Step 015 — Tab Activity Indicator

## What was done

Added a visual indicator (blue dot) on tabs that have received output while not being the active tab. The indicator clears when the tab is activated.

**Modified files:**
- `src/renderer/index.js` — modified `onData` handler to add `tab-activity` class when receiving data on a non-active tab; modified `activateTab` to remove `tab-activity` class
- `styles/base.css` — added `.tab-item.tab-activity .tab-label::after` pseudo-element for the blue dot indicator

**New files:**
- `tests/step-015-tab-activity.spec.js` — 6 Playwright tests

**Resulting behavior:**
- When a background terminal receives output (shell prompt, command output, etc.), a small blue dot appears after its tab label
- The dot is a 6px circle in `#58a6ff` (matching the app's accent color)
- Clicking the tab or switching to it via keyboard clears the indicator
- Active tab output does not trigger the indicator
- The indicator is purely visual — no data structure needed, just a CSS class

## Choices made

- **CSS pseudo-element (not a DOM element)**: Using `::after` on the tab label avoids adding extra DOM elements. The dot appears/disappears purely based on the `tab-activity` class.
- **Class-based (not attribute-based)**: `classList.add/remove` is simple and performant. No need for data attributes.
- **Blue dot color**: Matches the `#58a6ff` accent color used for search bar focus, drop indicators, etc. Consistent visual language.
- **No debouncing**: Every `onData` event checks if the tab is active and adds the class. Since `classList.add` is idempotent, repeated calls are harmless.

## Architecture decisions

- **Check in `onData` callback**: The activity detection happens in the existing `api.terminal.onData` listener. When `activeId !== id`, the tab gets the activity class. This is the minimal change — no new event system needed.
- **Clear in `activateTab`**: The single place where tabs become active. This ensures the indicator is cleared regardless of how the tab was activated (click, keyboard, programmatic).

## How it was tested

6 Playwright tests:

1. Active tab does not have activity class
2. Background tab gets activity indicator when output is sent via IPC
3. Clicking the tab clears the indicator
4. Switching via keyboard (Cmd+ArrowRight) clears the indicator
5. Activity indicator class is correctly applied (CSS presence check)
6. Active tab output does not trigger the indicator

All 6 tests pass. Full suite: 132 tests in ~60s.

## Lessons / gotchas

- **Testing background output**: To generate output in a background terminal, tests use `api.terminal.input({ id, data: 'echo ...\n' })` on the non-active tab's terminal ID. This sends a command to the background PTY which produces output back via `onData`.
- **Idempotent class toggle**: `classList.add('tab-activity')` is called on every data chunk. Since it's idempotent, there's no performance concern even with high-frequency output.

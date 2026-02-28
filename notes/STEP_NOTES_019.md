# Step 019 — Project Activity Badge in Sidebar

## What was done

Added a visual activity indicator (blue dot) on sidebar project items when a non-selected project has terminals producing output. Extends the tab-level activity indicator from step 015 to the project level.

**Modified files:**
- `src/renderer/index.js` — added `projectActivity` Set, `updateProjectActivityBadge()`, modified `onData` handler to track project activity, modified `selectProject()` to clear activity, added `project-activity` class in `renderSidebar()`, added `_cctProjectActivity` and `_cctGetSessionsForProject` test helpers
- `styles/base.css` — added `.sidebar-project.project-activity .sidebar-project-name::after` pseudo-element

**New files:**
- `tests/step-019-project-activity.spec.js` — 5 Playwright tests

**Resulting behavior:**
- When terminals in a non-selected project produce output, a 6px blue dot appears after the project name in the sidebar
- Switching to the project clears the badge
- Output in the currently selected project does not trigger the badge
- Badge is consistent with the tab activity indicator (same color, same size, same ::after pattern)

## Choices made

- **Set-based tracking**: `projectActivity` Set stores project paths with pending activity. O(1) lookup, O(1) insert, idempotent add.
- **Direct DOM update**: `updateProjectActivityBadge()` adds/removes the class on the specific sidebar item without re-rendering the entire sidebar. This is important because `onData` fires frequently.
- **Same visual language**: Same 6px blue dot as the tab activity indicator. Users learn one visual pattern.
- **Clear on select, not on render**: Activity is cleared in `selectProject()`, not during sidebar re-render. This ensures the badge persists through sidebar re-renders until the user actually switches to the project.

## Architecture decisions

- **Project activity tracked independently from tab activity**: Tab activity (`tab-activity` class) and project activity (`projectActivity` Set) are separate. Tab activity is per-tab, project activity is per-project. They can coexist — a tab can have activity and the project can have activity.
- **`CSS.escape` for data attribute selector**: The `updateProjectActivityBadge()` function uses `CSS.escape(projectPath)` when building the attribute selector. Project paths can contain special characters.

## How it was tested

5 Playwright tests:

1. Selected project does not have `project-activity` class
2. Background project gets activity badge when its terminal produces output
3. Project activity class is on the sidebar DOM element
4. Switching to the project clears the activity badge
5. Selected project output does not trigger activity badge

All 5 tests pass. Full suite: 156 tests in ~78s.

## Lessons / gotchas

- **Tab count in multi-project tests**: When checking tab counts, use `:visible` selector since tabs from other projects are hidden with `display:none` but still exist in DOM.
- **onData timing**: The `sessions.get(id)?.projectPath` lookup in the onData callback works because the session is added to the Map before any PTY data arrives (PTY data is async, session registration is synchronous).

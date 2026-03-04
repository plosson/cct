# Project Visual Identity

## Problem

Nothing looks more like a terminal than another terminal. In agentic coding, you switch tabs every 5 minutes and need instant recognition of which project you're in — reading small text isn't enough.

## Design

### Color System

Curated palette of 12 hand-picked colors, all tested against `#1a1a2e` dark background. Assignment via `hash(projectName) % 12`.

| Name   | HSL                    |
|--------|------------------------|
| Red    | hsl(0, 70%, 55%)       |
| Orange | hsl(25, 80%, 55%)      |
| Amber  | hsl(45, 80%, 50%)      |
| Green  | hsl(140, 60%, 45%)     |
| Teal   | hsl(175, 60%, 45%)     |
| Cyan   | hsl(195, 70%, 50%)     |
| Blue   | hsl(215, 70%, 55%)     |
| Indigo | hsl(245, 60%, 60%)     |
| Purple | hsl(270, 60%, 60%)     |
| Pink   | hsl(330, 65%, 55%)     |
| Rose   | hsl(350, 70%, 55%)     |
| Lime   | hsl(85, 60%, 45%)      |

### CSS Custom Properties

On `selectProject()`, set on `:root`:

```css
--project-accent: hsl(H, S%, L%);
--project-accent-bg: hsla(H, 40%, 15%, 1);
--project-accent-dim: hsla(H, S%, L%, 0.15);
--project-accent-border: hsla(H, S%, L%, 0.3);
```

### Titlebar Area — Big Project Name

The `.titlebar-drag-region` (38px) becomes the project identity banner:

- Project name in 16-18px semi-bold, positioned ~80px from left (clearing traffic lights)
- Colored monogram square (20x20 rounded, accent bg, white letter) before the name
- Entire titlebar gets subtle tinted background: `var(--project-accent-dim)`

### Tab Bar — Accent Tint

- Background shifts from `#16162a` to `var(--project-accent-bg)`
- Bottom border becomes `var(--project-accent-border)`
- Active tab gets slightly more saturated accent

### Sidebar — Active Project Highlight

- Selected project gets left border or background tint in accent color
- Replaces current `rgba(255, 255, 255, 0.1)` highlight

### No-Project State

When no project is selected, everything stays monochrome `#16162a`. Titlebar shows nothing or "Claudiu".

## Decisions

- **Auto-assign over user-pick**: No config UI needed, deterministic from project name
- **Curated palette over continuous hue**: Guarantees all colors look good on dark bg
- **Full top band**: Titlebar + tab bar + sidebar header all tinted for maximum identity
- **CSS variables**: Single variable swap on project switch, all elements repaint

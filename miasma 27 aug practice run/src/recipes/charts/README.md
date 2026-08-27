# charts

Dependency-free charts, rendered as inline SVG. No chart.js, no d3 — reaching
for one of those costs ~20 minutes of install/API-learning and ~90 kB of
bundle for something this kit does in three small components.

## What's here

| File | What |
|---|---|
| `scale.js` | The maths: `linearScale`, `niceTicks`, `bandScale`, `linePath`. Pure functions, no DOM — see `scale.test.mjs` for the contract. |
| `LineChart.jsx` | Line chart with gridlines, axis labels, and point markers. |
| `BarChart.jsx` | Bar chart, zero-baseline, handles negative values. |
| `Sparkline.jsx` | Tiny axis-free trend line for a stat tile or table cell. |
| `scale.test.mjs` | `node:test` coverage of every degenerate-data edge case. |

All three components:
- take plain data (no adapter objects, no chart-library config)
- are responsive via `viewBox` — no fixed pixel width, so they scale with
  their container
- have an accessible label (`role="img"` + a generated `aria-label`
  summarising the data, not just "chart")
- render a real empty state ("No data yet.") instead of an empty box when
  given no data
- pull colour only from the CSS custom properties in `src/app.css`
  (`--color-accent`, `--color-ink-*`) — one accent colour, no gradients, no
  3D, restrained gridlines

## How to copy it in

```bash
cp -r src/recipes/charts src/lib/charts
```

Then, in your component:

```jsx
import LineChart from '../lib/charts/LineChart.jsx'
import BarChart from '../lib/charts/BarChart.jsx'
import Sparkline from '../lib/charts/Sparkline.jsx'

const revenue = [
  { label: 'Mon', value: 1200 },
  { label: 'Tue', value: 1900 },
  { label: 'Wed', value: 1400 },
]

function Dashboard() {
  return (
    <>
      <LineChart data={revenue} title="Revenue this week" valueFormat={(v) => `৳${v}`} />
      <BarChart data={revenue} title="Revenue this week" />
      <Sparkline data={[12, 19, 14, 22, 18, 30]} title="7-day trend" />
    </>
  )
}
```

Delete whichever of the three components you don't need — this is a recipe,
not a library, and an unused component left in the tree is dead weight
against "is it built well".

## The 3 gotchas most likely to bite under time pressure

1. **Data shape differs per component, and the failure is silent.**
   `LineChart` and `BarChart` want `[{ label, value }]`. `Sparkline` wants a
   plain `number[]` — no labels, no wrapper objects. Pass a plain number
   array to `LineChart` and you won't get an error, you'll get a chart with
   `undefined` values and a `NaN`-free-but-flat line (the scale maths pads a
   degenerate domain rather than crashing — see gotcha 3). Check the prop
   table above before wiring up data, not after the chart looks wrong.

2. **These charts have no colours of their own — they read `src/app.css`.**
   Every stroke/fill is `var(--color-accent)` or `var(--color-ink-*)`,
   resolved at render time. If you copy this folder into a project that
   doesn't define those custom properties (a different starter, a stripped
   `app.css`), the charts render with the browser's `initial` colour
   (usually black, sometimes invisible against a dark background) instead of
   erroring. Bring `@theme` from `app.css` with you, or hardcode fallback
   colours if you're copying this out of the LofiStack kit entirely.

3. **The container must actually have a width — the SVG doesn't have one.**
   `viewBox` plus `className="w-full h-auto"` means the chart is exactly as
   wide as its parent. Drop it into a flex or grid container with no width
   constraint (`display: flex` with no `min-width: 0`, a grid column sized
   `auto`) and it can collapse toward zero width even though the markup
   looks right. If a chart isn't showing up, check the parent's computed
   width in devtools before checking the component. (Sparkline additionally
   uses `preserveAspectRatio="none"` so it stretches to fill its box exactly
   — that's intentional for a tight table cell, but it means it *will*
   distort if you give it a wildly non-sparkline-shaped container.)

### One more thing, not a gotcha, a design choice

`BarChart` always includes zero in its y-axis domain, even if every value in
the data is e.g. 1,000,000–1,000,050. That's deliberate — a bar chart that
doesn't start at zero misrepresents the relative size of the bars, which is
the one thing a bar chart is for. If your data is a tight cluster far from
zero, `LineChart` (which auto-fits to the data's actual range) will read
better than forcing `BarChart` to show a wall of near-identical bars.

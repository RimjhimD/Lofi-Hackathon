/**
 * Sparkline — a tiny, axis-free inline SVG trend line. For "this number,
 * with recent context" inside a stat tile or table cell — not a full
 * chart. No gridlines, no labels: the point is that it reads at a
 * glance, not that it's precise.
 *
 * data: number[]
 */
import { linePath, linearScale } from './scale.js'

export default function Sparkline({
  data = [],
  title = 'Trend',
  valueFormat = (v) => String(v),
  height = 32,
}) {
  const width = 120
  const pad = 3 // keeps the stroke and the end dot from clipping at the edges

  const path = linePath(data, { width, height, padding: pad })

  const last = data.length ? data[data.length - 1] : null

  let lastPoint = null
  if (data.length) {
    const xScale = linearScale([0, Math.max(data.length - 1, 0)], [pad, width - pad])
    const min = Math.min(...data)
    const max = Math.max(...data)
    const yScale = linearScale([min, max], [height - pad, pad])
    lastPoint = { x: xScale(data.length - 1), y: yScale(last) }
  }

  let trend = 'flat'
  if (data.length >= 2) {
    const delta = data[data.length - 1] - data[0]
    if (delta > 0) trend = 'up'
    else if (delta < 0) trend = 'down'
  }

  const ariaLabel =
    data.length === 0
      ? `${title}: no data`
      : `${title}: ${data.length} point${data.length === 1 ? '' : 's'}, ` +
        `from ${valueFormat(data[0])} to ${valueFormat(last)}, trending ${trend}`

  if (data.length === 0) {
    return (
      <span className="inline-flex h-8 w-[120px] items-center text-xs text-ink-500" role="img" aria-label={ariaLabel}>
        No data
      </span>
    )
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-8 w-full max-w-[160px]"
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
    >
      <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      {lastPoint && <circle cx={lastPoint.x} cy={lastPoint.y} r="2" fill="var(--color-accent)" />}
    </svg>
  )
}

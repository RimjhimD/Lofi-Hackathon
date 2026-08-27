/**
 * LineChart — dependency-free inline SVG line chart.
 *
 * data: [{ label: string, value: number }]
 *
 * viewBox-based, so it scales with its container instead of carrying a
 * fixed pixel width — set the width with a class or CSS on the wrapper,
 * not with a prop. Handles empty data, a single point, negative values,
 * and a flat series without collapsing (see scale.js).
 */
import { linearScale, niceTicks, linePath } from './scale.js'

export default function LineChart({
  data = [],
  title = 'Chart',
  valueFormat = (v) => String(v),
  height = 220,
}) {
  const width = 480
  const padding = { top: 12, right: 16, bottom: 24, left: 44 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const values = data.map((d) => d.value)
  const ticks = niceTicks(values.length ? Math.min(...values) : 0, values.length ? Math.max(...values) : 1)
  const yDomain = [ticks[0], ticks[ticks.length - 1]]

  const yScale = linearScale(yDomain, [innerH, 0])
  const xScale = linearScale([0, Math.max(data.length - 1, 0)], [0, innerW])

  const path = linePath(values, { width: innerW, height: innerH, padding: 0, yDomain })

  // Crowding guard: with a lot of points, only label every Nth one.
  const labelStep = Math.max(Math.ceil(data.length / 6), 1)

  const ariaLabel =
    data.length === 0
      ? `${title}: no data`
      : `${title}: line chart, ${data.length} point${data.length === 1 ? '' : 's'}, ` +
        `from ${valueFormat(values[0])} to ${valueFormat(values[values.length - 1])}`

  return (
    <figure className="w-full" role="img" aria-label={ariaLabel}>
      {data.length === 0 ? (
        <div className="rounded-card border border-dashed border-ink-300/70 px-6 py-10 text-center">
          <p className="text-sm text-ink-500">No data yet.</p>
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
          focusable="false"
        >
          <g transform={`translate(${padding.left},${padding.top})`}>
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1="0"
                  x2={innerW}
                  y1={yScale(t)}
                  y2={yScale(t)}
                  stroke="var(--color-ink-300)"
                  strokeOpacity="0.4"
                  strokeWidth="1"
                />
                <text
                  x="-8"
                  y={yScale(t)}
                  fill="var(--color-ink-500)"
                  fontSize="10"
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  {valueFormat(t)}
                </text>
              </g>
            ))}

            <path
              d={path}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {data.map((d, i) => (
              <g key={i}>
                <circle cx={xScale(i)} cy={yScale(d.value)} r="3" fill="var(--color-accent)">
                  <title>
                    {d.label ?? `Point ${i + 1}`}: {valueFormat(d.value)}
                  </title>
                </circle>
                {d.label != null && i % labelStep === 0 && (
                  <text
                    x={xScale(i)}
                    y={innerH + 16}
                    fill="var(--color-ink-500)"
                    fontSize="10"
                    textAnchor="middle"
                  >
                    {d.label}
                  </text>
                )}
              </g>
            ))}
          </g>
        </svg>
      )}
    </figure>
  )
}

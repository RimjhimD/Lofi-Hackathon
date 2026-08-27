/**
 * BarChart — dependency-free inline SVG bar chart.
 *
 * data: [{ label: string, value: number }]
 *
 * viewBox-based (no fixed pixel width). Bars grow from a zero baseline in
 * both directions, so negative values render correctly instead of going
 * off-chart. Handles empty data, a single bar, and a flat series (see
 * scale.js) without collapsing the axis.
 */
import { linearScale, niceTicks, bandScale } from './scale.js'

export default function BarChart({
  data = [],
  title = 'Chart',
  valueFormat = (v) => String(v),
  height = 220,
}) {
  const width = 480
  const padding = { top: 12, right: 16, bottom: 28, left: 44 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const values = data.map((d) => d.value)
  // Zero is always in view, even if every value is positive (or negative) —
  // a bar chart implies a baseline, and hiding it misrepresents scale.
  const ticks = niceTicks(
    Math.min(0, values.length ? Math.min(...values) : 0),
    Math.max(0, values.length ? Math.max(...values) : 1)
  )
  const yDomain = [ticks[0], ticks[ticks.length - 1]]
  const yScale = linearScale(yDomain, [innerH, 0])
  const band = bandScale(data.length, [0, innerW])
  const zeroY = yScale(0)

  const labelStep = Math.max(Math.ceil(data.length / 6), 1)

  const ariaLabel =
    data.length === 0
      ? `${title}: no data`
      : `${title}: bar chart, ${data.length} bar${data.length === 1 ? '' : 's'}, ` +
        `${data.map((d) => `${d.label}: ${valueFormat(d.value)}`).join(', ')}`

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

            {data.map((d, i) => {
              const barY = Math.min(zeroY, yScale(d.value))
              const barH = Math.max(Math.abs(yScale(d.value) - zeroY), 1)
              return (
                <g key={i}>
                  <rect
                    x={band.position(i)}
                    y={barY}
                    width={band.bandwidth}
                    height={barH}
                    fill="var(--color-accent)"
                    rx="2"
                  >
                    <title>
                      {d.label}: {valueFormat(d.value)}
                    </title>
                  </rect>
                  {i % labelStep === 0 && (
                    <text
                      x={band.position(i) + band.bandwidth / 2}
                      y={innerH + 18}
                      fill="var(--color-ink-500)"
                      fontSize="10"
                      textAnchor="middle"
                    >
                      {d.label}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        </svg>
      )}
    </figure>
  )
}

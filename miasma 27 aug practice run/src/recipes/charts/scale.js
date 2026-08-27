/**
 * scale.js — the maths behind the charts, with none of the rendering.
 *
 * Every function here is pure (no DOM, no Svelte) so it is trivial to unit
 * test and trivial to reuse across LineChart / BarChart / Sparkline. The
 * thing that actually eats time under pressure isn't drawing a line — it's
 * getting the axis to not divide by zero when the demo data is a single
 * row, or all zeros, or a flat series. Every function below is written
 * against those cases first, the "normal" case second.
 */

/**
 * Round a raw span to a "nice" number (1, 2, 5, 10 × a power of ten) the
 * way a human picks axis steps. `round` picks the nearest nice number;
 * off, it rounds up so ticks always cover the full requested range.
 */
function niceNumber(range, round) {
  const exponent = Math.floor(Math.log10(range))
  const fraction = range / 10 ** exponent
  let niceFraction

  if (round) {
    if (fraction < 1.5) niceFraction = 1
    else if (fraction < 3) niceFraction = 2
    else if (fraction < 7) niceFraction = 5
    else niceFraction = 10
  } else {
    if (fraction <= 1) niceFraction = 1
    else if (fraction <= 2) niceFraction = 2
    else if (fraction <= 5) niceFraction = 5
    else niceFraction = 10
  }

  return niceFraction * 10 ** exponent
}

/**
 * Nice axis ticks covering [min, max] — round numbers a human would pick
 * (0/25/50/75/100, not 0/23.7/47.4/71.1/94.8...).
 *
 * Always returns at least two distinct, finite ticks. That guarantee is
 * what stops the axis from collapsing when the data is degenerate:
 *   - all-zero data      → min === max === 0
 *   - a single data point → min === max === that value
 *   - a flat series       → min === max === some non-zero value
 * In every one of those cases a naive `(max - min) / count` step is 0 and
 * every tick prints the same label. Here we pad the domain first so there
 * is always real span to divide.
 */
export function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1]
  if (min > max) [min, max] = [max, min]

  if (min === max) {
    const pad = min === 0 ? 1 : Math.abs(min) * 0.1
    min -= pad
    max += pad
  }

  const span = niceNumber(max - min, false)
  const step = niceNumber(span / Math.max(count - 1, 1), true) || 1
  const niceMin = Math.floor(min / step) * step
  const niceMax = Math.ceil(max / step) * step

  const ticks = []
  // Half-a-step slop on the upper bound guards against float drift
  // (e.g. 0.1 + 0.2) skipping the last tick.
  for (let v = niceMin; v <= niceMax + step / 2; v += step) {
    ticks.push(Math.round(v / step) * step)
  }
  return ticks
}

/**
 * A linear scale mapping a numeric domain to a pixel range. Returns a
 * function `value => pixel`; `scale.domain` exposes the (possibly padded)
 * domain actually used, so callers can line up gridlines with it.
 *
 * A zero-width domain (all-zero data, a single point, a flat series) is
 * padded around its centre rather than left at zero width, which is what
 * turns a divide-by-zero into a NaN everywhere downstream. Padding by a
 * fraction of the value (or by 1, if the value itself is 0) keeps a single
 * point centred in its range instead of pinned to one edge.
 */
export function linearScale(domain, range) {
  let [d0, d1] = domain
  const [r0, r1] = range

  if (!Number.isFinite(d0) || !Number.isFinite(d1)) {
    d0 = 0
    d1 = 1
  }
  if (d0 === d1) {
    const pad = d0 === 0 ? 1 : Math.abs(d0) * 0.1
    d0 -= pad
    d1 += pad
  }

  const scale = (value) => {
    const v = Number.isFinite(value) ? value : d0
    return r0 + ((v - d0) / (d1 - d0)) * (r1 - r0)
  }
  scale.domain = [d0, d1]
  return scale
}

/**
 * Divide a pixel range into `count` equal bands (bar-chart x positions).
 * `gap` is the fraction of each band's step left empty between bars
 * (0 = touching bars, 1 = invisible bars). Works down to a single bar.
 */
export function bandScale(count, range, gap = 0.35) {
  const [r0, r1] = range
  const n = Math.max(count, 1)
  const step = (r1 - r0) / n
  const bandwidth = Math.max(step * (1 - gap), 0)
  const position = (i) => r0 + step * i + (step - bandwidth) / 2
  return { bandwidth, position }
}

/**
 * Build an SVG path `d` string for a line chart from an array of numbers
 * (index becomes x). Returns '' for no data — callers should render a real
 * empty state instead of drawing an empty path.
 *
 * A single point still produces a valid, centred, zero-length path
 * ("M x y L x y"); paired with `stroke-linecap="round"` in the caller that
 * renders as a dot, which reads honestly ("here is one value") rather than
 * a horizontal line, which reads as "the value hasn't changed" — a claim a
 * single sample can't support.
 *
 * `xDomain` / `yDomain` let a caller (e.g. LineChart) pass in the same
 * "nice" domain used for its gridlines, so the path and the axis agree.
 * Left unset, the domain is taken straight from the data.
 */
export function linePath(values, { width, height, padding = 0, xDomain, yDomain } = {}) {
  if (!values || values.length === 0) return ''

  const ys = values.map((v) => (Number.isFinite(v) ? v : 0))
  const xs = ys.map((_, i) => i)

  const xd = xDomain ?? [0, Math.max(xs.length - 1, 0)]
  const yd = yDomain ?? [Math.min(...ys), Math.max(...ys)]

  const x = linearScale(xd, [padding, width - padding])
  const y = linearScale(yd, [height - padding, padding])

  if (values.length === 1) {
    const px = x(0).toFixed(2)
    const py = y(ys[0]).toFixed(2)
    return `M ${px} ${py} L ${px} ${py}`
  }

  return xs.map((xi, i) => `${i === 0 ? 'M' : 'L'} ${x(xi).toFixed(2)} ${y(ys[i]).toFixed(2)}`).join(' ')
}

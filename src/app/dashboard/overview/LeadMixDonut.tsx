// Lead mix as an SVG donut, rendered on the server: no chart library and no client JS. Every
// colour comes from theme tokens so it holds in light and dark, and the legend under the ring
// carries the numbers, so the ring never has to be read on its own.

export interface MixSlice { name: string; value: number; color: string }

const R      = 42      // ring radius in a 100×100 viewBox
const STROKE = 16
const CIRC   = 2 * Math.PI * R
const GAP    = 1.2     // surface gap between slices, in circumference units

export default function LeadMixDonut({
  slices, total, centerLabel,
}: { slices: MixSlice[]; total: number; centerLabel: string }) {
  const shown = slices.filter(s => s.value > 0)
  if (total <= 0 || shown.length === 0) return null

  const pct = (v: number) => Math.round((v / total) * 100)
  let offset = 0

  return (
    <div className="ov2-mix">
      <svg className="ov2-mix__ring" viewBox="0 0 100 100" role="img"
        aria-label={shown.map(s => `${s.name} ${pct(s.value)}%`).join(', ')}>
        <circle cx="50" cy="50" r={R} fill="none" stroke="var(--bg-subtle)" strokeWidth={STROKE} />
        {shown.map(s => {
          const len  = (s.value / total) * CIRC
          const dash = Math.max(0, len - (shown.length > 1 ? GAP : 0))
          const arc = (
            <circle
              key={s.name} cx="50" cy="50" r={R} fill="none" stroke={s.color} strokeWidth={STROKE}
              strokeDasharray={`${dash} ${CIRC - dash}`} strokeDashoffset={-offset} transform="rotate(-90 50 50)"
            />
          )
          offset += len
          return arc
        })}
        <text x="50" y="50" textAnchor="middle" className="ov2-mix__total">{total.toLocaleString('en-US')}</text>
        <text x="50" y="61" textAnchor="middle" className="ov2-mix__caption">{centerLabel}</text>
      </svg>
      <ul className="ov2-mix__legend">
        {shown.map(s => (
          <li key={s.name} className="ov2-mix__item">
            <span className="ov2-mix__swatch" style={{ background: s.color }} aria-hidden />
            <span className="ov2-mix__name">{s.name}</span>
            <span className="ov2-mix__count">{s.value.toLocaleString('en-US')}</span>
            <span className="ov2-mix__pct">{pct(s.value)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Keyword position and movement, shared by the Overview and the SEO report so a rank reads the
// same everywhere: a pill for where you are, an arrow for which way you moved.

export function PositionPill({ position }: { position: number | null }) {
  if (position == null) return <span className="kw-pos kw-pos--none">Not ranked</span>
  const tone = position <= 3 ? 'top' : position <= 10 ? 'page1' : 'rest'
  const text = Number.isInteger(position) ? String(position) : position.toFixed(1)
  return <span className={`kw-pos kw-pos--${tone}`} title={`Position ${text} on Google`}>{text}</span>
}

/**
 * change > 0 means the keyword moved toward #1.
 * undefined = no comparison is set, so nothing renders.
 * null      = there is no earlier figure: "New" when newWhenNull, otherwise a dash.
 */
export function RankChange({
  change, decimals = 0, newWhenNull = false,
}: { change: number | null | undefined; decimals?: number; newWhenNull?: boolean }) {
  if (change === undefined) return null
  if (change === null) {
    return newWhenNull
      ? <span className="kw-new" title="Not in the comparison period">New</span>
      : <span className="kw-change kw-change--flat" aria-label="No earlier position">—</span>
  }
  const threshold = decimals > 0 ? 0.05 : 0.5
  if (Math.abs(change) < threshold) {
    return <span className="kw-change kw-change--flat" aria-label="No change">—</span>
  }
  const up   = change > 0
  const text = Math.abs(change).toFixed(decimals)
  return (
    <span
      className={`kw-change kw-change--${up ? 'up' : 'down'}`}
      aria-label={`${up ? 'Up' : 'Down'} ${text} ${text === '1' ? 'place' : 'places'}`}
    >
      {up ? '▲' : '▼'} {text}
    </span>
  )
}

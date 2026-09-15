// One status pill for every ad table and page header, so "Active" and "Paused" read the same
// everywhere. Colour always comes with a dot and a word, never colour alone.

export type StatusTone = 'active' | 'paused' | 'ended' | 'unknown'

export function statusTone(status: string | null | undefined): StatusTone {
  const s = (status ?? '').toUpperCase()
  if (!s) return 'unknown'
  if (s === 'ACTIVE' || s === 'ENABLED') return 'active'
  if (s.includes('PAUSED')) return 'paused'
  if (s === 'REMOVED' || s === 'DELETED' || s === 'ARCHIVED' || s === 'ENDED') return 'ended'
  return 'unknown'
}

export default function StatusPill({
  status, activeLabel = 'Active', fallback = '—',
}: { status: string | null | undefined; activeLabel?: string; fallback?: string }) {
  const tone = statusTone(status)
  if (tone === 'unknown') {
    if (!status) return <span className="status-pill status-pill--none">{fallback}</span>
    const text = status.replace(/_/g, ' ').toLowerCase()
    return <span className="status-pill status-pill--other">{text.charAt(0).toUpperCase() + text.slice(1)}</span>
  }
  return (
    <span className={`status-pill status-pill--${tone}`}>
      <span className="status-pill__dot" aria-hidden />
      {tone === 'active' ? activeLabel : tone === 'paused' ? 'Paused' : 'Ended'}
    </span>
  )
}

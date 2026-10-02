// A person: their photo, or their initials on the accent tint. Round, so people never look like
// the square logo tiles beside them.

export function initials(name: string): string {
  return name.trim().split(/\s+/).map(p => p[0]).join('').toUpperCase().slice(0, 2) || '?'
}

export default function Avatar({ name, url, size = 32, muted }: {
  name: string
  url?: string | null
  size?: number
  /** Greyed out (an account that can't sign in). */
  muted?: boolean
}) {
  return (
    <span
      className={`ui-avatar${muted ? ' ui-avatar--muted' : ''}`}
      style={{ '--av': `${size}px` } as React.CSSProperties}
      aria-hidden
    >
      {url ? <img src={url} alt="" /> : initials(name)}
    </span>
  )
}

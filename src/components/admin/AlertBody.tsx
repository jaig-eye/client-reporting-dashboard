// Renders an alert's body text — the one place alert text is turned into markup.
//
// Alert bodies are written by crons and AI summaries in a light markdown: **bold**, "• " or "- "
// bullets, and line breaks. Today rendered them raw, so readers saw literal asterisks; the Alerts
// page had its own regex. This component is shared by both, and it builds React elements rather than
// injecting HTML, so a body can never smuggle markup into the page.

import { Fragment, type ReactNode } from 'react'

/** **bold** → <strong>, everything else as plain text. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<strong key={`${keyBase}-b${i++}`}>{m[1]}</strong>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  // Stray unmatched ** markers (e.g. a truncated body) shouldn't show as asterisks.
  return out.map(part => (typeof part === 'string' ? part.replace(/\*\*/g, '') : part))
}

/** Plain text with the markdown stripped — for previews, titles and screen-reader labels. */
export function alertPlainText(body: string | null | undefined): string {
  return (body ?? '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/^\s*(?:[•\-*])\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

interface Props {
  body: string | null | undefined
  /** Clamp to this many lines (CSS line-clamp). Omit to show everything. */
  lines?: number
  className?: string
}

export default function AlertBody({ body, lines, className }: Props) {
  if (!body?.trim()) return null

  const rows = body.split(/\r?\n/).map(r => r.trimEnd()).filter(r => r.trim() !== '')
  const bulletRe = /^\s*(?:[•\-*])\s+/
  const blocks: ReactNode[] = []
  let bullets: string[] = []

  const flushBullets = () => {
    if (!bullets.length) return
    const k = `ul${blocks.length}`
    blocks.push(
      <ul key={k} className="alert-body__list">
        {bullets.map((b, i) => <li key={`${k}-${i}`}>{inline(b, `${k}-${i}`)}</li>)}
      </ul>,
    )
    bullets = []
  }

  rows.forEach((row, i) => {
    if (bulletRe.test(row)) { bullets.push(row.replace(bulletRe, '')); return }
    flushBullets()
    blocks.push(<p key={`p${i}`} className="alert-body__p">{inline(row, `p${i}`)}</p>)
  })
  flushBullets()

  return (
    <div
      className={`alert-body ${className ?? ''}`}
      style={lines ? { display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : undefined}
    >
      {blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}
    </div>
  )
}

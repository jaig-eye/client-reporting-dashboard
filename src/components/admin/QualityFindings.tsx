'use client'

import { useState } from 'react'
import type { QualityFinding, QualityReport } from '@/lib/content/qualityGate'

const SEVERITY_STYLE: Record<string, { bg: string; border: string; fg: string; label: string }> = {
  critical: { bg: '#fee2e2', border: '#fca5a5', fg: '#b91c1c', label: 'Fix before publishing' },
  warning:  { bg: '#fef3c7', border: '#fcd34d', fg: '#92400e', label: 'Worth a look' },
  info:     { bg: 'var(--bg-subtle)', border: 'var(--border)', fg: 'var(--text-muted)', label: 'Note' },
}

/**
 * The reviewer-facing half of the quality gate.
 *
 * Deliberately shows the REASON rather than just a score: a number tells an
 * editor nothing actionable, whereas "keyword title-cased in 4 headings" tells
 * them exactly what to change. The score is a sort key, not the message.
 */
export default function QualityFindings({
  report,
  compact = false,
}: {
  report: QualityReport | null | undefined
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)

  if (!report || !Array.isArray(report.findings)) return null

  const findings = report.findings
  const critical = findings.filter(f => f.severity === 'critical')
  const warnings = findings.filter(f => f.severity === 'warning')

  if (findings.length === 0) {
    return compact ? null : (
      <div style={{
        marginTop: 6, padding: '4px 8px', borderRadius: 5,
        background: '#dcfce7', border: '1px solid #86efac',
        fontSize: 11.5, color: '#166534', fontWeight: 600,
      }}>
        Quality checks passed
      </div>
    )
  }

  const worst = critical.length > 0 ? 'critical' : warnings.length > 0 ? 'warning' : 'info'
  const s = SEVERITY_STYLE[worst]

  return (
    <div style={{ marginTop: 6 }}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '3px 8px', borderRadius: 5, cursor: 'pointer',
          background: s.bg, border: `1px solid ${s.border}`, color: s.fg,
          fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit',
        }}
      >
        {critical.length > 0
          ? `${critical.length} to fix before publishing`
          : `${warnings.length} quality note${warnings.length === 1 ? '' : 's'}`}
        <span style={{ opacity: 0.7 }}>{open ? '▲' : '▾'}</span>
      </button>

      {open && (
        <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {findings.map((f: QualityFinding, i: number) => {
            const fs = SEVERITY_STYLE[f.severity] ?? SEVERITY_STYLE.info
            return (
              <li key={`${f.code}-${i}`} style={{
                padding: '6px 9px', borderRadius: 5,
                background: fs.bg, border: `1px solid ${fs.border}`,
                borderLeft: `3px solid ${fs.fg}`,
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: fs.fg, marginBottom: 2 }}>
                  {fs.label}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                  {f.message}
                </div>
                {f.evidence && f.evidence.length > 0 && (
                  <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {f.evidence.map((e, j) => (
                      <code key={j} style={{
                        fontSize: 10.5, padding: '1px 5px', borderRadius: 3,
                        background: 'var(--bg-surface)', border: '1px solid var(--border)',
                        color: 'var(--text-muted)', wordBreak: 'break-word',
                      }}>
                        {e}
                      </code>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

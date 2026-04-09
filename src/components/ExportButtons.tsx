'use client'

import { useState, useRef, useEffect } from 'react'

export default function ExportButtons({
  clientId,
  from,
  to,
  compare,
}: {
  clientId: string
  from?: string
  to?: string
  compare?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  const dateQs = [
    from    ? `from=${from}`       : '',
    to      ? `to=${to}`           : '',
    compare && compare !== 'none' ? `compare=${compare}` : '',
  ].filter(Boolean).join('&')

  const qs = dateQs ? `&${dateQs}` : ''

  function downloadCsv() {
    window.location.href = `/api/export/csv?clientId=${clientId}${qs}`
  }

  function openPdf() {
    window.open(`/api/export/report?format=pdf&clientId=${clientId}${qs}`, '_blank')
    setOpen(false)
  }

  function downloadEmail() {
    window.location.href = `/api/export/report?format=email&clientId=${clientId}${qs}`
    setOpen(false)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>

      {/* CSV button */}
      <button
        onClick={downloadCsv}
        className="btn btn-secondary"
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.375rem 0.75rem' }}
        title="Download CSV"
      >
        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        <span style={{ fontSize: '0.8125rem' }}>CSV</span>
      </button>

      {/* Report dropdown */}
      <div ref={ref} style={{ position: 'relative' }}>
        <button
          onClick={() => setOpen(o => !o)}
          className="btn btn-secondary"
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0.375rem 0.75rem' }}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span style={{ fontSize: '0.8125rem' }}>Report</span>
          <svg width="10" height="10" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--text-muted)', flexShrink: 0, marginLeft: 1 }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {open && (
          <div style={{
            position: 'absolute', right: 0, top: 'calc(100% + 4px)',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
            zIndex: 50,
            minWidth: 180,
            overflow: 'hidden',
            padding: '4px 0',
          }}>
            <button
              onClick={openPdf}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', background: 'transparent', border: 'none',
                cursor: 'pointer', textAlign: 'left',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-subtle)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ fontSize: '1rem', lineHeight: 1 }}>🖨</span>
              <div>
                <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>Print / PDF</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: 1 }}>Opens print dialog</div>
              </div>
            </button>

            <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />

            <button
              onClick={downloadEmail}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', background: 'transparent', border: 'none',
                cursor: 'pointer', textAlign: 'left',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-subtle)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ fontSize: '1rem', lineHeight: 1 }}>✉</span>
              <div>
                <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>Email Report</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: 1 }}>Download HTML to send</div>
              </div>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

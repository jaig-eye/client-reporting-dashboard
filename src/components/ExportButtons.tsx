'use client'

import { useState, useRef, useEffect } from 'react'
import { DownloadSimple, FileText, Printer, Envelope, CaretDown } from '@phosphor-icons/react'

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
        className="btn btn-secondary btn-sm focus-ring"
        aria-label="Download CSV"
        title="Download CSV"
      >
        <DownloadSimple size={14} aria-hidden style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span>CSV</span>
      </button>

      {/* Report dropdown */}
      <div ref={ref} style={{ position: 'relative' }}>
        <button
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-haspopup="true"
          className="btn btn-secondary btn-sm focus-ring"
        >
          <FileText size={14} aria-hidden style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <span>Report</span>
          <CaretDown size={10} aria-hidden style={{ color: 'var(--text-muted)', flexShrink: 0, marginLeft: 1 }} />
        </button>

        {open && (
          <div style={{
            position: 'absolute', right: 0, top: 'calc(100% + 4px)',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: '0.625rem',
            boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
            zIndex: 50,
            minWidth: 180,
            overflow: 'hidden',
            padding: '4px 0',
          }}>
            <button
              onClick={openPdf}
              className="focus-ring"
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', background: 'transparent', border: 'none',
                cursor: 'pointer', textAlign: 'left',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-subtle)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <Printer size={15} aria-hidden style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>Print / PDF</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: 1 }}>Opens print dialog</div>
              </div>
            </button>

            <div style={{ height: 1, background: 'var(--border-subtle)', margin: '2px 0' }} />

            <button
              onClick={downloadEmail}
              className="focus-ring"
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', background: 'transparent', border: 'none',
                cursor: 'pointer', textAlign: 'left',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-subtle)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <Envelope size={15} aria-hidden style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
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

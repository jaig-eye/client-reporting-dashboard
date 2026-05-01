'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ShareNetwork, Coins, Coin, Printer, Envelope, CaretDown } from '@phosphor-icons/react'
import { setRawMode } from '@/app/actions/rawMode'
import ReportModal from './ReportModal'

interface Client {
  id: string
  name: string
  dashboard_token: string
}

interface Props {
  currentClientId: string
  currentClientName: string
  dashboardToken: string
  clients: Client[]
  appUrl: string
  rawMode: boolean
}

export default function AdminDashboardBar({
  currentClientId,
  currentClientName,
  dashboardToken,
  clients,
  appUrl,
  rawMode,
}: Props) {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [switching,    setSwitching]    = useState(false)
  const [copied,       setCopied]       = useState(false)
  const [togglingRaw,  setTogglingRaw]  = useState(false)
  const [reportOpen,   setReportOpen]   = useState(false)
  const [reportDropdown, setReportDropdown] = useState(false)

  function openReport() {
    const from    = searchParams.get('from')
    const to      = searchParams.get('to')
    const compare = searchParams.get('compare')
    const qs = [
      from    ? `from=${from}`       : '',
      to      ? `to=${to}`           : '',
      compare && compare !== 'none' ? `compare=${compare}` : '',
    ].filter(Boolean).join('&')
    window.open(`/api/export/report?format=pdf${qs ? '&' + qs : ''}`, '_blank')
  }

  async function handleClientSwitch(clientId: string) {
    if (clientId === currentClientId) return
    setSwitching(true)
    window.location.href = `/api/admin/preview/${clientId}`
  }

  async function handleToggleRaw() {
    setTogglingRaw(true)
    await setRawMode(!rawMode)
    router.refresh()
    setTogglingRaw(false)
  }

  function handleCopyLink() {
    const url = `${appUrl}/api/auth/access?token=${dashboardToken}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      height: 40,
      zIndex: 9999,
      background: 'var(--accent, #2563eb)',
      display: 'flex',
      alignItems: 'center',
      paddingLeft: '0.75rem',
      paddingRight: '0.75rem',
      gap: '0.75rem',
      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    }}>
      {/* Back button */}
      <a
        href="/admin/dashboard"
        style={{
          display: 'flex', alignItems: 'center', gap: '0.3rem',
          color: 'rgba(255,255,255,0.85)', textDecoration: 'none',
          fontSize: '0.75rem', fontWeight: 500, whiteSpace: 'nowrap',
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
        onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.85)')}
      >
        ← Admin
      </a>

      <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.875rem' }}>|</span>

      {/* Admin / raw mode badge */}
      <span style={{
        background: rawMode ? '#d97706' : 'rgba(255,255,255,0.15)',
        border: rawMode ? '1px solid #f59e0b' : '1px solid transparent',
        borderRadius: 4,
        padding: '0.125rem 0.4rem', fontSize: '0.6875rem', fontWeight: 700,
        color: '#fff', letterSpacing: '0.03em', textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}>
        {rawMode ? 'Raw Cost' : 'Admin View'}
      </span>

      {/* Client switcher */}
      <select
        value={currentClientId}
        disabled={switching}
        onChange={e => handleClientSwitch(e.target.value)}
        style={{
          background: 'rgba(255,255,255,0.15)',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 6, color: '#fff',
          fontSize: '0.75rem', fontWeight: 500,
          padding: '0.25rem 0.5rem',
          cursor: 'pointer', maxWidth: 180,
          appearance: 'none', WebkitAppearance: 'none',
        }}
      >
        {clients.map(c => (
          <option key={c.id} value={c.id} style={{ background: '#1e40af', color: '#fff' }}>
            {c.name}
          </option>
        ))}
      </select>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Raw cost toggle — icon only, tooltip on hover */}
      <button
        onClick={handleToggleRaw}
        disabled={togglingRaw}
        title={rawMode ? 'Raw cost ON — click to restore markup' : 'Toggle raw cost view'}
        style={{
          background: rawMode ? '#d97706' : 'rgba(255,255,255,0.15)',
          border: `1px solid ${rawMode ? '#f59e0b' : 'rgba(255,255,255,0.2)'}`,
          borderRadius: 6, color: '#fff',
          padding: '0.3rem',
          cursor: togglingRaw ? 'wait' : 'pointer',
          opacity: togglingRaw ? 0.7 : 1,
          transition: 'background 0.15s, border-color 0.15s',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          lineHeight: 0,
        }}
      >
        {rawMode
          ? <Coin size={14} weight="fill" />
          : <Coins size={14} weight="regular" />
        }
      </button>

      <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.875rem' }}>|</span>

      {/* Settings link */}
      <a
        href={`/admin/clients/${currentClientId}`}
        style={{
          color: 'rgba(255,255,255,0.85)', textDecoration: 'none',
          fontSize: '0.75rem', fontWeight: 500, whiteSpace: 'nowrap',
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
        onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.85)')}
      >
        Client Settings
      </a>

      {/* Report dropdown */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setReportDropdown(v => !v)}
          style={{
            background: 'rgba(255,255,255,0.15)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 6, color: '#fff',
            fontSize: '0.75rem', fontWeight: 500,
            padding: '0.25rem 0.65rem',
            cursor: 'pointer', whiteSpace: 'nowrap',
            display: 'flex', alignItems: 'center', gap: 4,
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.25)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
        >
          <Printer size={13} weight="bold" />Report<CaretDown size={10} />
        </button>
        {reportDropdown && (
          <div
            style={{
              position: 'absolute', top: '110%', right: 0,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
              minWidth: 160, zIndex: 1000,
              overflow: 'hidden',
            }}
            onMouseLeave={() => setReportDropdown(false)}
          >
            {[
              { label: 'Print / PDF', icon: <Printer size={13} />, action: () => { openReport(); setReportDropdown(false) } },
              { label: 'Preview & Email', icon: <Envelope size={13} />, action: () => { setReportOpen(true); setReportDropdown(false) } },
            ].map(item => (
              <button
                key={item.label}
                onClick={item.action}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', textAlign: 'left',
                  background: 'none', border: 'none',
                  padding: '0.5rem 0.875rem',
                  fontSize: '0.8125rem', color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  transition: 'background 0.1s, color 0.1s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-secondary)' }}
              >
                {item.icon}{item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {reportOpen && (
        <ReportModal
          from={searchParams.get('from') ?? ''}
          to={searchParams.get('to') ?? ''}
          compare={searchParams.get('compare') ?? 'none'}
          clientId={currentClientId}
          onClose={() => setReportOpen(false)}
        />
      )}

      {/* Share link */}
      <button
        onClick={handleCopyLink}
        style={{
          background: 'rgba(255,255,255,0.15)',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 6, color: '#fff',
          fontSize: '0.75rem', fontWeight: 500,
          padding: '0.25rem 0.65rem',
          cursor: 'pointer', whiteSpace: 'nowrap',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.25)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
      >
        {copied ? '✓ Copied!' : <><ShareNetwork size={13} weight="bold" style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />Share</>}
      </button>
    </div>
  )
}

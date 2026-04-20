'use client'

import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import { Warning, ArrowSquareOut, GearSix } from '@phosphor-icons/react'
import { ConnectorLogo } from '@/components/ConnectorLogo'
import EfficiencyScore   from '@/components/EfficiencyScore'

interface ConnectorBadge {
  id:    string
  type:  string
  label: string
}

export interface ClientHealthCardProps {
  id:                string
  name:              string
  logoUrl:           string | null
  connectors:        ConnectorBadge[]
  efficiencyScore:   number | null
  totalSpend:        number
  enabledBenchmarks: string[] | null
  roas:              number | null
  ctr:               number
  conversions:       number
  cpl:               number | null
  insights:          string[]
  lastSyncedAt:      string | null
  syncErrors7d:      number
  delay?:            number
}

function fmtSpend(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}k`
  return `$${n.toFixed(0)}`
}

function fmtCpl(n: number): string {
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`
  return `$${n.toFixed(0)}`
}

function timeSince(iso: string): string {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000
  if (h < 1)  return 'Just now'
  if (h < 24) return `${Math.floor(h)}h ago`
  const d = h / 24
  if (d < 7)  return `${Math.floor(d)}d ago`
  return `${Math.floor(d / 7)}w ago`
}

function KpiCell({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div>
      <p style={{
        fontSize: '0.625rem', fontWeight: 600,
        color: 'var(--text-faint)',
        textTransform: 'uppercase', letterSpacing: '0.06em',
        marginBottom: 3,
      }}>
        {label}
      </p>
      <p style={{
        fontSize: '0.9375rem', fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.2,
        color: valueColor ?? 'var(--text-primary)',
      }}>
        {value}
      </p>
    </div>
  )
}

export default function ClientHealthCard({
  id, name, logoUrl, connectors,
  efficiencyScore, totalSpend, enabledBenchmarks, roas, ctr, conversions, cpl,
  insights, lastSyncedAt, syncErrors7d,
  delay = 0,
}: ClientHealthCardProps) {
  const showRoas = enabledBenchmarks ? enabledBenchmarks.includes('roas') : roas !== null
  const prefersReduced = useReducedMotion()

  const hoursAgo = lastSyncedAt
    ? (Date.now() - new Date(lastSyncedAt).getTime()) / 3_600_000
    : Infinity
  const dotColor = hoursAgo < 24 ? 'var(--green)' : hoursAgo < 72 ? '#f59e0b' : 'var(--red)'

  const roasColor = roas !== null
    ? (roas >= 1 ? 'var(--green)' : 'var(--red)')
    : undefined

  return (
    <motion.div
      className="card p-5"
      style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
      initial={prefersReduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={prefersReduced ? {} : { duration: 0.25, delay: delay * 0.06, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* ── Header: logo + name + connector icons ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {logoUrl && (
            <img
              src={logoUrl}
              alt=""
              aria-hidden
              style={{ width: 26, height: 26, borderRadius: 5, objectFit: 'contain', flexShrink: 0 }}
            />
          )}
          <Link
            href={`/admin/clients/${id}`}
            style={{
              fontWeight: 650, fontSize: '0.9375rem',
              color: 'var(--text-primary)', textDecoration: 'none',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {name}
          </Link>
        </div>
        {/* Connector logo icons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {connectors.length === 0 ? (
            <span className="badge badge-gray" style={{ fontSize: '0.6875rem' }}>No sources</span>
          ) : (
            connectors.map(c => (
              <span key={c.id} title={c.label} style={{ display: 'flex', alignItems: 'center' }}>
                <ConnectorLogo type={c.type} size={16} aria-hidden />
              </span>
            ))
          )}
        </div>
      </div>

      {/* ── Score gauge + KPI grid ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {efficiencyScore !== null && (
          <EfficiencyScore score={efficiencyScore} components={[]} compact />
        )}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '0.5rem 1.25rem',
          flex: 1,
          minWidth: 0,
        }}>
          <KpiCell label="Spend"       value={totalSpend > 0 ? fmtSpend(totalSpend) : '—'} />
          {showRoas
            ? <KpiCell label="ROAS" value={roas !== null ? `${roas.toFixed(1)}x` : '—'} valueColor={roasColor} />
            : <KpiCell label="CTR"  value={ctr > 0 ? `${(ctr * 100).toFixed(2)}%` : '—'} />
          }
          <KpiCell label="Conversions" value={conversions > 0 ? conversions.toLocaleString() : '—'} />
          <KpiCell label="CPA"         value={cpl !== null ? fmtCpl(cpl) : '—'} />
        </div>
      </div>

      {/* ── Insight chips ── */}
      {insights.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
          {insights.map((chip, i) => (
            <span
              key={i}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: '0.6875rem', fontWeight: 500,
                padding: '0.15rem 0.5rem', borderRadius: 4,
                background: 'rgba(245, 158, 11, 0.1)',
                color: '#b45309',
                border: '1px solid rgba(245, 158, 11, 0.2)',
              }}
            >
              <Warning size={10} aria-hidden />
              {chip}
            </span>
          ))}
        </div>
      )}

      {/* ── Footer: sync status + action buttons ── */}
      <div style={{
        display: 'flex', alignItems: 'center',
        paddingTop: '0.75rem', gap: 8,
        borderTop: '1px solid var(--border)',
        marginTop: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: dotColor, flexShrink: 0, display: 'inline-block',
          }} />
          <span className="text-xs" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {lastSyncedAt ? timeSince(lastSyncedAt) : 'Never synced'}
          </span>
          {syncErrors7d > 0 && (
            <span className="badge badge-red" style={{ fontSize: '0.6875rem', flexShrink: 0, whiteSpace: 'nowrap' }}>
              {syncErrors7d} err{syncErrors7d > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <Link
            href={`/api/admin/preview/${id}`}
            className="btn btn-secondary"
            style={{ fontSize: '0.6875rem', padding: '0.175rem 0.5rem', display: 'flex', alignItems: 'center', gap: 3 }}
          >
            <ArrowSquareOut size={11} aria-hidden />
            Preview
          </Link>
          <Link
            href={`/admin/clients/${id}`}
            className="btn btn-secondary"
            style={{ fontSize: '0.6875rem', padding: '0.175rem 0.5rem', display: 'flex', alignItems: 'center', gap: 3 }}
          >
            <GearSix size={11} aria-hidden />
            Settings
          </Link>
        </div>
      </div>
    </motion.div>
  )
}

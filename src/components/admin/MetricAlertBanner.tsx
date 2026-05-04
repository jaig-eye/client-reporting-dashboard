'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface MetricAlert {
  id:         string
  clientId:   string
  clientName: string
  metric:     string
  currentVal: number
  priorVal:   number
  pctChange:  number
  direction:  'up' | 'down'
  insight:    string
  createdAt:  string
}

const GOOD_UP   = new Set(['roas', 'conversions'])  // up = good
const BAD_DOWN  = new Set(['spend'])                 // down = good (lower spend = may be bad)

function alertColor(alert: MetricAlert): { bg: string; border: string; dot: string } {
  const up      = alert.direction === 'up'
  const isGood  = GOOD_UP.has(alert.metric) ? up : !up
  return isGood
    ? { bg: 'rgba(16,185,129,0.08)',  border: '#10b981', dot: '#10b981' }
    : { bg: 'rgba(239,68,68,0.08)',   border: '#ef4444', dot: '#ef4444' }
}

function metricLabel(m: string): string {
  return { spend: 'Spend', cpa: 'CPA', roas: 'ROAS', ctr: 'CTR', conversions: 'Conversions' }[m] ?? m.toUpperCase()
}

export default function MetricAlertBanner() {
  const [alerts,   setAlerts]   = useState<MetricAlert[]>([])
  const [expanded, setExpanded] = useState(false)
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    fetch('/api/admin/metric-alerts')
      .then(r => r.json())
      .then(d => { setAlerts((d as { alerts: MetricAlert[] }).alerts ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function dismiss(id: string) {
    setAlerts(prev => prev.filter(a => a.id !== id))
    await fetch(`/api/admin/metric-alerts/${id}/dismiss`, { method: 'POST' })
  }

  if (loading || alerts.length === 0) return null

  const visible = expanded ? alerts : alerts.slice(0, 3)
  const hidden  = alerts.length - 3

  return (
    <div style={{ marginBottom: 20 }}>
      {visible.map(alert => {
        const colors = alertColor(alert)
        const sign   = alert.direction === 'up' ? '+' : '−'
        return (
          <div
            key={alert.id}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px',
              borderRadius: 8, border: `1px solid ${colors.border}30`,
              background: colors.bg, marginBottom: 8,
            }}
          >
            {/* Dot */}
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: colors.dot,
              marginTop: 5, flexShrink: 0,
            }} />

            {/* Content */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                <strong>{alert.clientName}</strong>
                {' — '}
                {metricLabel(alert.metric)} {alert.direction === 'up' ? '▲' : '▼'} {sign}{Math.abs(alert.pctChange).toFixed(0)}%
                {' '}
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                  (14d vs prior 14d)
                </span>
              </span>
              {alert.insight && (
                <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {alert.insight}
                </p>
              )}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
              <Link
                href={`/api/admin/preview/${alert.clientId}`}
                style={{ fontSize: '0.75rem', color: 'var(--blue)', textDecoration: 'none', whiteSpace: 'nowrap' }}
              >
                View →
              </Link>
              <button
                onClick={() => dismiss(alert.id)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '0.875rem', color: 'var(--text-faint)', padding: '0 2px', lineHeight: 1,
                }}
                title="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        )
      })}

      {/* Expand/collapse */}
      {!expanded && hidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '0.8125rem', color: 'var(--blue)', padding: 0,
          }}
        >
          Show {hidden} more alert{hidden > 1 ? 's' : ''} ▾
        </button>
      )}
      {expanded && alerts.length > 3 && (
        <button
          onClick={() => setExpanded(false)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '0.8125rem', color: 'var(--blue)', padding: 0,
          }}
        >
          Show less ▴
        </button>
      )}
    </div>
  )
}

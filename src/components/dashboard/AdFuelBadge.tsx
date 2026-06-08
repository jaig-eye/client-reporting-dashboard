'use client'

import { useState, useEffect } from 'react'
import { Plus } from '@phosphor-icons/react'

const FORM_URL = 'https://link.launchlocal.io/widget/form/diJohLpSz5Vks5Ccex7n'

// 4 sinusoidal cycles across 360 viewBox units
const WAVE_PATH = 'M0,11 C30,2 60,2 90,11 C120,20 150,20 180,11 C210,2 240,2 270,11 C300,20 330,20 360,11 L360,22 L0,22 Z'

const WAVE_CSS = `
@keyframes adFuelWave {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
`

export default function AdFuelBadge({
  balance,
  clientName,
  monthlyBudget,
  pendingAmount,
}: {
  balance:         number
  clientName:      string
  monthlyBudget?:  number
  pendingAmount?:  number  // ACH payment in transit — shown as projected addition
}) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 60)
    return () => clearTimeout(t)
  }, [])

  const isLow      = balance < 200
  const isNegative = balance < 0

  const reference   = monthlyBudget && monthlyBudget > 0 ? monthlyBudget : 1500
  const rawFill     = balance <= 0 ? 3 : Math.min(Math.max((balance / reference) * 100, 3), 95)
  const displayFill = mounted ? rawFill : 0

  // Normal: soft blue. Low: amber.
  const fillColor  = isLow ? 'rgba(251,191,36,0.14)'  : 'rgba(220,236,255,0.30)'
  const waveColor  = isLow ? 'rgb(251,191,36)'         : 'rgb(220,236,255)'
  const btnBg      = isLow ? '#f59e0b'                 : '#3b82f6'
  const amtColor   = isLow ? '#d97706'                 : 'var(--text-primary)'
  const borderCol  = isLow ? 'rgba(245,158,11,0.3)'    : 'var(--border, #e5e7eb)'
  const refillUrl  = `${FORM_URL}?organization=${encodeURIComponent(clientName)}`

  const absVal    = Math.abs(balance)
  const formatted = (isNegative ? '-$' : '$') +
    absVal.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

  return (
    <div style={{
      position: 'relative',
      width: 188, height: 76,
      borderRadius: 10, overflow: 'hidden',
      background: 'var(--bg-surface, #fff)',
      border: `1px solid ${borderCol}`,
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      flexShrink: 0,
    }}>
      <style>{WAVE_CSS}</style>

      {/* ── Liquid fill body ─────────────────────────────────── */}
      <div style={{
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        height: `${displayFill}%`,
        background: fillColor,
        transition: 'height 1.6s cubic-bezier(0.25,0.85,0.25,1)',
        zIndex: 1,
        overflow: 'visible',
      }}>
        {/* Wave — top exactly at fill body edge (top: -22 = -height), no overlap */}
        <div style={{
          position: 'absolute',
          top: -22, left: 0,
          width: '100%', height: 22,
          pointerEvents: 'none',
        }}>
          <svg
            viewBox="0 0 360 22"
            preserveAspectRatio="none"
            style={{
              position: 'absolute', top: 0, left: 0,
              width: '200%', height: 22,
              animation: 'adFuelWave 8s linear infinite',
            }}
          >
            <defs>
              <linearGradient id="adfuelGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={waveColor} stopOpacity="0"    />
                <stop offset="42%"  stopColor={waveColor} stopOpacity="0.30" />
                <stop offset="100%" stopColor={waveColor} stopOpacity="0.30" />
              </linearGradient>
            </defs>
            <path d={WAVE_PATH} fill="url(#adfuelGrad)" />
          </svg>
        </div>
      </div>

      {/* ── Content overlay ──────────────────────────────────── */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center',
        padding: '0 12px', zIndex: 2, gap: 10,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            fontSize: '0.575rem', textTransform: 'uppercase',
            letterSpacing: '0.08em', color: 'var(--text-faint)',
            margin: 0, lineHeight: 1.2, fontWeight: 600,
          }}>
            Ad Fuel
          </p>
          <p style={{
            fontSize: '1.0625rem', fontWeight: 700,
            color: amtColor, margin: '3px 0 0',
            lineHeight: 1.2, letterSpacing: '-0.01em',
          }}>
            {formatted}
          </p>
          {pendingAmount && pendingAmount > 0 && (
            <p style={{ fontSize: '0.575rem', color: 'var(--text-faint)', margin: '2px 0 0', lineHeight: 1 }}
               title="Pending ACH payment — will be credited once cleared">
              +${pendingAmount.toLocaleString('en-US', { maximumFractionDigits: 0 })} pending
            </p>
          )}
          {isLow && !pendingAmount && (
            <p style={{ fontSize: '0.575rem', color: '#d97706', margin: '2px 0 0', lineHeight: 1 }}>
              Low balance
            </p>
          )}
          {isLow && pendingAmount && pendingAmount > 0 && (
            <p style={{ fontSize: '0.575rem', color: '#d97706', margin: '1px 0 0', lineHeight: 1 }}>
              Low balance
            </p>
          )}
        </div>

        <a
          href={refillUrl} target="_blank" rel="noopener noreferrer" title="Refill Ad Fuel"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 26, height: 26, borderRadius: '50%',
            background: btnBg, color: '#fff', flexShrink: 0,
            textDecoration: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
            transition: 'transform 0.15s, box-shadow 0.15s',
          }}
          onMouseEnter={e => {
            ;(e.currentTarget as HTMLElement).style.transform = 'scale(1.1)'
            ;(e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.28)'
          }}
          onMouseLeave={e => {
            ;(e.currentTarget as HTMLElement).style.transform = 'scale(1)'
            ;(e.currentTarget as HTMLElement).style.boxShadow = '0 1px 4px rgba(0,0,0,0.18)'
          }}
        >
          <Plus size={12} weight="bold" />
        </a>
      </div>
    </div>
  )
}

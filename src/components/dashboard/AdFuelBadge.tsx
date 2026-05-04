'use client'

import { useState, useEffect } from 'react'
import { Plus } from '@phosphor-icons/react'

const FORM_URL = 'https://link.launchlocal.io/widget/form/diJohLpSz5Vks5Ccex7n'

// 4 sinusoidal cycles across 360 viewBox units (period=90, amplitude=10, midline=14)
const WAVE_PATH  = 'M0,14 C30,4 60,4 90,14 C120,24 150,24 180,14 C210,4 240,4 270,14 C300,24 330,24 360,14 L360,28 L0,28 Z'
// Slightly different phase/amplitude for layered depth
const WAVE_PATH2 = 'M0,17 C30,9 60,9 90,17 C120,23 150,23 180,17 C210,9 240,9 270,17 C300,23 330,23 360,17 L360,28 L0,28 Z'

const WAVE_CSS = `
@keyframes adFuelW1 {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
@keyframes adFuelW2 {
  0%   { transform: translateX(-50%); }
  100% { transform: translateX(0); }
}
`

export default function AdFuelBadge({
  balance,
  clientName,
  monthlyBudget,
}: {
  balance:        number
  clientName:     string
  monthlyBudget?: number
}) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 60)
    return () => clearTimeout(t)
  }, [])

  const isLow      = balance < 200
  const isNegative = balance < 0

  // Fill level: balance as % of monthly budget, minimum 3% so wave always shows
  const reference   = monthlyBudget && monthlyBudget > 0 ? monthlyBudget : 1500
  const rawFill     = balance <= 0 ? 3 : Math.min(Math.max((balance / reference) * 100, 3), 95)
  const displayFill = mounted ? rawFill : 0

  const fillRgb    = isLow ? '245,158,11' : '99,102,241'
  const btnBg      = isLow ? '#f59e0b' : '#6366f1'
  const amtColor   = isLow ? '#d97706' : 'var(--text-primary)'
  const borderCol  = isLow ? 'rgba(245,158,11,0.35)' : 'var(--border, #e5e7eb)'
  const refillUrl  = `${FORM_URL}?organization=${encodeURIComponent(clientName)}`

  const absVal    = Math.abs(balance)
  const formatted = (isNegative ? '-$' : '$') +
    absVal.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

  return (
    <div style={{
      position: 'relative',
      width: 188,
      height: 76,
      borderRadius: 10,
      overflow: 'hidden',
      background: 'var(--bg-surface, #fff)',
      border: `1px solid ${borderCol}`,
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      flexShrink: 0,
    }}>
      <style>{WAVE_CSS}</style>

      {/* ── Liquid body ─────────────────────────────────────── */}
      <div style={{
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        height: `${displayFill}%`,
        background: isLow ? 'rgba(245,158,11,0.12)' : 'rgba(216,217,248,0.88)',
        transition: 'height 1.6s cubic-bezier(0.25,0.85,0.25,1)',
        zIndex: 1,
        overflow: 'visible',
      }}>
        {/* Wave container — gradient fill so peaks feather into white background */}
        <div style={{
          position: 'absolute',
          top: -22, left: 0,
          width: '100%', height: 26,
          pointerEvents: 'none',
        }}>
          {/* Wave 1 — forward scroll */}
          <svg
            viewBox="0 0 360 26"
            preserveAspectRatio="none"
            style={{
              position: 'absolute', top: 0, left: 0,
              width: '200%', height: 26,
              animation: 'adFuelW1 7s linear infinite',
            }}
          >
            <defs>
              <linearGradient id="wg1" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={isLow ? 'rgb(245,158,11)' : 'rgb(216,217,248)'} stopOpacity="0" />
                <stop offset="55%"  stopColor={isLow ? 'rgb(245,158,11)' : 'rgb(216,217,248)'} stopOpacity="0.7" />
                <stop offset="100%" stopColor={isLow ? 'rgb(245,158,11)' : 'rgb(216,217,248)'} stopOpacity="0.88" />
              </linearGradient>
            </defs>
            <path
              d="M0,13 C30,3 60,3 90,13 C120,23 150,23 180,13 C210,3 240,3 270,13 C300,23 330,23 360,13 L360,26 L0,26 Z"
              fill="url(#wg1)"
            />
          </svg>

          {/* Wave 2 — reverse scroll, phase-offset for depth */}
          <svg
            viewBox="0 0 360 26"
            preserveAspectRatio="none"
            style={{
              position: 'absolute', top: 0, left: 0,
              width: '200%', height: 26,
              animation: 'adFuelW2 11s linear infinite',
            }}
          >
            <defs>
              <linearGradient id="wg2" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={isLow ? 'rgb(245,158,11)' : 'rgb(199,201,245)'} stopOpacity="0" />
                <stop offset="60%"  stopColor={isLow ? 'rgb(245,158,11)' : 'rgb(199,201,245)'} stopOpacity="0.5" />
                <stop offset="100%" stopColor={isLow ? 'rgb(245,158,11)' : 'rgb(199,201,245)'} stopOpacity="0.75" />
              </linearGradient>
            </defs>
            <path
              d="M0,16 C30,7 60,7 90,16 C120,23 150,23 180,16 C210,7 240,7 270,16 C300,23 330,23 360,16 L360,26 L0,26 Z"
              fill="url(#wg2)"
            />
          </svg>
        </div>
      </div>

      {/* ── Content overlay ──────────────────────────────────── */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center',
        padding: '0 12px',
        zIndex: 2,
        gap: 10,
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
            color: amtColor,
            margin: '3px 0 0', lineHeight: 1.2,
            letterSpacing: '-0.01em',
          }}>
            {formatted}
          </p>
          {isLow && (
            <p style={{ fontSize: '0.575rem', color: '#d97706', margin: '2px 0 0', lineHeight: 1 }}>
              Low balance
            </p>
          )}
        </div>

        {/* Refill button */}
        <a
          href={refillUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Refill Ad Fuel"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 26, height: 26, borderRadius: '50%',
            background: btnBg, color: '#fff', flexShrink: 0,
            textDecoration: 'none',
            boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
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

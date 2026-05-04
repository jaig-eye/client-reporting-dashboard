'use client'

import { Coins, Plus } from '@phosphor-icons/react'

const FORM_URL = 'https://link.launchlocal.io/widget/form/diJohLpSz5Vks5Ccex7n'

const WAVE_CSS = `
@keyframes adFuelSlosh {
  0%,100% { transform: translateX(0) scaleY(1); }
  50%     { transform: translateX(8%) scaleY(0.85); }
}
`

export default function AdFuelBadge({
  balance,
  clientName,
}: {
  balance:    number
  clientName: string
}) {
  const isLow      = balance < 200
  const isNegative = balance < 0
  // Fill 3–93% of the tank, scaled against $1500 reference
  const fillPct    = Math.min(Math.max((balance / 1500) * 100, 3), 93)
  const fillColor  = isLow
    ? 'rgba(245,158,11,0.38)'
    : 'rgba(99,102,241,0.32)'
  const waveColor  = isLow
    ? 'rgba(245,158,11,0.65)'
    : 'rgba(99,102,241,0.60)'
  const labelColor = isLow ? '#f59e0b' : 'var(--text-primary)'
  const refillUrl  = `${FORM_URL}?organization=${encodeURIComponent(clientName)}`

  const absVal = Math.abs(balance)
  const formatted = (isNegative ? '-$' : '$') +
    absVal.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      background: 'var(--bg-surface, #fff)',
      border: `1px solid ${isLow ? 'rgba(245,158,11,0.35)' : 'var(--border, #e5e7eb)'}`,
      borderRadius: 10, padding: '8px 12px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      flexShrink: 0,
    }}>
      <style>{WAVE_CSS}</style>

      {/* Liquid tank visual */}
      <div style={{
        width: 32, height: 42, borderRadius: 6,
        border: `1.5px solid ${isLow ? 'rgba(245,158,11,0.4)' : 'rgba(99,102,241,0.3)'}`,
        overflow: 'hidden', position: 'relative', flexShrink: 0,
        background: 'var(--bg-base, #f8fafc)',
      }}>
        {/* Liquid fill */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          height: `${fillPct}%`,
          background: fillColor,
          transition: 'height 1.2s cubic-bezier(0.34,1.56,0.64,1)',
        }}>
          {/* Sloshing wave top edge */}
          <div style={{
            position: 'absolute', top: -5, left: '-10%', width: '120%', height: 10,
            borderRadius: '50%',
            background: waveColor,
            animation: 'adFuelSlosh 3s ease-in-out infinite',
          }} />
        </div>

        {/* Coins icon centered */}
        <Coins
          size={13}
          weight="duotone"
          style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%,-50%)',
            color: isLow ? '#f59e0b' : '#6366f1',
            zIndex: 2, flexShrink: 0,
          }}
        />
      </div>

      {/* Label + amount */}
      <div>
        <p style={{
          fontSize: '0.6rem', textTransform: 'uppercase',
          letterSpacing: '0.07em', color: 'var(--text-faint)',
          margin: 0, lineHeight: 1.2,
        }}>
          Ad Fuel
        </p>
        <p style={{
          fontSize: '0.9375rem', fontWeight: 700,
          color: labelColor, margin: 0, lineHeight: 1.3,
          letterSpacing: '-0.01em',
        }}>
          {formatted}
        </p>
        {isLow && (
          <p style={{ fontSize: '0.6rem', color: '#f59e0b', margin: 0, lineHeight: 1.2 }}>
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
          background: '#6366f1', color: '#fff', flexShrink: 0,
          textDecoration: 'none', opacity: 0.9,
          transition: 'opacity 0.15s, transform 0.15s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.transform = 'scale(1.08)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0.9'; (e.currentTarget as HTMLElement).style.transform = 'scale(1)' }}
      >
        <Plus size={13} weight="bold" />
      </a>
    </div>
  )
}

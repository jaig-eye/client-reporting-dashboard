'use client'

import { useEffect, useState } from 'react'

interface IntegrationCardProps {
  icon:            React.ReactNode
  name:            string
  description:     string
  isConnected:     boolean
  connectedLabel?: string          // e.g. "ch: 123456789..." or "cus_xxx..."
  onConfigure:     () => void
  justConnected?:  boolean         // parent sets true after save → triggers animation
}

export default function IntegrationCard({
  icon, name, description, isConnected, connectedLabel, onConfigure, justConnected,
}: IntegrationCardProps) {
  const [animate, setAnimate] = useState(false)

  useEffect(() => {
    if (justConnected) {
      setAnimate(true)
      const t = setTimeout(() => setAnimate(false), 1600)
      return () => clearTimeout(t)
    }
  }, [justConnected])

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: `1px solid ${isConnected ? 'var(--border)' : 'var(--border-subtle)'}`,
      borderRadius: 10,
      padding: '1rem 1.125rem',
      display: 'flex',
      alignItems: 'center',
      gap: '0.875rem',
    }}>
      {/* Icon */}
      <div style={{
        width: 40, height: 40, borderRadius: 8, flexShrink: 0,
        background: 'var(--bg-subtle)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.25rem',
      }}>
        {icon}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{name}</span>
          {isConnected && (
            <span
              className={animate ? 'integration-badge-pop' : ''}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '1px 8px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 600,
                background: '#dcfce7', color: '#166534',
                transition: 'all 0.3s',
              }}
            >
              {animate ? (
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ animation: 'checkmark-draw 0.4s ease forwards' }}>
                  <circle cx="6" cy="6" r="5.5" stroke="#16a34a" strokeWidth="1" fill="#dcfce7" style={{ animation: 'circle-scale 0.3s ease forwards' }} />
                  <polyline points="2.5,6 5,8.5 9.5,3.5" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                    style={{ strokeDasharray: 10, strokeDashoffset: 10, animation: 'checkmark-draw 0.4s 0.15s ease forwards' }} />
                </svg>
              ) : '✓'} Connected
            </span>
          )}
        </div>
        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{description}</p>
        {isConnected && connectedLabel && (
          <p style={{ margin: '3px 0 0', fontSize: '0.7rem', color: 'var(--text-faint)', fontFamily: 'monospace' }}>
            {connectedLabel}
          </p>
        )}
      </div>

      {/* Action button */}
      <button
        type="button"
        onClick={onConfigure}
        className={isConnected ? 'btn btn-secondary' : 'btn btn-primary'}
        style={{ flexShrink: 0, fontSize: '0.8rem', padding: '0.375rem 0.875rem' }}
      >
        {isConnected ? 'Configure' : 'Connect'}
      </button>
    </div>
  )
}

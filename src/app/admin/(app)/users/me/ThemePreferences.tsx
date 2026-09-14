'use client'

// Appearance — per-user colour mode and accent. Moved here from Agency Settings: these only
// affect the signed-in admin's own view. Changes persist via ThemeProvider (PATCH /api/admin/users/me).

import { useTheme } from '@/components/ThemeProvider'
import type { ThemeMode } from '@/components/ThemeProvider'

const ACCENT_PRESETS = [
  { label: 'Blue',    value: '#2563eb' },
  { label: 'Purple',  value: '#7c3aed' },
  { label: 'Emerald', value: '#059669' },
  { label: 'Rose',    value: '#e11d48' },
  { label: 'Amber',   value: '#d97706' },
  { label: 'Slate',   value: '#475569' },
]

export default function ThemePreferences() {
  const theme = useTheme()
  if (!theme) return null
  const { mode, accentColor, setMode, setAccent } = theme

  const modeLabels: { value: ThemeMode; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark',  label: 'Dark'  },
    { value: 'auto',  label: 'Auto'  },
  ]

  return (
    <div className="card p-6 space-y-5">
      <div>
        <h2 className="section-title">Appearance</h2>
        <p className="section-desc">Personal settings — only affect your own view. Each admin can set their own.</p>
      </div>

      {/* Mode toggle */}
      <div>
        <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-muted)' }}>
          Color mode
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          {modeLabels.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              style={{
                padding: '0.375rem 1rem',
                borderRadius: '0.5rem',
                fontSize: '0.8125rem',
                fontWeight: mode === value ? 600 : 400,
                border: mode === value ? '2px solid var(--accent)' : '1px solid var(--border)',
                background: mode === value ? 'var(--accent-subtle)' : 'var(--bg-surface)',
                color: mode === value ? 'var(--accent)' : 'var(--text-muted)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Accent color */}
      <div>
        <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-muted)' }}>
          Accent color
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {ACCENT_PRESETS.map(preset => (
            <button
              key={preset.value}
              type="button"
              title={preset.label}
              onClick={() => setAccent(preset.value)}
              style={{
                width: 28, height: 28, borderRadius: '50%',
                background: preset.value,
                border: accentColor === preset.value ? '3px solid var(--text-primary)' : '2px solid transparent',
                boxShadow: accentColor === preset.value ? '0 0 0 2px var(--bg-surface), 0 0 0 4px var(--text-primary)' : '0 1px 3px rgba(0,0,0,0.2)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            />
          ))}
          <input
            type="color"
            value={accentColor || '#2563eb'}
            onChange={e => setAccent(e.target.value)}
            title="Custom color"
            style={{
              width: 28, height: 28, borderRadius: '50%',
              padding: 2, border: '1px solid var(--border)',
              cursor: 'pointer', background: 'var(--bg-surface)',
            }}
          />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)', fontFamily: 'monospace' }}>
            {accentColor}
          </span>
        </div>
      </div>
    </div>
  )
}

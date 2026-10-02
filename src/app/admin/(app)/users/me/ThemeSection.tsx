'use client'

// Your theme: colour mode and accent. It's yours alone (saved on your user, applied before the
// page paints by ThemeScript), so it lives on your profile, not in Agency settings with what
// changes things for everyone.

import Section from '@/components/ui/Section'
import { useTheme, type ThemeMode } from '@/components/ThemeProvider'

// Preset accents. These are values a person picks (stored on their profile), not styling.
const ACCENT_PRESETS = [
  { label: 'Blue',    value: '#2563eb' },
  { label: 'Purple',  value: '#7c3aed' },
  { label: 'Emerald', value: '#059669' },
  { label: 'Rose',    value: '#e11d48' },
  { label: 'Amber',   value: '#d97706' },
  { label: 'Slate',   value: '#475569' },
]

const MODES: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark',  label: 'Dark'  },
  { value: 'auto',  label: 'Auto'  },
]

/** `saved` is false for the master account: it has no user record to keep a theme on. */
export default function ThemeSection({ saved = true }: { saved?: boolean }) {
  const theme = useTheme()
  if (!theme) return null
  const { mode, accentColor, setMode, setAccent } = theme

  return (
    <Section
      title="Theme"
      description={saved
        ? 'Only changes what you see, and saves straight away.'
        : 'Only changes what you see. The master account has no user record to save it on, so it resets when the page reloads.'}
    >
      <div className="ui-fields">
        <div className="ui-field">
          <span className="ui-field-label" id="pf-mode-label">Color mode</span>
          <div className="ui-tabs" style={{ alignSelf: 'flex-start' }}>
            <div className="ui-tabs-track" role="radiogroup" aria-labelledby="pf-mode-label">
              {MODES.map(({ value, label }) => (
                <button key={value} type="button" role="radio" aria-checked={mode === value} className="ui-tab" onClick={() => setMode(value)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="ui-field-hint">Auto follows your device’s setting.</p>
        </div>

        <div className="ui-field">
          <span className="ui-field-label" id="pf-accent-label">Accent color</span>
          <div className="ui-swatches" role="radiogroup" aria-labelledby="pf-accent-label">
            {ACCENT_PRESETS.map(preset => (
              <button
                key={preset.value}
                type="button"
                role="radio"
                aria-checked={accentColor === preset.value}
                aria-label={preset.label}
                title={preset.label}
                className="ui-swatch"
                style={{ '--sw': preset.value } as React.CSSProperties}
                onClick={() => setAccent(preset.value)}
              />
            ))}
            <input
              type="color"
              className="ui-swatch-custom"
              value={accentColor || '#2563eb'}
              onChange={e => setAccent(e.target.value)}
              aria-label="Custom accent color"
              title="Custom color"
            />
            <span className="ui-swatch-value">{accentColor}</span>
          </div>
        </div>
      </div>
    </Section>
  )
}

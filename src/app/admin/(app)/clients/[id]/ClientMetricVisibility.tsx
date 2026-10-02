'use client'

import { useState } from 'react'
import { CheckCircle } from '@phosphor-icons/react'
import { SwitchRow } from '@/components/ui/Switch'
import MetricLayoutEditor from '@/components/admin/MetricLayoutEditor'
import type { MetricLayouts } from '@/lib/metric-layouts'

// Visibility toggles that are not layout-driven
const VISIBILITY_DEFS = [
  { id: 'daily_chart', label: 'Daily performance chart', desc: 'Spend and conversions, day by day' },
  { id: 'campaigns',   label: 'Campaign breakdown',      desc: 'Campaign performance table' },
]

export default function ClientMetricVisibility({
  clientId,
  initialHidden,
  initialLayoutType,
  initialLayoutOverride,
  agencyLayouts,
}: {
  clientId:             string
  initialHidden:        string[]
  initialLayoutType:    string | null
  initialLayoutOverride: MetricLayouts | null
  agencyLayouts:        MetricLayouts | null
}) {
  const [hidden,         setHidden]         = useState<Set<string>>(new Set(initialHidden))
  const [layoutType,     setLayoutType]     = useState<string>(initialLayoutType ?? 'auto')
  const [layoutOverride, setLayoutOverride] = useState<MetricLayouts | null>(initialLayoutOverride)
  const [showCustom,     setShowCustom]     = useState<boolean>(!!initialLayoutOverride)
  const [saving,         setSaving]         = useState(false)
  const [saved,          setSaved]          = useState(false)

  async function patch(body: Record<string, unknown>) {
    setSaving(true); setSaved(false)
    await fetch(`/api/admin/clients/${clientId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function handleLayoutTypeChange(val: string) {
    setLayoutType(val)
    patch({ layout_type: val === 'auto' ? null : val })
  }

  function handleLayoutOverrideChange(v: MetricLayouts) {
    const isDefault = agencyLayouts !== null && JSON.stringify(v) === JSON.stringify(agencyLayouts)
    const effective = isDefault ? null : v
    setLayoutOverride(effective)
    patch({ metric_layout_override: effective })
  }

  async function resetLayoutOverride() {
    setLayoutOverride(null)
    setShowCustom(false)
    patch({ metric_layout_override: null })
  }

  function toggleVisibility(id: string) {
    const next = new Set(hidden)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setHidden(next)
    patch({ hidden_metrics: Array.from(next) })
  }

  return (
    <div className="space-y-6">

      {/* ── Layout type ─────────────────────────────────────────────── */}
      <div className="card p-5">
        <h3 className="section-title mb-1">Layout type</h3>
        <p className="section-desc mb-3">
          Choose which preset layout drives this client&rsquo;s KPI cards, top metrics, and table columns.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['auto', 'lead_gen', 'ecom'] as const).map(val => (
            <button
              key={val}
              type="button"
              className="ui-pick"
              aria-pressed={layoutType === val}
              onClick={() => handleLayoutTypeChange(val)}
              disabled={saving}
            >
              {val === 'auto' ? 'Auto-detect' : val === 'lead_gen' ? 'Lead gen' : 'Ecommerce'}
            </button>
          ))}
        </div>
        <p className="text-xs mt-2" style={{ color: 'var(--text-faint)' }}>
          Auto-detect picks ecom or lead gen based on how campaigns are tagged.
        </p>
      </div>

      {/* ── Custom layout override ──────────────────────────────────── */}
      <div className="card p-5">
        {/* Header row — always visible */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 className="section-title mb-0">Custom layout override</h3>
            <p className="section-desc mt-0.5">
              {layoutOverride
                ? 'Client-specific layout active — overrides the agency default.'
                : 'Using agency default layout.'}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {layoutOverride && !showCustom && (
              <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--blue)', background: 'color-mix(in srgb, var(--blue) 12%, transparent)', borderRadius: 4, padding: '0.125rem 0.5rem' }}>
                Custom
              </span>
            )}
            {/* Toggle switch */}
            <button
              type="button"
              onClick={() => setShowCustom(v => !v)}
              title={showCustom ? 'Collapse editor' : 'Edit custom layout'}
              style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: showCustom ? 'var(--blue)' : 'var(--text-faint)', lineHeight: 1 }}
            >
              {/* Gear icon */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Collapsible editor */}
        {showCustom && (
          <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
            <MetricLayoutEditor
              value={layoutOverride}
              onChange={handleLayoutOverrideChange}
              defaultInnerTab={layoutType === 'ecom' ? 'ecom' : 'lead_gen'}
            />
            {layoutType === 'auto' && (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: 6 }}>
                Auto-detect mode — edit both Lead Gen and Ecom sub-tabs to cover both cases, or set an explicit layout type above.
              </p>
            )}
            {layoutOverride ? (
              <button
                type="button"
                onClick={resetLayoutOverride}
                disabled={saving}
                style={{
                  marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)',
                  border: '1px solid var(--border)', background: 'var(--bg-surface)',
                  borderRadius: 6, padding: '0.25rem 0.625rem',
                  cursor: saving ? 'not-allowed' : 'pointer',
                }}
              >
                Reset to agency default
              </button>
            ) : (
              <p className="text-xs mt-2" style={{ color: 'var(--text-faint)' }}>
                Editing above will save a client-specific override automatically.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Visibility Overrides ────────────────────────────────────── */}
      <div className="card p-5">
        <h3 className="section-title mb-1">Visibility</h3>
        <p className="section-desc mb-3">Show or hide specific dashboard sections for this client.</p>
        <div className="space-y-2">
          {VISIBILITY_DEFS.map(m => {
            const isVisible = !hidden.has(m.id)
            return (
              <SwitchRow
                key={m.id}
                title={m.label}
                description={m.desc}
                checked={isVisible}
                onChange={() => toggleVisibility(m.id)}
                disabled={saving}
              />
            )
          })}
        </div>
      </div>

      {saved && <p className="ui-saved" role="status"><CheckCircle size={14} weight="fill" aria-hidden />Saved</p>}
    </div>
  )
}

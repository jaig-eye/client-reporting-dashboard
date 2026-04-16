'use client'

import { useState } from 'react'
import MetricLayoutEditor from '@/components/admin/MetricLayoutEditor'
import type { MetricLayouts } from '@/lib/metric-layouts'

// Visibility toggles that are not layout-driven
const VISIBILITY_DEFS = [
  { id: 'daily_chart', label: 'Daily Performance Chart', desc: 'Daily spend & conversions trend chart' },
  { id: 'campaigns',   label: 'Campaign Breakdown',      desc: 'Campaign performance table' },
]

export default function ClientMetricVisibility({
  clientId,
  initialHidden,
  initialLayoutType,
  initialLayoutOverride,
}: {
  clientId:             string
  initialHidden:        string[]
  initialLayoutType:    string | null
  initialLayoutOverride: MetricLayouts | null
}) {
  const [hidden,         setHidden]         = useState<Set<string>>(new Set(initialHidden))
  const [layoutType,     setLayoutType]     = useState<string>(initialLayoutType ?? 'auto')
  const [layoutOverride, setLayoutOverride] = useState<MetricLayouts | null>(initialLayoutOverride)
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
    setLayoutOverride(v)
    patch({ metric_layout_override: v })
  }

  async function resetLayoutOverride() {
    setLayoutOverride(null)
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

      {/* ── Layout Type ─────────────────────────────────────────────── */}
      <div className="card p-5">
        <h3 className="section-title mb-1">Layout Type</h3>
        <p className="section-desc mb-3">
          Choose which preset layout drives this client's KPI cards, top metrics, and table columns.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['auto', 'lead_gen', 'ecom'] as const).map(val => (
            <button
              key={val}
              type="button"
              onClick={() => handleLayoutTypeChange(val)}
              disabled={saving}
              style={{
                padding: '0.375rem 0.875rem',
                borderRadius: 8,
                border: '1px solid var(--border)',
                fontSize: '0.8125rem',
                fontWeight: layoutType === val ? 600 : 400,
                background: layoutType === val ? 'var(--blue)' : 'var(--bg-surface)',
                color: layoutType === val ? '#fff' : 'var(--text-secondary)',
                cursor: saving ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {val === 'auto' ? 'Auto-detect' : val === 'lead_gen' ? 'Lead Gen' : 'Ecom'}
            </button>
          ))}
        </div>
        <p className="text-xs mt-2" style={{ color: 'var(--text-faint)' }}>
          Auto-detect picks ecom or lead gen based on how campaigns are tagged.
        </p>
      </div>

      {/* ── Custom Layout Override ──────────────────────────────────── */}
      <div className="card p-5">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <div>
            <h3 className="section-title mb-0">Custom Layout Override</h3>
            <p className="section-desc mt-0.5">Override the agency layout for this client. Leave blank to inherit the agency default.</p>
          </div>
          {layoutOverride && (
            <button
              type="button"
              onClick={resetLayoutOverride}
              disabled={saving}
              style={{
                fontSize: '0.75rem', color: 'var(--text-muted)', border: '1px solid var(--border)',
                background: 'var(--bg-surface)', borderRadius: 6, padding: '0.25rem 0.625rem',
                cursor: saving ? 'not-allowed' : 'pointer', flexShrink: 0,
              }}
            >
              Reset to agency default
            </button>
          )}
        </div>
        <MetricLayoutEditor
          value={layoutOverride}
          onChange={handleLayoutOverrideChange}
        />
        {!layoutOverride && (
          <p className="text-xs mt-2" style={{ color: 'var(--text-faint)' }}>
            Currently using agency default. Editing above will create a client-specific override.
          </p>
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
              <button
                key={m.id}
                onClick={() => toggleVisibility(m.id)}
                disabled={saving}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.625rem',
                  padding: '0.625rem 0.875rem', borderRadius: '0.5rem',
                  border: '1px solid var(--border)',
                  background: isVisible ? 'var(--bg-surface)' : 'var(--bg-subtle)',
                  textAlign: 'left', cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.6 : 1, width: '100%',
                  transition: 'background 0.15s',
                }}
              >
                <div style={{ width: 32, height: 18, borderRadius: 9999, background: isVisible ? 'var(--blue)' : 'var(--border)', position: 'relative', flexShrink: 0, transition: 'background 0.15s' }}>
                  <div style={{ position: 'absolute', top: 2, left: isVisible ? 16 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)', marginBottom: 1 }}>{m.label}</p>
                  <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{m.desc}</p>
                </div>
                <span className="text-xs font-medium" style={{ color: isVisible ? 'var(--green)' : 'var(--text-muted)', flexShrink: 0 }}>
                  {isVisible ? 'Visible' : 'Hidden'}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {saved && <p className="text-xs" style={{ color: 'var(--green)' }}>Saved ✓</p>}
    </div>
  )
}

'use client'

import { useState } from 'react'
import MetricLayoutEditor from '@/components/admin/MetricLayoutEditor'
import SaveStatus, { useSaveStatus, requestJson } from '@/components/ui/SaveStatus'
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
  // One status per sub-card so the confirmation shows where the change was made.
  const layoutStatus   = useSaveStatus()
  const overrideStatus = useSaveStatus()
  const visStatus      = useSaveStatus()

  function patch(body: Record<string, unknown>) {
    return requestJson(`/api/admin/clients/${clientId}`, { method: 'PATCH', json: body })
  }

  function handleLayoutTypeChange(val: string) {
    if (val === layoutType) return
    const prev = layoutType
    void layoutStatus.run(async () => {
      setLayoutType(val)
      try { await patch({ layout_type: val === 'auto' ? null : val }) }
      catch (err) { setLayoutType(prev); throw err }
    })
  }

  function handleLayoutOverrideChange(v: MetricLayouts) {
    const isDefault = agencyLayouts !== null && JSON.stringify(v) === JSON.stringify(agencyLayouts)
    const effective = isDefault ? null : v
    const prev = layoutOverride
    void overrideStatus.run(async () => {
      setLayoutOverride(effective)
      try { await patch({ metric_layout_override: effective }) }
      catch (err) { setLayoutOverride(prev); throw err }
    })
  }

  function resetLayoutOverride() {
    if (!window.confirm("Discard this client's custom layout and go back to the agency default?")) return
    const prev = layoutOverride
    void overrideStatus.run(async () => {
      setLayoutOverride(null)
      try { await patch({ metric_layout_override: null }) }
      catch (err) { setLayoutOverride(prev); throw err }
      setShowCustom(false)
    })
  }

  function toggleVisibility(id: string) {
    const prev = hidden
    const next = new Set(hidden)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    void visStatus.run(async () => {
      setHidden(next)
      try { await patch({ hidden_metrics: Array.from(next) }) }
      catch (err) { setHidden(prev); throw err }
    })
  }

  return (
    <div className="space-y-6">

      {/* ── Layout Type ─────────────────────────────────────────────── */}
      <div className="card p-5">
        <div className="card-head mb-1">
          <h3 className="section-title">Layout Type</h3>
          <SaveStatus state={layoutStatus.state} error={layoutStatus.error} retry={layoutStatus.retry} />
        </div>
        <p className="section-desc mb-3">
          Choose which preset layout drives this client&rsquo;s KPI cards, top metrics, and table columns.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['auto', 'lead_gen', 'ecom'] as const).map(val => (
            <button
              key={val}
              type="button"
              onClick={() => handleLayoutTypeChange(val)}
              disabled={layoutStatus.saving}
              aria-pressed={layoutType === val}
              style={{
                padding: '0.375rem 0.875rem',
                borderRadius: 8,
                border: '1px solid var(--border)',
                fontSize: '0.8125rem',
                fontWeight: layoutType === val ? 600 : 400,
                background: layoutType === val ? 'var(--blue)' : 'var(--bg-surface)',
                color: layoutType === val ? '#fff' : 'var(--text-secondary)',
                cursor: layoutStatus.saving ? 'not-allowed' : 'pointer',
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
        {/* Header row — always visible */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 className="section-title mb-0">Custom Layout Override</h3>
            <p className="section-desc mt-0.5">
              {layoutOverride
                ? 'Client-specific layout active — overrides the agency default.'
                : 'Using agency default layout.'}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <SaveStatus state={overrideStatus.state} error={overrideStatus.error} retry={overrideStatus.retry} />
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
                disabled={overrideStatus.saving}
                className="btn btn-danger"
                style={{ marginTop: '0.75rem', fontSize: '0.75rem', padding: '0.25rem 0.625rem', minHeight: 0 }}
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
        <div className="card-head mb-1">
          <h3 className="section-title">Visibility</h3>
          <SaveStatus state={visStatus.state} error={visStatus.error} retry={visStatus.retry} />
        </div>
        <p className="section-desc mb-3">Show or hide specific dashboard sections for this client.</p>
        <div className="space-y-2">
          {VISIBILITY_DEFS.map(m => {
            const isVisible = !hidden.has(m.id)
            return (
              <button
                key={m.id}
                onClick={() => toggleVisibility(m.id)}
                disabled={visStatus.saving}
                role="switch"
                aria-checked={isVisible}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.625rem',
                  padding: '0.625rem 0.875rem', borderRadius: '0.5rem',
                  border: '1px solid var(--border)',
                  background: isVisible ? 'var(--bg-surface)' : 'var(--bg-subtle)',
                  textAlign: 'left', cursor: visStatus.saving ? 'not-allowed' : 'pointer',
                  opacity: visStatus.saving ? 0.6 : 1, width: '100%',
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
    </div>
  )
}

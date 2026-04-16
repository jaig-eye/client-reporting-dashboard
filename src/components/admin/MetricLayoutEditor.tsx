'use client'

// MetricLayoutEditor — drag-and-drop (via up/down) editor for the two dashboard layouts.
// Used in Admin → Settings → Layouts tab.
//
// Allows configuring, per layout type (Ecom / Lead Gen):
//   - KPI Cards: shown with sparklines (top row)
//   - Top Metrics: shown without sparklines (second row)
//   - Table Columns: campaign table column set and order

import { useState } from 'react'
import {
  ALL_METRIC_KEYS,
  ALL_COLUMN_KEYS,
  DEFAULT_METRIC_LAYOUTS,
  METRIC_LABELS,
  COLUMN_LABELS,
} from '@/lib/metric-layouts'
import type { MetricLayouts, MetricLayout, MetricKey, ColumnKey } from '@/lib/metric-layouts'

interface Props {
  value: MetricLayouts | null | undefined
  onChange: (layouts: MetricLayouts) => void
}

type LayoutTab = 'lead_gen' | 'ecom'

export default function MetricLayoutEditor({ value, onChange }: Props) {
  const [tab, setTab] = useState<LayoutTab>('lead_gen')

  const layouts: MetricLayouts = value ?? DEFAULT_METRIC_LAYOUTS

  function updateLayout(type: LayoutTab, patch: Partial<MetricLayout>) {
    onChange({
      ...layouts,
      [type]: { ...layouts[type], ...patch },
    })
  }

  const current = layouts[tab]

  return (
    <div>
      {/* Layout type tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: '1.25rem', borderBottom: '1px solid var(--border-subtle)' }}>
        {(['lead_gen', 'ecom'] as LayoutTab[]).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              padding: '0.375rem 0.875rem', border: 'none', background: 'transparent',
              fontSize: '0.8125rem', fontWeight: tab === t ? 600 : 400,
              color: tab === t ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: tab === t ? '2px solid var(--blue)' : '2px solid transparent',
              cursor: 'pointer', marginBottom: -1,
            }}
          >
            {t === 'lead_gen' ? 'Lead Gen' : 'Ecom'}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* KPI Cards section */}
        <LayoutSection
          title="KPI Cards"
          description="Shown with sparklines in the top row (typically 3)"
          items={current.kpi_cards}
          allKeys={ALL_METRIC_KEYS}
          labels={METRIC_LABELS as Record<string, string>}
          onChange={items => updateLayout(tab, { kpi_cards: items as MetricKey[] })}
        />

        {/* Top Metrics section */}
        <LayoutSection
          title="Top Metrics"
          description="Shown without sparklines below KPI row (typically 4)"
          items={current.top_metrics}
          allKeys={ALL_METRIC_KEYS}
          labels={METRIC_LABELS as Record<string, string>}
          onChange={items => updateLayout(tab, { top_metrics: items as MetricKey[] })}
        />

        {/* Table Columns section */}
        <LayoutSection
          title="Table Columns"
          description="Campaign table columns in display order"
          items={current.table_columns}
          allKeys={ALL_COLUMN_KEYS}
          labels={COLUMN_LABELS as Record<string, string>}
          onChange={items => updateLayout(tab, { table_columns: items as ColumnKey[] })}
        />
      </div>

      <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: '1rem' }}>
        These layouts apply to all clients. Per-client overrides can be set in the client settings.
      </p>
    </div>
  )
}

// ── Reusable section component ────────────────────────────────────────────────

function LayoutSection({
  title,
  description,
  items,
  allKeys,
  labels,
  onChange,
}: {
  title: string
  description: string
  items: string[]
  allKeys: readonly string[]
  labels: Record<string, string>
  onChange: (items: string[]) => void
}) {
  const available = allKeys.filter(k => !items.includes(k))
  const [addKey, setAddKey] = useState(available[0] ?? '')

  function move(i: number, dir: -1 | 1) {
    const next = [...items]
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i))
  }

  function add() {
    const key = addKey || available[0]
    if (!key || items.includes(key)) return
    onChange([...items, key])
    const remaining = allKeys.filter(k => !items.includes(k) && k !== key)
    setAddKey(remaining[0] ?? '')
  }

  return (
    <div>
      <div style={{ marginBottom: '0.625rem' }}>
        <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{title}</p>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '2px 0 0' }}>{description}</p>
      </div>

      {/* Selected items */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: '0.625rem', minHeight: 36 }}>
        {items.length === 0 && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)', alignSelf: 'center' }}>No items selected</span>
        )}
        {items.map((key, i) => (
          <div
            key={key}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '3px 8px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 500,
              background: 'var(--bg-subtle)', border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
            }}
          >
            <span>{labels[key] ?? key}</span>
            <span style={{ display: 'flex', gap: 1 }}>
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                style={{ padding: '0 2px', border: 'none', background: 'transparent', cursor: i === 0 ? 'default' : 'pointer', color: i === 0 ? 'var(--border)' : 'var(--text-muted)', fontSize: '0.65rem', lineHeight: 1 }}
                title="Move up"
              >▲</button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === items.length - 1}
                style={{ padding: '0 2px', border: 'none', background: 'transparent', cursor: i === items.length - 1 ? 'default' : 'pointer', color: i === items.length - 1 ? 'var(--border)' : 'var(--text-muted)', fontSize: '0.65rem', lineHeight: 1 }}
                title="Move down"
              >▼</button>
              <button
                type="button"
                onClick={() => remove(i)}
                style={{ padding: '0 2px', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.7rem', lineHeight: 1, marginLeft: 1 }}
                title="Remove"
              >✕</button>
            </span>
          </div>
        ))}
      </div>

      {/* Add item */}
      {available.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <select
            value={addKey}
            onChange={e => setAddKey(e.target.value)}
            style={{
              fontSize: '0.8rem', padding: '4px 8px', borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--bg-surface)',
              color: 'var(--text-secondary)', cursor: 'pointer',
            }}
          >
            {available.map(k => (
              <option key={k} value={k}>{labels[k] ?? k}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={add}
            style={{
              fontSize: '0.75rem', fontWeight: 600, padding: '4px 10px',
              borderRadius: 6, border: '1px solid var(--border)',
              background: 'var(--bg-surface)', color: 'var(--blue)',
              cursor: 'pointer',
            }}
          >
            + Add
          </button>
        </div>
      )}
    </div>
  )
}

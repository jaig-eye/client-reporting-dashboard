'use client'

// MetricLayoutEditor — editor for all dashboard metric layouts.
// Used in Admin → Settings → Layouts tab.
//
// Outer tabs: Summary Page | Paid Ads | Search Ads | Shopping | Meta Media
// Inner sub-tabs (Summary + Paid Ads only): Lead Gen | Ecom
// Sections per tab:
//   - KPI Cards, Top Metrics, Table Columns (all tabs)
//   - Platform Cards (Summary tab only — Google Ads card + Meta Ads card)

import { useState } from 'react'
import {
  ALL_METRIC_KEYS,
  DASHBOARD_METRIC_KEYS,
  ALL_COLUMN_KEYS,
  ALL_PLATFORM_CARD_KEYS,
  SEARCH_ADS_METRIC_KEYS,
  SHOPPING_METRIC_KEYS,
  META_MEDIA_METRIC_KEYS,
  DEFAULT_METRIC_LAYOUTS,
  DEFAULT_PAID_ADS_LEAD_GEN,
  DEFAULT_PAID_ADS_ECOM,
  DEFAULT_GOOGLE_SEARCH_LAYOUT,
  DEFAULT_GOOGLE_SHOPPING_LAYOUT,
  DEFAULT_META_MEDIA_LAYOUT,
  METRIC_LABELS,
  PLATFORM_CARD_LABELS,
  COLUMN_LABELS,
} from '@/lib/metric-layouts'
import type {
  MetricLayouts,
  MetricLayout,
  PlatformMetricLayout,
  MetricKey,
  PlatformCardKey,
  ColumnKey,
} from '@/lib/metric-layouts'

interface Props {
  value: MetricLayouts | null | undefined
  onChange: (layouts: MetricLayouts) => void
  defaultInnerTab?: 'lead_gen' | 'ecom'
}

type OuterTab = 'summary' | 'paid_ads' | 'google_search' | 'google_shopping' | 'meta_media'
type InnerTab = 'lead_gen' | 'ecom'

const OUTER_TABS: { id: OuterTab; label: string }[] = [
  { id: 'summary',         label: 'Summary Page' },
  { id: 'paid_ads',        label: 'Paid Ads' },
  { id: 'google_search',   label: 'Search Ads' },
  { id: 'google_shopping', label: 'Shopping' },
  { id: 'meta_media',      label: 'Meta Media' },
]

export default function MetricLayoutEditor({ value, onChange, defaultInnerTab }: Props) {
  const [outerTab, setOuterTab] = useState<OuterTab>('summary')
  const [innerTab, setInnerTab] = useState<InnerTab>(defaultInnerTab ?? 'lead_gen')

  const layouts: MetricLayouts = value ?? DEFAULT_METRIC_LAYOUTS

  // ── Summary / Paid Ads (lead_gen + ecom sub-tabs) ─────────────────────────

  function updateSummaryLayout(type: InnerTab, patch: Partial<MetricLayout>) {
    onChange({ ...layouts, [type]: { ...layouts[type], ...patch } })
  }

  function updatePaidAdsLayout(type: InnerTab, patch: Partial<MetricLayout>) {
    const key = type === 'ecom' ? 'paid_ads_ecom' : 'paid_ads_lead_gen'
    const current = layouts[key] ?? (type === 'ecom' ? DEFAULT_PAID_ADS_ECOM : DEFAULT_PAID_ADS_LEAD_GEN)
    onChange({ ...layouts, [key]: { ...current, ...patch } })
  }

  // ── Platform layouts ──────────────────────────────────────────────────────

  function updatePlatformLayout(
    key: 'google_search' | 'google_shopping' | 'meta_media',
    patch: Partial<PlatformMetricLayout>
  ) {
    const defaults = {
      google_search:   DEFAULT_GOOGLE_SEARCH_LAYOUT,
      google_shopping: DEFAULT_GOOGLE_SHOPPING_LAYOUT,
      meta_media:      DEFAULT_META_MEDIA_LAYOUT,
    }
    const current = layouts[key] ?? defaults[key]
    onChange({ ...layouts, [key]: { ...current, ...patch } })
  }

  // ── Derived state for current tab ────────────────────────────────────────

  const summaryLayout  = layouts[innerTab]
  const paidAdsLayout  = (innerTab === 'ecom' ? layouts.paid_ads_ecom : layouts.paid_ads_lead_gen)
                       ?? (innerTab === 'ecom' ? DEFAULT_PAID_ADS_ECOM : DEFAULT_PAID_ADS_LEAD_GEN)

  const googleSearchLayout   = layouts.google_search   ?? DEFAULT_GOOGLE_SEARCH_LAYOUT
  const googleShoppingLayout = layouts.google_shopping ?? DEFAULT_GOOGLE_SHOPPING_LAYOUT
  const metaMediaLayout      = layouts.meta_media      ?? DEFAULT_META_MEDIA_LAYOUT

  const hasInnerTabs = outerTab === 'summary' || outerTab === 'paid_ads'

  return (
    <div>
      {/* Outer tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: '1.25rem', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
        {OUTER_TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setOuterTab(t.id)}
            style={{
              padding: '0.375rem 0.875rem', border: 'none', background: 'transparent',
              fontSize: '0.8125rem', fontWeight: outerTab === t.id ? 600 : 400,
              color: outerTab === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: outerTab === t.id ? '2px solid var(--blue)' : '2px solid transparent',
              cursor: 'pointer', marginBottom: -1, whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Inner sub-tabs (Summary + Paid Ads only) */}
      {hasInnerTabs && (
        <div style={{ display: 'flex', gap: 4, marginBottom: '1rem' }}>
          {(['lead_gen', 'ecom'] as InnerTab[]).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setInnerTab(t)}
              style={{
                padding: '0.25rem 0.75rem', borderRadius: 6,
                fontSize: '0.75rem', fontWeight: innerTab === t ? 600 : 400,
                border: '1px solid',
                borderColor: innerTab === t ? 'var(--blue)' : 'var(--border)',
                background: innerTab === t ? 'var(--blue-subtle, rgba(59,130,246,0.08))' : 'transparent',
                color: innerTab === t ? 'var(--blue)' : 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              {t === 'lead_gen' ? 'Lead Gen' : 'Ecom'}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {/* ── Summary Page ──────────────────────────────────────────────── */}
        {outerTab === 'summary' && (
          <>
            <LayoutSection
              title="KPI Cards"
              description="Shown with sparklines in the top row (typically 3)"
              items={summaryLayout.kpi_cards}
              allKeys={DASHBOARD_METRIC_KEYS}
              labels={METRIC_LABELS as Record<string, string>}
              onChange={items => updateSummaryLayout(innerTab, { kpi_cards: items as MetricKey[] })}
            />
            <LayoutSection
              title="Top Metrics"
              description="Shown without sparklines below KPI row (typically 4)"
              items={summaryLayout.top_metrics}
              allKeys={DASHBOARD_METRIC_KEYS}
              labels={METRIC_LABELS as Record<string, string>}
              onChange={items => updateSummaryLayout(innerTab, { top_metrics: items as MetricKey[] })}
            />
            <LayoutSection
              title="Table Columns"
              description="Campaign table columns in display order"
              items={summaryLayout.table_columns}
              allKeys={ALL_COLUMN_KEYS}
              labels={COLUMN_LABELS as Record<string, string>}
              onChange={items => updateSummaryLayout(innerTab, { table_columns: items as ColumnKey[] })}
            />
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1.25rem' }}>
              <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px' }}>Platform Summary Cards</p>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 1rem' }}>
                Metrics shown in the compact platform cards on the Summary page (up to 4 each)
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                <LayoutSection
                  title="Google Ads Card"
                  description="Metrics in the Google Ads summary card"
                  items={summaryLayout.platform_google_metrics ?? ['spend', 'conversions', 'ctr']}
                  allKeys={ALL_PLATFORM_CARD_KEYS}
                  labels={PLATFORM_CARD_LABELS as Record<string, string>}
                  onChange={items => updateSummaryLayout(innerTab, { platform_google_metrics: items as PlatformCardKey[] })}
                />
                <LayoutSection
                  title="Meta Ads Card"
                  description="Metrics in the Meta Ads summary card"
                  items={summaryLayout.platform_meta_metrics ?? ['spend', 'impressions', 'ctr']}
                  allKeys={ALL_PLATFORM_CARD_KEYS}
                  labels={PLATFORM_CARD_LABELS as Record<string, string>}
                  onChange={items => updateSummaryLayout(innerTab, { platform_meta_metrics: items as PlatformCardKey[] })}
                />
              </div>
            </div>
          </>
        )}

        {/* ── Paid Ads Page ─────────────────────────────────────────────── */}
        {outerTab === 'paid_ads' && (
          <>
            <LayoutSection
              title="KPI Cards"
              description="Shown at top of campaign/adset pages (typically 4)"
              items={paidAdsLayout.kpi_cards}
              allKeys={DASHBOARD_METRIC_KEYS}
              labels={METRIC_LABELS as Record<string, string>}
              onChange={items => updatePaidAdsLayout(innerTab, { kpi_cards: items as MetricKey[] })}
            />
            <LayoutSection
              title="Top Metrics"
              description="Secondary metrics row (typically 4)"
              items={paidAdsLayout.top_metrics}
              allKeys={DASHBOARD_METRIC_KEYS}
              labels={METRIC_LABELS as Record<string, string>}
              onChange={items => updatePaidAdsLayout(innerTab, { top_metrics: items as MetricKey[] })}
            />
            <LayoutSection
              title="Table Columns"
              description="Campaign/adset table columns in display order"
              items={paidAdsLayout.table_columns}
              allKeys={ALL_COLUMN_KEYS}
              labels={COLUMN_LABELS as Record<string, string>}
              onChange={items => updatePaidAdsLayout(innerTab, { table_columns: items as ColumnKey[] })}
            />
          </>
        )}

        {/* ── Search Ads ────────────────────────────────────────────────── */}
        {outerTab === 'google_search' && (
          <>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
              Applied to Google Search campaign pages. Includes search-specific metrics like Impression Share.
            </p>
            <LayoutSection
              title="KPI Cards"
              description="Top-row metrics for Search campaign pages"
              items={googleSearchLayout.kpi_cards}
              allKeys={SEARCH_ADS_METRIC_KEYS}
              labels={METRIC_LABELS as Record<string, string>}
              onChange={items => updatePlatformLayout('google_search', { kpi_cards: items })}
            />
            <LayoutSection
              title="Top Metrics"
              description="Secondary metrics for Search campaign pages"
              items={googleSearchLayout.top_metrics}
              allKeys={SEARCH_ADS_METRIC_KEYS}
              labels={METRIC_LABELS as Record<string, string>}
              onChange={items => updatePlatformLayout('google_search', { top_metrics: items })}
            />
            <LayoutSection
              title="Table Columns"
              description="Campaign table columns for Search pages"
              items={googleSearchLayout.table_columns}
              allKeys={ALL_COLUMN_KEYS}
              labels={COLUMN_LABELS as Record<string, string>}
              onChange={items => updatePlatformLayout('google_search', { table_columns: items })}
            />
          </>
        )}

        {/* ── Shopping ──────────────────────────────────────────────────── */}
        {outerTab === 'google_shopping' && (
          <>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
              Applied to Google Shopping and Performance Max campaign pages.
            </p>
            <LayoutSection
              title="KPI Cards"
              description="Top-row metrics for Shopping campaign pages"
              items={googleShoppingLayout.kpi_cards}
              allKeys={SHOPPING_METRIC_KEYS}
              labels={METRIC_LABELS as Record<string, string>}
              onChange={items => updatePlatformLayout('google_shopping', { kpi_cards: items })}
            />
            <LayoutSection
              title="Top Metrics"
              description="Secondary metrics for Shopping campaign pages"
              items={googleShoppingLayout.top_metrics}
              allKeys={SHOPPING_METRIC_KEYS}
              labels={METRIC_LABELS as Record<string, string>}
              onChange={items => updatePlatformLayout('google_shopping', { top_metrics: items })}
            />
            <LayoutSection
              title="Table Columns"
              description="Campaign table columns for Shopping pages"
              items={googleShoppingLayout.table_columns}
              allKeys={ALL_COLUMN_KEYS}
              labels={COLUMN_LABELS as Record<string, string>}
              onChange={items => updatePlatformLayout('google_shopping', { table_columns: items })}
            />
          </>
        )}

        {/* ── Meta Media ────────────────────────────────────────────────── */}
        {outerTab === 'meta_media' && (
          <>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
              Applied to Meta Awareness / Reach / Video Views campaign pages. Focuses on media metrics.
            </p>
            <LayoutSection
              title="KPI Cards"
              description="Top-row metrics for Meta media campaign pages"
              items={metaMediaLayout.kpi_cards}
              allKeys={META_MEDIA_METRIC_KEYS}
              labels={METRIC_LABELS as Record<string, string>}
              onChange={items => updatePlatformLayout('meta_media', { kpi_cards: items })}
            />
            <LayoutSection
              title="Top Metrics"
              description="Secondary metrics for Meta media campaign pages"
              items={metaMediaLayout.top_metrics}
              allKeys={META_MEDIA_METRIC_KEYS}
              labels={METRIC_LABELS as Record<string, string>}
              onChange={items => updatePlatformLayout('meta_media', { top_metrics: items })}
            />
            <LayoutSection
              title="Table Columns"
              description="Campaign table columns for Meta media pages"
              items={metaMediaLayout.table_columns}
              allKeys={ALL_COLUMN_KEYS}
              labels={COLUMN_LABELS as Record<string, string>}
              onChange={items => updatePlatformLayout('meta_media', { table_columns: items })}
            />
          </>
        )}
      </div>

      <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: '1rem' }}>
        These layouts apply to all clients. Per-client overrides can be set in the client settings.
      </p>
    </div>
  )
}

// ── Reusable section component ────────────────────────────────────────────────

export function LayoutSection({
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

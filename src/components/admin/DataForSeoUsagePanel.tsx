'use client'

import { useEffect, useState, type CSSProperties } from 'react'

interface UsageSummary {
  from: string
  to: string
  total: number
  total_units: number
  byOperation: { operation: string; cost: number; units: number }[]
  byClient: { client_id: string | null; client_name: string; cost: number; units: number }[]
  daily: { date: string; cost: number }[]
}
interface UsageResponse {
  configured: boolean
  balance: number | null
  budget?: { limit: number | null; spent: number; allowed: boolean; reason?: string }
  currency: string
  summary: UsageSummary
}

const OP_LABELS: Record<string, string> = {
  rank_check:       'Rank checks',
  serp_research:    'Competitor research',
  serp_intel:       'SERP intelligence',
  keyword_overview: 'Keyword data',
  keyword_ideas:    'Keyword ideas',
  search_volume:    'Search volume',
  keyword_discovery:       'Keyword discovery',
  serp_snapshot_on_select: 'Snapshots on picking',
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n === 0) return '$0.00'
  if (Math.abs(n) < 1) return `$${n.toFixed(4)}`
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDay(d: string): string {
  const [, m, day] = d.split('-')
  return `${Number(m)}/${Number(day)}`
}

export default function DataForSeoUsagePanel() {
  const [data, setData] = useState<UsageResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [budgetDraft,  setBudgetDraft]  = useState('')
  const [savingBudget, setSavingBudget] = useState(false)
  const [budgetMsg,    setBudgetMsg]    = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/dataforseo-usage')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) { setData(d); setBudgetDraft(d?.budget?.limit == null ? '' : String(d.budget.limit)); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="card p-5" style={{ color: 'var(--text-faint)', fontSize: '0.85rem' }}>Loading DataForSEO usage…</div>
    )
  }
  if (!data) return null

  async function saveBudget() {
    setSavingBudget(true); setBudgetMsg('')
    try {
      const res = await fetch('/api/admin/dataforseo-usage', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthly_budget: budgetDraft.trim() === '' ? null : budgetDraft.trim() }),
      })
      const d = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
      setBudgetMsg(budgetDraft.trim() === '' ? 'No limit' : 'Saved')
    } catch (e) {
      setBudgetMsg(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSavingBudget(false)
    }
  }

  const s = data.summary
  const maxDay = Math.max(...s.daily.map(d => d.cost), 0.0001)
  const maxOp  = Math.max(...s.byOperation.map(o => o.cost), 0.0001)

  return (
    <div className="card p-5">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)', margin: 0 }}>DataForSEO Usage &amp; Spend</h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)', margin: '2px 0 0' }}>
            Metered from DataForSEO&apos;s per-request cost · {s.from} → {s.to}
          </p>
        </div>
        {!data.configured && (
          <span className="badge badge-gray">Not connected</span>
        )}
      </div>

      {/* ── The ceiling ──────────────────────────────────────────────────────
          On the same card as the spend, because a limit shown anywhere else is a number nobody
          relates to the bill it governs. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '10px 12px', marginBottom: 14, borderRadius: 10,
        background: 'var(--bg-subtle)', border: '1px solid var(--border)',
      }}>
        <label className="text-xs" style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Monthly limit</label>
        <span style={{ color: 'var(--text-faint)', fontSize: '0.8125rem' }}>$</span>
        <input
          className="input"
          value={budgetDraft}
          onChange={e => setBudgetDraft(e.target.value)}
          placeholder="no limit"
          inputMode="decimal"
          style={{ width: 96, fontSize: '0.8125rem', padding: '0.3rem 0.5rem', fontVariantNumeric: 'tabular-nums' }}
        />
        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: '0.8125rem', padding: '0.3rem 0.7rem' }}
          disabled={savingBudget}
          onClick={() => void saveBudget()}
        >
          {savingBudget ? 'Saving…' : 'Save'}
        </button>
        <span className="text-xs" style={{ color: 'var(--text-faint)', flex: 1, minWidth: 220 }}>
          {data.budget?.limit == null
            ? 'No ceiling — paid research runs until you set one.'
            : data.budget.allowed
              ? `$${s.total.toFixed(2)} of $${data.budget.limit.toFixed(2)} used this month.`
              : 'Reached — paid research is paused until next month.'}
        </span>
        {budgetMsg && (
          <span className="text-xs" style={{ color: /could|need|http/i.test(budgetMsg) ? 'var(--red)' : 'var(--green)' }}>
            {budgetMsg}
          </span>
        )}
      </div>

      {/* Stat tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        <Tile label="Account balance" value={fmtMoney(data.balance)} hint="live from DataForSEO" accent={data.balance != null && data.balance < 10 ? 'var(--red)' : undefined} />
        <Tile label="Spent this month" value={fmtMoney(s.total)} />
        <Tile label="Requests" value={s.total_units.toLocaleString()} />
      </div>

      {s.total_units === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)', margin: 0 }}>
          No DataForSEO spend recorded yet this month. Rank checks and competitor research will appear here once the connector is active.
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }} className="dfs-usage-grid">
          {/* By operation */}
          <div>
            <div style={sectionLabel}>By operation</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {s.byOperation.map(o => (
                <div key={o.operation}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: 2 }}>
                    <span style={{ color: 'var(--text-muted)' }}>{OP_LABELS[o.operation] ?? o.operation} <span style={{ color: 'var(--text-faint)' }}>· {o.units.toLocaleString()}</span></span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(o.cost)}</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 3, background: 'var(--bg-muted)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.max(3, (o.cost / maxOp) * 100)}%`, background: '#6366f1', borderRadius: 3 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top clients */}
          <div>
            <div style={sectionLabel}>Top clients</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {s.byClient.map((c, i) => (
                <div key={c.client_id ?? `agency-${i}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                  <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }} title={c.client_name}>{c.client_name}</span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(c.cost)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Daily spend */}
          {s.daily.length > 0 && (
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={sectionLabel}>Daily spend</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 56, overflowX: 'auto' }}>
                {s.daily.map(d => (
                  <div key={d.date} title={`${fmtDay(d.date)} · ${fmtMoney(d.cost)}`}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minWidth: 14 }}>
                    <div style={{ width: 10, height: `${Math.max(2, (d.cost / maxDay) * 44)}px`, background: '#6366f1', borderRadius: 2 }} />
                    <span style={{ fontSize: '0.55rem', color: 'var(--text-faint)' }}>{fmtDay(d.date)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`@media (max-width: 640px) { .dfs-usage-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  )
}

const sectionLabel: CSSProperties = {
  fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
  color: 'var(--text-faint)', marginBottom: 8,
}

function Tile({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: string }) {
  return (
    <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>{label}</div>
      <div style={{ fontSize: '1.15rem', fontWeight: 700, color: accent ?? 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{value}</div>
      {hint && <div style={{ fontSize: '0.6rem', color: 'var(--text-faint)', marginTop: 1 }}>{hint}</div>}
    </div>
  )
}

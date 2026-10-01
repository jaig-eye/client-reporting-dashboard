// Usage — what the agency's paid services cost, in one place: DataForSEO (keyword research and
// rank checks) and AI (writing, topics, images), over one period. The DataForSEO monthly limit is
// set here; research and rank checks stop when it's reached.

import { getAiUsageSummary } from '@/lib/ai/usage'
import { getDfsUsageSummary } from '@/lib/content/dataforseoUsage'
import { getDfsBudget } from '@/lib/content/dfsBudget'
import PageHeader from '@/components/ui/PageHeader'
import Section from '@/components/ui/Section'
import BrandLogo from '@/components/ui/BrandLogo'
import EmptyState from '@/components/ui/EmptyState'
import { RouteTabs } from '@/components/ui/PillTabs'
import { ChartLineUp, Warning } from '@phosphor-icons/react/dist/ssr'
import DfsBudgetEditor from './DfsBudgetEditor'
import DfsBalance from './DfsBalance'
import { USAGE_BODY_SKELETON } from './UsageSkeleton'

export const dynamic = 'force-dynamic'

const PERIODS = [
  { id: 'month',      label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: '30d',        label: 'Last 30 days' },
  { id: '90d',        label: 'Last 90 days' },
] as const
type Period = typeof PERIODS[number]['id']

const iso = (d: Date) => d.toISOString().slice(0, 10)
function rangeFor(p: Period): { from: string; to: string } {
  const now = new Date()
  const y = now.getUTCFullYear(), m = now.getUTCMonth()
  if (p === 'last-month') return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) }
  if (p === '30d') return { from: iso(new Date(now.getTime() - 29 * 86_400_000)), to: iso(now) }
  if (p === '90d') return { from: iso(new Date(now.getTime() - 89 * 86_400_000)), to: iso(now) }
  return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(now) }
}

function money(n: number): string {
  if (n === 0) return '$0'
  if (n < 0.01) return '<$0.01'
  if (n < 100) return `$${n.toFixed(2)}`
  return `$${Math.round(n).toLocaleString('en-US')}`
}
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString('en-US')
}
const fmtDay = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** Plain names for ledger operation keys. */
const OP_LABEL: Record<string, string> = {
  rank_check: 'Rank checks', keyword_discovery: 'Keyword discovery', serp_research: 'Search results research',
  serp_intel: 'Search results for posts', keyword_overview: 'Keyword overviews', keyword_ideas: 'Keyword ideas',
  search_volume: 'Search volumes',
  topics: 'Topic planning', article: 'Writing posts', rewrite: 'Rewrites', full_regenerate: 'Full regenerations',
  brief: 'Briefs', brand_dna: 'Brand DNA', silo: 'Priority topic plans', service_area: 'Service area pages',
  alert: 'Alert messages', image: 'Featured images', other: 'Other',
}
const opLabel = (k: string) => OP_LABEL[k] ?? k.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())

function Bars({ rows, max }: { rows: { label: string; value: number; sub?: string }[]; max: number }) {
  return (
    <div className="us-bars">
      {rows.map(r => (
        <div key={r.label} className="us-bar-row">
          <span className="us-bar-label" title={r.label}>{r.label}</span>
          <span className="us-bar-track" aria-hidden><span style={{ width: `${max > 0 ? Math.max(2, (r.value / max) * 100) : 0}%` }} /></span>
          <span className="us-bar-value">{money(r.value)}{r.sub && <small>{r.sub}</small>}</span>
        </div>
      ))}
    </div>
  )
}

export default async function UsagePage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const sp = await searchParams
  const period: Period = PERIODS.some(p => p.id === sp.period) ? sp.period as Period : 'month'
  const range = rangeFor(period)

  const [dfs, ai, budget] = await Promise.all([
    getDfsUsageSummary(range),
    getAiUsageSummary(range),
    getDfsBudget(),
  ])

  const total = dfs.total + ai.totals.costUsd
  const budgetPct = budget.limit && budget.limit > 0 && isFinite(budget.spent) ? Math.min(100, (budget.spent / budget.limit) * 100) : null
  const budgetTone = budgetPct === null ? '' : budgetPct >= 100 ? ' us-meter--over' : budgetPct >= 80 ? ' us-meter--near' : ''

  // Daily spend, both services, for every day in the period (empty days included).
  const days: { date: string; dfs: number; ai: number }[] = []
  const dfsByDay = new Map(dfs.daily.map(d => [d.date, d.cost]))
  const aiByDay  = new Map(ai.byDay.map(d => [d.date, d.costUsd]))
  for (let t = new Date(range.from + 'T00:00:00Z').getTime(); t <= new Date(range.to + 'T00:00:00Z').getTime(); t += 86_400_000) {
    const date = iso(new Date(t))
    days.push({ date, dfs: dfsByDay.get(date) ?? 0, ai: aiByDay.get(date) ?? 0 })
  }
  const peak = Math.max(0, ...days.map(d => d.dfs + d.ai))

  // Spend per client, both services.
  const perClient = new Map<string, { name: string; dfs: number; ai: number }>()
  for (const c of dfs.byClient) {
    const k = c.client_id ?? 'agency'
    const e = perClient.get(k) ?? { name: c.client_id ? c.client_name : 'Agency-level', dfs: 0, ai: 0 }
    e.dfs += c.cost; perClient.set(k, e)
  }
  for (const c of ai.byClient) {
    const k = c.clientId ?? 'agency'
    const e = perClient.get(k) ?? { name: c.clientName, dfs: 0, ai: 0 }
    e.ai += c.costUsd; perClient.set(k, e)
  }
  const clientRows = Array.from(perClient.values()).map(c => ({ ...c, total: c.dfs + c.ai })).sort((a, b) => b.total - a.total).slice(0, 12)
  const clientMax = Math.max(0, ...clientRows.map(c => c.total))

  const aiOps  = ai.byOperation.map(o => ({ label: opLabel(o.operation), value: o.costUsd, sub: `${compact(o.calls)} calls` }))
  const dfsOps = dfs.byOperation.map(o => ({ label: opLabel(o.operation), value: o.cost, sub: `${compact(o.units)} requests` }))
  const models = ai.byModel.map(m => ({ label: m.model, value: m.costUsd, sub: `${compact(m.inputTokens + m.outputTokens)} tokens` }))

  const body = (
    <>
      {ai.totals.unpricedCalls > 0 && (
        <div className="ui-notice ui-notice--warning" role="status">
          <span><Warning size={14} weight="fill" aria-hidden style={{ verticalAlign: '-2px' }} /> {ai.totals.unpricedCalls.toLocaleString()} AI call{ai.totals.unpricedCalls === 1 ? '' : 's'} used a model without a price on file, so {ai.totals.unpricedCalls === 1 ? 'its' : 'their'} cost isn’t in these totals.</span>
        </div>
      )}

      <section className="card us-stats" aria-label="Totals">
        <div className="us-stat">
          <span className="us-stat-label">Total spend</span>
          <span className="us-stat-value">{money(total)}</span>
          <span className="us-stat-sub">{fmtDay(range.from)} to {fmtDay(range.to)}</span>
        </div>
        <div className="us-stat">
          <span className="us-stat-label"><BrandLogo type="dataforseo" size={14} />DataForSEO</span>
          <span className="us-stat-value">{money(dfs.total)}</span>
          <span className="us-stat-sub">{compact(dfs.total_units)} requests</span>
        </div>
        <div className="us-stat">
          <span className="us-stat-label"><ChartLineUp size={14} aria-hidden />AI</span>
          <span className="us-stat-value">{money(ai.totals.costUsd)}</span>
          <span className="us-stat-sub">{compact(ai.totals.calls)} calls, {compact(ai.totals.inputTokens + ai.totals.outputTokens)} tokens</span>
        </div>
        <div className="us-stat">
          <span className="us-stat-label">DataForSEO balance</span>
          <span className="us-stat-value"><DfsBalance /></span>
          <span className="us-stat-sub">Left on the account now</span>
        </div>
      </section>

      <div className="ui-grid-side" style={{ marginBottom: 16 }}>
        <Section title="Daily spend" description={peak > 0 ? `Highest day: ${money(peak)}.` : 'Nothing spent in this period.'}>
          {peak > 0 ? (
            <>
              <div className="us-chart" role="img" aria-label={`Daily spend from ${fmtDay(range.from)} to ${fmtDay(range.to)}`}>
                {days.map(d => (
                  <span key={d.date} className="us-col" title={`${fmtDay(d.date)}: DataForSEO ${money(d.dfs)}, AI ${money(d.ai)}`}>
                    <span className="us-col-ai"  style={{ height: `${(d.ai / peak) * 100}%` }} />
                    <span className="us-col-dfs" style={{ height: `${(d.dfs / peak) * 100}%` }} />
                  </span>
                ))}
              </div>
              <div className="us-chart-axis"><span>{fmtDay(range.from)}</span><span>{fmtDay(range.to)}</span></div>
              <div className="us-legend"><span><i className="us-key-dfs" />DataForSEO</span><span><i className="us-key-ai" />AI</span></div>
            </>
          ) : <EmptyState icon={<ChartLineUp size={20} />} title="No spend yet">Spend shows here as research, rank checks and AI writing run.</EmptyState>}
        </Section>

        <Section title="DataForSEO monthly limit" description="Research and rank checks stop for the rest of the month once this is spent.">
          {budget.limit !== null && budgetPct !== null ? (
            <div className={`us-meter${budgetTone}`}>
              <div className="us-meter-head">
                <strong>{money(budget.spent)}</strong>
                <span>of {money(budget.limit)} this month</span>
              </div>
              <div className="us-meter-track" role="meter" aria-valuemin={0} aria-valuemax={budget.limit} aria-valuenow={budget.spent} aria-label="DataForSEO spend this month">
                <span style={{ width: `${budgetPct}%` }} />
              </div>
              <p className="us-meter-note">{budget.allowed ? `${money(Math.max(0, budget.limit - budget.spent))} left` : (budget.reason ?? 'Paused until next month.')}</p>
            </div>
          ) : (
            <p className="ui-row-sub" style={{ margin: '0 0 12px' }}>{budget.limit === null ? 'No limit is set, so research and rank checks can spend without stopping.' : 'This month’s spend couldn’t be read.'}</p>
          )}
          <DfsBudgetEditor initial={budget.limit} />
        </Section>
      </div>

      <div className="ui-grid-2">
        <Section title="By client" description="Both services, biggest spend first.">
          {clientRows.length ? (
            <div className="us-bars">
              {clientRows.map(c => (
                <div key={c.name} className="us-bar-row">
                  <span className="us-bar-label" title={c.name}>{c.name}</span>
                  <span className="us-bar-track us-bar-track--split" aria-hidden>
                    <span className="us-seg-dfs" style={{ width: `${clientMax > 0 ? (c.dfs / clientMax) * 100 : 0}%` }} />
                    <span className="us-seg-ai" style={{ width: `${clientMax > 0 ? (c.ai / clientMax) * 100 : 0}%` }} />
                  </span>
                  <span className="us-bar-value">{money(c.total)}<small>{money(c.dfs)} DataForSEO, {money(c.ai)} AI</small></span>
                </div>
              ))}
            </div>
          ) : <p className="ui-row-sub">Nothing to show for this period.</p>}
        </Section>

        <Section title="AI by task" description="What the AI was doing.">
          {aiOps.length ? <Bars rows={aiOps} max={Math.max(...aiOps.map(r => r.value))} /> : <p className="ui-row-sub">No AI calls in this period.</p>}
        </Section>

        <Section title="DataForSEO by request" description="Which kinds of request the spend went on.">
          {dfsOps.length ? <Bars rows={dfsOps} max={Math.max(...dfsOps.map(r => r.value))} /> : <p className="ui-row-sub">No DataForSEO requests in this period.</p>}
        </Section>

        <Section title="AI by model" description="Estimated from each model's published price per token.">
          {models.length ? <Bars rows={models} max={Math.max(...models.map(r => r.value))} /> : <p className="ui-row-sub">No AI calls in this period.</p>}
        </Section>
      </div>
    </>
  )

  return (
    <div>
      <PageHeader
        title="Usage"
        description="What keyword research, rank checks and AI writing cost, and how much of the DataForSEO limit is left."
      />
      <RouteTabs
        label="Period"
        activeId={period}
        items={PERIODS.map(p => ({ id: p.id, label: p.label, href: `/admin/usage?period=${p.id}` }))}
        pending={Object.fromEntries(PERIODS.map(p => [p.id, USAGE_BODY_SKELETON]))}
      >
        {body}
      </RouteTabs>
    </div>
  )
}

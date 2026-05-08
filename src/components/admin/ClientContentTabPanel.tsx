'use client'

import { useState, useEffect }                        from 'react'
import { useRouter, usePathname, useSearchParams }    from 'next/navigation'
import ClientContentSettingsForm                      from './ClientContentSettingsForm'
import ClientSitemapTab                               from './ClientSitemapTab'
import ClientScheduleTab                              from './ClientScheduleTab'
import type { SiteOption }                            from '@/lib/content/types'

// ─── Shared types ────────────────────────────────────────────────────────────

type ContentSettings = Record<string, unknown> | null

export interface GscRow {
  page:              string | null
  query:             string | null
  impressions:       number | null
  clicks:            number | null
  ctr:               number | null
  position:          number | null
  recentlyTargeted?: boolean
}

export interface GscData {
  quickWins:   GscRow[]
  growth:      GscRow[]
  lowCtr:      GscRow[]
  highVolume:  GscRow[]
}

interface Props {
  clientId:        string
  clientName:      string
  isEcom:          boolean
  sites:           SiteOption[]
  contentSettings: ContentSettings
  aiConfigured:    boolean
  overviewStats: {
    upcomingTopicsCount: number
    nextPublishDate:     string | null
    recentPostsCount:    number
  }
  gscData:        GscData
  postsPerRun?:   number
  initialSubTab?: string
}

type SubTab = 'overview' | 'brand-dna' | 'sitemap' | 'priority' | 'gsc' | 'schedule'

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'overview',  label: 'Overview'          },
  { id: 'brand-dna', label: 'Brand DNA'         },
  { id: 'sitemap',   label: 'Sitemap'           },
  { id: 'priority',  label: 'Priority Pages'    },
  { id: 'gsc',       label: 'GSC Insights'      },
  { id: 'schedule',  label: 'Content Schedule'  },
]

// ─── Main component ───────────────────────────────────────────────────────────

export default function ClientContentTabPanel({
  clientId, clientName, isEcom, sites, contentSettings, aiConfigured, overviewStats, gscData, initialSubTab,
}: Props) {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()

  const validSubTab = (s: string | undefined | null): SubTab =>
    SUB_TABS.some(t => t.id === s) ? (s as SubTab) : 'overview'

  const [activeTab, setActiveTab] = useState<SubTab>(validSubTab(initialSubTab))

  function handleTabChange(id: SubTab) {
    setActiveTab(id)
    const params = new URLSearchParams(searchParams.toString())
    params.set('subtab', id)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '0.375rem 0.875rem',
    fontSize: '0.8125rem',
    fontWeight: active ? 600 : 400,
    color: active ? 'var(--text-primary)' : 'var(--text-muted)',
    borderBottom: active ? '2px solid var(--accent, var(--blue))' : '2px solid transparent',
    textDecoration: 'none',
    background: 'none',
    border: 'none',
    borderBottomStyle: 'solid',
    borderBottomWidth: 2,
    borderBottomColor: active ? 'var(--accent, var(--blue))' : 'transparent',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    marginBottom: -1,
  })

  return (
    <div>
      {/* Sub-tab nav */}
      <div className="no-scrollbar" style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border)', marginBottom: '1.5rem', overflowX: 'auto' }}>
        {SUB_TABS.map(tab => (
          <button key={tab.id} style={tabStyle(activeTab === tab.id)} onClick={() => handleTabChange(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview'  && <OverviewTab clientId={clientId} settings={contentSettings} stats={overviewStats} />}
      {activeTab === 'brand-dna' && <ClientContentSettingsForm clientId={clientId} sites={sites} />}
      {activeTab === 'sitemap'   && <ClientSitemapTab clientId={clientId} />}
      {activeTab === 'priority'  && <PriorityTab clientId={clientId} />}
      {activeTab === 'gsc'       && <GscTab data={gscData} isEcom={isEcom} clientId={clientId} />}
      {activeTab === 'schedule'  && (
        <ClientScheduleTab
          clientId={clientId}
          clientName={clientName}
          sites={sites}
          aiConfigured={aiConfigured}
        />
      )}
    </div>
  )
}

// ─── Overview sub-tab ─────────────────────────────────────────────────────────

const FREQ_LABELS: Record<string, string> = {
  daily:         'Daily',
  weekly:        'Weekly',
  biweekly:      'Every 2 weeks',
  monthly:       'Monthly (28-day)',
  monthly_first: 'Monthly — 1st',
  monthly_mid:   'Monthly — 15th',
  monthly_end:   'Monthly — 28th',
}
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

function OverviewTab({ clientId, settings, stats }: {
  clientId: string
  settings: ContentSettings
  stats:    Props['overviewStats']
}) {
  const [generating, setGenerating] = useState(false)
  const [genMsg,     setGenMsg]     = useState('')

  const s = settings as Record<string, unknown> | null

  async function generateTopics() {
    setGenerating(true)
    setGenMsg('')
    try {
      const res = await fetch('/api/admin/content/topics/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, count: s?.topics_per_run ?? 5 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error((data as { error?: string }).error || 'Failed to generate topics')
      setGenMsg(`Generated ${(data as { topics?: unknown[] }).topics?.length ?? 0} topics successfully.`)
    } catch (err) {
      setGenMsg(err instanceof Error ? err.message : 'Failed')
    } finally {
      setGenerating(false)
    }
  }

  const freq     = s?.schedule_frequency as string | null | undefined
  const dayNum   = s?.schedule_day_of_week as number | null | undefined
  const freqLabel = freq ? (FREQ_LABELS[freq] ?? freq) : 'Not configured'
  const dayLabel  = dayNum != null ? DAY_NAMES[dayNum] ?? String(dayNum) : null

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        <StatCard label="Upcoming Topics" value={String(stats.upcomingTopicsCount)} />
        <StatCard label="Posts This Month"  value={String(stats.recentPostsCount)} />
        <StatCard
          label="Next Publish"
          value={stats.nextPublishDate
            ? new Date(stats.nextPublishDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : '—'}
        />
      </div>

      <div className="card p-5 mb-4">
        <h3 style={{ margin: '0 0 12px', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Schedule
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px' }}>
          <InfoRow label="Frequency"     value={freqLabel} />
          {dayLabel && <InfoRow label="Day"        value={dayLabel} />}
          {!!s?.publish_time   && <InfoRow label="Publish Time" value={String(s.publish_time)} />}
          <InfoRow label="Posts / Run"   value={String(s?.posts_per_run ?? 1)} />
          <InfoRow label="Topics / Run"  value={String(s?.topics_per_run ?? 5)} />
          <InfoRow label="Weeks Ahead"   value={String(s?.weeks_ahead ?? 1)} />
          <InfoRow label="Auto-generate" value={s?.auto_generate ? 'On' : 'Off'} />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={generateTopics}
          disabled={generating}
          className="btn btn-primary"
          style={{ fontSize: '0.8125rem' }}
        >
          {generating ? 'Generating…' : '✦ Generate Topics Now'}
        </button>
        {genMsg && (
          <span style={{ fontSize: '0.8125rem', color: genMsg.includes('success') ? 'var(--green)' : 'var(--red)' }}>
            {genMsg}
          </span>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
        {value}
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
        {label}
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', fontSize: '0.8125rem' }}>
      <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{label}:</span>
      <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{value}</span>
    </div>
  )
}

// ─── Priority Pages sub-tab ───────────────────────────────────────────────────

type PriorityPage = { url: string; title: string | null }

function PriorityTab({ clientId }: { clientId: string }) {
  const [pages,   setPages]   = useState<PriorityPage[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    fetch(`/api/admin/content/sitemap-pages?client_id=${clientId}`)
      .then(r => r.json())
      .then((data: { url: string; title: string | null; isPriority: boolean }[]) => {
        setPages(data.filter(p => p.isPriority))
        setLoading(false)
      })
      .catch(() => { setError('Failed to load pages'); setLoading(false) })
  }, [clientId])

  if (loading) return <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Loading…</p>
  if (error)   return <p style={{ fontSize: '0.8125rem', color: 'var(--red)' }}>{error}</p>

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Priority Pages
        </h3>
        <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          These pages are preferred when generating internal links — not always included, but chosen first when contextually relevant.
          Star pages in the Sitemap tab to add them here.
        </p>
      </div>

      {pages.length === 0 ? (
        <div className="card p-6" style={{ textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            No priority pages yet. Open the Sitemap tab and star pages to prioritize them.
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>URL</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', width: 220 }}>Title</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((page, i) => (
                <tr key={page.url} style={{ borderBottom: i < pages.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <td style={{ padding: '7px 10px', maxWidth: 0 }}>
                    <a href={page.url} target="_blank" rel="noopener noreferrer"
                      style={{ color: 'var(--blue)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                      {page.url}
                    </a>
                  </td>
                  <td style={{ padding: '7px 10px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
                    {page.title ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── GSC sub-tab ─────────────────────────────────────────────────────────────

function fmtImpr(n: number | null | undefined): string {
  if (!n) return '—'
  if (n >= 10000) return `${Math.round(n / 1000)}k`
  if (n >= 1000)  return `${(n / 1000).toFixed(1)}k`
  return n.toLocaleString()
}
function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—'
  return `${(n * 100).toFixed(1)}%`
}
function fmtPos(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toFixed(1)
}
function posColor(pos: number | null): string {
  if (!pos) return 'var(--text-muted)'
  if (pos <= 3)  return '#16a34a'
  if (pos <= 10) return '#d97706'
  return '#9ca3af'
}
function posBg(pos: number | null): string {
  if (!pos) return 'var(--bg-muted)'
  if (pos <= 3)  return '#dcfce7'
  if (pos <= 10) return '#fef3c7'
  return 'var(--bg-muted)'
}
function truncatePage(url: string, max = 44): string {
  try {
    const u    = new URL(url)
    const path = u.pathname
    return path.length > max ? '…' + path.slice(-(max - 1)) : path
  } catch {
    return url.length > max ? url.slice(0, max) + '…' : url
  }
}

function GscSection({
  badge, badgeColor, badgeBg, rows, search,
}: {
  badge: string; badgeColor: string; badgeBg: string
  rows:  GscRow[]; search: string
}) {
  const filtered = rows.filter(r => {
    if (!search) return true
    const q = search.toLowerCase()
    return (r.query ?? '').toLowerCase().includes(q) || (r.page ?? '').toLowerCase().includes(q)
  })
  if (filtered.length === 0) return null

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ marginBottom: 8 }}>
        <span style={{
          display: 'inline-block', padding: '2px 10px', borderRadius: 999,
          fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
          background: badgeBg, color: badgeColor, marginBottom: 4,
        }}>
          {badge}
        </span>
        <span style={{ marginLeft: 8, fontSize: '0.75rem', color: 'var(--text-faint)' }}>
          {filtered.length} keyword{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {(['Query','Page','Impr','Clicks','CTR','Position'] as const).map(h => (
                <th key={h} style={{
                  padding: '5px 8px', textAlign: h === 'Query' || h === 'Page' ? 'left' : 'right',
                  fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-faint)',
                  textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={i} style={{ borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <td style={{ padding: '6px 8px', color: 'var(--text-primary)', fontWeight: 500, maxWidth: 200 }}>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.query ?? ''}>
                    {r.query || '—'}
                  </span>
                  {r.recentlyTargeted && (
                    <span style={{ fontSize: '0.6rem', color: 'var(--text-faint)', background: 'var(--bg-muted)', padding: '1px 4px', borderRadius: 3 }}>↩ used</span>
                  )}
                </td>
                <td style={{ padding: '6px 8px', color: 'var(--blue)', maxWidth: 180 }}>
                  {r.page ? (
                    <a href={r.page} target="_blank" rel="noopener noreferrer"
                      title={r.page}
                      style={{ color: 'var(--blue)', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {truncatePage(r.page)}
                    </a>
                  ) : '—'}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>{fmtImpr(r.impressions)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>{r.clicks ?? '—'}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>{fmtPct(r.ctr)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                  <span style={{
                    display: 'inline-block', padding: '1px 6px', borderRadius: 4,
                    fontWeight: 600, fontSize: '0.75rem',
                    background: posBg(r.position), color: posColor(r.position),
                  }}>
                    {fmtPos(r.position)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function GscTab({ data, isEcom: _isEcom, clientId }: { data: GscData; isEcom: boolean; clientId: string }) {
  const router           = useRouter()
  const [search, setSearch]       = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const isEmpty = data.quickWins.length === 0 && data.growth.length === 0
    && data.lowCtr.length === 0 && data.highVolume.length === 0

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await fetch('/api/admin/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, days: 3 }),
      })
      router.refresh()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>GSC Insights</h3>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            28-day data. Keywords ranked below position 20 are the strongest candidates for new articles.
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.8125rem', padding: '0.375rem 0.75rem' }}
            onClick={handleRefresh}
            disabled={refreshing}
            title="Sync latest GSC data and reload"
          >
            {refreshing ? 'Syncing…' : '↻ Refresh'}
          </button>
          {!isEmpty && (
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter keywords or pages…"
              className="input"
              style={{ maxWidth: 260, fontSize: '0.8125rem', padding: '0.375rem 0.625rem' }}
            />
          )}
        </div>
      </div>

      {isEmpty ? (
        <div className="card p-6" style={{ textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            No GSC data yet. Connect Google Search Console and run a sync.
          </p>
        </div>
      ) : (
        <div className="card p-5">
          <GscSection badge="Growth Opportunities" badgeColor="#92400e" badgeBg="#fef3c7" rows={data.growth}     search={search} />
          <GscSection badge="Quick Wins"           badgeColor="#166534" badgeBg="#dcfce7" rows={data.quickWins}  search={search} />
          <GscSection badge="Low CTR"              badgeColor="#1e3a8a" badgeBg="#dbeafe" rows={data.lowCtr}     search={search} />
          <GscSection badge="High Volume Low Rank" badgeColor="#6b21a8" badgeBg="#f3e8ff" rows={data.highVolume} search={search} />
        </div>
      )}
    </div>
  )
}

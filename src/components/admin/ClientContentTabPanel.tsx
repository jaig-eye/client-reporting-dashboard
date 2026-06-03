'use client'

import { useState, useEffect }                        from 'react'
import { useRouter, usePathname }                      from 'next/navigation'
import ClientContentSettingsForm                      from './ClientContentSettingsForm'
import ClientSitemapTab                               from './ClientSitemapTab'
import ClientScheduleTab                              from './ClientScheduleTab'
import ClientContentSetupWizard                       from './ClientContentSetupWizard'
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
    upcomingTopicsCount:  number
    nextPublishDate:      string | null
    recentPostsCount:     number
    pendingTopicsCount:   number
    approvedTopicsCount:  number
    forReviewPostsCount:  number
    publishedPostsCount:  number
    // Service area page counts
    saPendingTopicsCount:  number
    saApprovedTopicsCount: number
    saForReviewPostsCount: number
    saPublishedPostsCount: number
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
  { id: 'schedule',  label: 'Schedule'           },
]

// ─── Main component ───────────────────────────────────────────────────────────

export default function ClientContentTabPanel({
  clientId, clientName, isEcom, sites, contentSettings, aiConfigured, overviewStats, gscData, initialSubTab,
}: Props) {
  const router       = useRouter()
  const pathname     = usePathname()

  const validSubTab = (s: string | undefined | null): SubTab =>
    SUB_TABS.some(t => t.id === s) ? (s as SubTab) : 'overview'

  const initial = validSubTab(initialSubTab)

  const [activeTab,    setActiveTab]    = useState<SubTab>(initial)
  // Track which tabs have ever been visited so we can lazy-mount once and keep alive
  const [visited,      setVisited]      = useState<Set<SubTab>>(() => new Set([initial]))
  const [showWizard,   setShowWizard]   = useState(() => {
    const s = contentSettings as Record<string, unknown> | null
    const alreadySetUp = s?.wizard_completed || s?.business_background || s?.services
    const alreadyHasContent = overviewStats.recentPostsCount > 0 || overviewStats.upcomingTopicsCount > 0
    return !alreadySetUp && !alreadyHasContent
  })

  function handleTabChange(id: SubTab) {
    setActiveTab(id)
    setVisited(prev => new Set([...Array.from(prev), id]))
    // Write subtab to URL so refreshes/back-button preserve the active tab
    const params = new URLSearchParams(window.location.search)
    params.set('subtab', id)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '0.375rem 0.875rem',
    fontSize: '0.8125rem',
    fontWeight: active ? 600 : 400,
    color: active ? 'var(--text-primary)' : 'var(--text-muted)',
    textDecoration: 'none',
    background: 'none',
    border: 'none',
    borderBottom: `2px solid ${active ? 'var(--accent, var(--blue))' : 'transparent'}`,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    marginBottom: -1,
  })

  return (
    <div>
      {/* Setup wizard overlay */}
      {showWizard && (
        <ClientContentSetupWizard
          clientId={clientId}
          clientName={clientName}
          onComplete={() => { setShowWizard(false); router.refresh() }}
        />
      )}

      {/* Sub-tab nav */}
      <div className="no-scrollbar" style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border)', marginBottom: '1.5rem', overflowX: 'auto', alignItems: 'flex-end' }}>
        {SUB_TABS.map(tab => (
          <button key={tab.id} style={tabStyle(activeTab === tab.id)} onClick={() => handleTabChange(tab.id)}>
            {tab.label}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', paddingBottom: 6, flexShrink: 0 }}>
          <button
            className="btn btn-secondary btn-sm"
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem', whiteSpace: 'nowrap' }}
            onClick={() => setShowWizard(true)}
            title="Re-open the content setup wizard"
          >
            ⚡ Setup Wizard
          </button>
        </div>
      </div>

      {/* Overview is lightweight — always conditional (no keep-alive needed) */}
      {activeTab === 'overview' && <OverviewTab clientId={clientId} settings={contentSettings} stats={overviewStats} onNavigate={handleTabChange} />}

      {/* Heavy tabs: lazy-mount on first visit, then keep alive with CSS to avoid re-fetch on every switch */}
      {visited.has('brand-dna') && (
        <div style={{ display: activeTab === 'brand-dna' ? 'block' : 'none' }}>
          <ClientContentSettingsForm clientId={clientId} sites={sites} />
        </div>
      )}
      {visited.has('sitemap') && (
        <div style={{ display: activeTab === 'sitemap' ? 'block' : 'none' }}>
          <ClientSitemapTab clientId={clientId} />
        </div>
      )}
      {visited.has('priority') && (
        <div style={{ display: activeTab === 'priority' ? 'block' : 'none' }}>
          <PriorityTab clientId={clientId} />
        </div>
      )}
      {visited.has('gsc') && (
        <div style={{ display: activeTab === 'gsc' ? 'block' : 'none' }}>
          <GscTab data={gscData} isEcom={isEcom} clientId={clientId} />
        </div>
      )}
      {/* Schedule: keep-alive + pass isActive so its modals close when hidden
          (position:fixed modals escape display:none containment — must be explicitly closed) */}
      {visited.has('schedule') && (
        <div style={{ display: activeTab === 'schedule' ? 'block' : 'none' }}>
          <ClientScheduleTab
            clientId={clientId}
            clientName={clientName}
            sites={sites}
            aiConfigured={aiConfigured}
            isActive={activeTab === 'schedule'}
          />
        </div>
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

function PipelineRow({ items, label }: {
  items: { label: string; count: number; color: string; borderColor: string }[]
  label?: string
}) {
  return (
    <div>
      {label && <p style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>{label}</p>}
      <div className="card" style={{ display: 'flex', alignItems: 'stretch', overflow: 'hidden', padding: 0 }}>
        {items.flatMap((stage, i) => {
          const box = (
            <div key={stage.label} style={{ flex: 1, textAlign: 'center', padding: '12px 8px', borderBottom: `3px solid ${stage.borderColor}`, minWidth: 0 }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: stage.color, lineHeight: 1, marginBottom: 3 }}>{stage.count}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500 }}>{stage.label}</div>
            </div>
          )
          if (i < items.length - 1) {
            return [box, <div key={`sep-${i}`} style={{ display: 'flex', alignItems: 'center', padding: '0 4px', color: 'var(--text-faint)', fontSize: '0.875rem', flexShrink: 0 }}>→</div>]
          }
          return [box]
        })}
      </div>
    </div>
  )
}

function OverviewTab({ clientId: _clientId, settings, stats, onNavigate }: {
  clientId:   string
  settings:   ContentSettings
  stats:      Props['overviewStats']
  onNavigate: (tab: SubTab) => void
}) {
  const s = settings as Record<string, unknown> | null

  const freq      = s?.schedule_frequency as string | null | undefined
  const dayNum    = s?.schedule_day_of_week as number | null | undefined
  const freqLabel = freq ? (FREQ_LABELS[freq] ?? freq) : 'Not configured'
  const dayLabel  = dayNum != null ? DAY_NAMES[dayNum] ?? String(dayNum) : null

  const pipeline: { label: string; count: number; color: string; borderColor: string }[] = [
    { label: 'Pending',     count: stats.pendingTopicsCount,  color: '#f59e0b', borderColor: '#f59e0b' },
    { label: 'Approved',    count: stats.approvedTopicsCount, color: '#2563eb', borderColor: '#2563eb' },
    { label: 'For Review',  count: stats.forReviewPostsCount, color: '#059669', borderColor: '#059669' },
    { label: 'Published',   count: stats.publishedPostsCount, color: '#059669', borderColor: '#059669' },
  ]

  const saPipeline: { label: string; count: number; color: string; borderColor: string }[] = [
    { label: 'Pending',    count: stats.saPendingTopicsCount,  color: '#f59e0b', borderColor: '#f59e0b' },
    { label: 'Approved',   count: stats.saApprovedTopicsCount, color: '#2563eb', borderColor: '#2563eb' },
    { label: 'For Review', count: stats.saForReviewPostsCount, color: '#059669', borderColor: '#059669' },
    { label: 'Published',  count: stats.saPublishedPostsCount, color: '#059669', borderColor: '#059669' },
  ]

  const aiModel    = s?.ai_model    as string | null | undefined
  const aiProvider = s?.ai_provider as string | null | undefined

  return (
    <div style={{ maxWidth: 680 }}>
      {/* Blog Posts pipeline */}
      <div style={{ marginBottom: 12 }}>
        <PipelineRow items={pipeline} label="Blog Posts" />
      </div>

      {/* Service Area Pages pipeline */}
      <div style={{ marginBottom: 16 }}>
        <PipelineRow items={saPipeline} label="Service Area Pages" />
      </div>

      {/* AI info row */}
      {(aiModel || aiProvider || s?.auto_generate != null) && (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {(aiProvider || aiModel) && (
            <span>Model: <span style={{ color: 'var(--text-muted)' }}>{[aiProvider, aiModel].filter(Boolean).join(' / ')}</span></span>
          )}
          {s?.publish_time != null && (
            <span>Publish time: <span style={{ color: 'var(--text-muted)' }}>{String(s.publish_time)}</span></span>
          )}
          <span>Auto-generate: <span style={{ color: s?.auto_generate ? 'var(--green)' : 'var(--text-muted)' }}>{s?.auto_generate ? 'On' : 'Off'}</span></span>
        </div>
      )}

      {/* Next publish + schedule summary */}
      <div className="card p-4" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 32, height: 32, borderRadius: 6, background: 'var(--bg-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            {stats.nextPublishDate
              ? `Next publish: ${new Date(stats.nextPublishDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
              : 'No upcoming publish date'}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
            {freqLabel}{dayLabel ? ` · ${dayLabel}s` : ''}
            {s?.posts_per_run != null ? ` · ${s.posts_per_run} post${Number(s.posts_per_run) !== 1 ? 's' : ''}/run` : ''}
          </div>
        </div>
        <button
          className="btn btn-secondary btn-sm"
          style={{ fontSize: '0.8rem', whiteSpace: 'nowrap', flexShrink: 0 }}
          onClick={() => onNavigate('schedule')}
        >
          Open Schedule →
        </button>
      </div>
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

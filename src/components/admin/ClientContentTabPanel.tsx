'use client'

import { useState, useEffect }                        from 'react'
import { useRouter, usePathname }                      from 'next/navigation'
import { SlidersHorizontal, TreeStructure, ChartLineUp, CalendarBlank } from '@phosphor-icons/react'
import ClientContentSettings                          from './ClientContentSettings'
import ClientPipeline                                 from './ClientPipeline'
import ClientSitemapTab                               from './ClientSitemapTab'
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
  initialSubTab?: string
}

type SubTab = 'pipeline' | 'analytics' | 'sitemap' | 'settings'

interface TabDef { id: SubTab; label: string; icon: React.ReactNode; badge?: number }

// ─── Main component ───────────────────────────────────────────────────────────

export default function ClientContentTabPanel({
  clientId, clientName, isEcom, sites, contentSettings, aiConfigured, overviewStats, gscData, initialSubTab,
}: Props) {
  const router       = useRouter()
  const pathname     = usePathname()

  const VALID_TABS: SubTab[] = ['pipeline', 'analytics', 'sitemap', 'settings']
  // Backward-compat aliases so old deep links keep working (?subtab=overview|schedule|
  // brand-dna|gsc). 'gsc' was renamed to 'analytics'.
  const validSubTab = (s: string | undefined | null): SubTab => {
    if (s === 'overview' || s === 'schedule') return 'pipeline'
    if (s === 'brand-dna') return 'settings'
    if (s === 'gsc') return 'analytics'
    return VALID_TABS.includes(s as SubTab) ? (s as SubTab) : 'pipeline'
  }

  const initial = validSubTab(initialSubTab)

  const [activeTab,    setActiveTab]    = useState<SubTab>(initial)
  const [visited,      setVisited]      = useState<Set<SubTab>>(() => new Set([initial]))
  const [animatingTab, setAnimatingTab] = useState<SubTab | null>(initial)
  const [showWizard, setShowWizard] = useState(() => {
    const s = contentSettings as Record<string, unknown> | null
    const alreadySetUp = s?.wizard_completed || s?.business_background || s?.services
    const alreadyHasContent = overviewStats.recentPostsCount > 0 || overviewStats.upcomingTopicsCount > 0
    return !alreadySetUp && !alreadyHasContent
  })

  useEffect(() => {
    setAnimatingTab(activeTab)
    const t = setTimeout(() => setAnimatingTab(null), 220)
    return () => clearTimeout(t)
  }, [activeTab])

  function handleTabChange(id: SubTab) {
    setActiveTab(id)
    setVisited(prev => new Set([...Array.from(prev), id]))
    const params = new URLSearchParams(window.location.search)
    params.set('subtab', id)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const reviewBadge = overviewStats.forReviewPostsCount + overviewStats.saForReviewPostsCount

  const TABS: TabDef[] = [
    { id: 'pipeline',  label: 'Pipeline',  icon: <CalendarBlank size={22} weight="duotone" />, badge: reviewBadge || undefined },
    { id: 'analytics', label: 'Analytics', icon: <ChartLineUp size={22} weight="duotone" /> },
    { id: 'sitemap',   label: 'Sitemap',   icon: <TreeStructure size={22} weight="duotone" /> },
    { id: 'settings',  label: 'Settings',  icon: <SlidersHorizontal size={22} weight="duotone" /> },
  ]

  return (
    <div>
      <style>{`
        @keyframes ccTabFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .cc-tab-content { animation: ccTabFadeIn 0.18s ease; }
        .cc-nav-card { transition: box-shadow 0.15s, transform 0.15s, background 0.15s; cursor: pointer; }
        .cc-nav-card:hover:not(.cc-nav-card--active) { transform: translateY(-2px); box-shadow: 0 4px 14px rgba(0,0,0,0.08); }
        @media (prefers-reduced-motion: reduce) {
          .cc-tab-content { animation: none; }
          .cc-nav-card { transition: none; }
        }
      `}</style>

      {/* Setup wizard overlay */}
      {showWizard && (
        <ClientContentSetupWizard
          clientId={clientId}
          clientName={clientName}
          onComplete={() => { setShowWizard(false); router.refresh() }}
        />
      )}

      {/* Card nav */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: '1.5rem' }}>
        {TABS.map(tab => {
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              className={`cc-nav-card${active ? ' cc-nav-card--active' : ''}`}
              onClick={() => handleTabChange(tab.id)}
              style={{
                position: 'relative',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 8, padding: '16px 8px',
                borderRadius: 12,
                border: active ? 'none' : '1px solid var(--border)',
                background: active ? 'var(--accent, #2563eb)' : 'var(--bg-surface)',
                color: active ? '#fff' : 'var(--text-muted)',
                fontWeight: active ? 600 : 500,
                fontSize: '0.75rem',
                cursor: 'pointer',
                boxShadow: active ? '0 4px 18px rgba(37,99,235,0.25)' : '0 1px 3px rgba(0,0,0,0.04)',
                userSelect: 'none',
              }}
            >
              {/* Badge */}
              {tab.badge && (
                <span style={{
                  position: 'absolute', top: 8, right: 10,
                  background: '#ef4444', color: '#fff',
                  fontSize: '0.6rem', fontWeight: 700,
                  borderRadius: 99, padding: '1px 5px',
                  minWidth: 16, textAlign: 'center',
                  lineHeight: '14px',
                  boxShadow: '0 0 0 2px var(--bg-surface)',
                }}>
                  {tab.badge > 99 ? '99+' : tab.badge}
                </span>
              )}
              <span style={{ opacity: active ? 1 : 0.7 }}>{tab.icon}</span>
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Setup Wizard link */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem', marginTop: '-0.75rem' }}>
        <button
          className="btn btn-ghost btn-sm"
          style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}
          onClick={() => setShowWizard(true)}
        >
          ⚡ Setup Wizard
        </button>
      </div>

      {/* Tab content — each active tab fades in without unmounting keep-alive tabs */}
      <div>
        {visited.has('pipeline') && (
          <div style={{ display: activeTab === 'pipeline' ? 'block' : 'none' }} className={animatingTab === 'pipeline' ? 'cc-tab-content' : ''}>
            <ClientPipeline
              clientId={clientId}
              clientName={clientName}
              sites={sites}
              aiConfigured={aiConfigured}
              isActive={activeTab === 'pipeline'}
              contentSettings={contentSettings}
            />
          </div>
        )}
        {visited.has('settings') && (
          <div style={{ display: activeTab === 'settings' ? 'block' : 'none' }} className={animatingTab === 'settings' ? 'cc-tab-content' : ''}>
            <ClientContentSettings clientId={clientId} clientName={clientName} sites={sites} aiConfigured={aiConfigured} />
          </div>
        )}
        {visited.has('sitemap') && (
          <div style={{ display: activeTab === 'sitemap' ? 'block' : 'none' }} className={animatingTab === 'sitemap' ? 'cc-tab-content' : ''}>
            <ClientSitemapTab clientId={clientId} />
          </div>
        )}
        {visited.has('analytics') && (
          <div style={{ display: activeTab === 'analytics' ? 'block' : 'none' }} className={animatingTab === 'analytics' ? 'cc-tab-content' : ''}>
            <AnalyticsTab data={gscData} isEcom={isEcom} clientId={clientId} isActive={activeTab === 'analytics'} />
          </div>
        )}
      </div>
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

// Keyword rank row from the DataForSEO datastream (/api/admin/content/keyword-rankings).
interface KeywordRankRow {
  keyword_id:         string
  keyword:            string
  current_position:   number | null
  previous_position:  number | null
  position_delta:     number | null
  current_url:        string | null
  search_volume:      number | null
  keyword_difficulty: number | null
  intent:             string | null
  content_post_id:    string | null
  movement?:          string
}

function AnalyticsTab({ data, isEcom: _isEcom, clientId, isActive }: { data: GscData; isEcom: boolean; clientId: string; isActive: boolean }) {
  const router           = useRouter()
  const [search, setSearch]       = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [ranks, setRanks]           = useState<KeywordRankRow[] | null>(null)

  const isEmpty = data.quickWins.length === 0 && data.growth.length === 0
    && data.lowCtr.length === 0 && data.highVolume.length === 0

  // Lazy-load DataForSEO keyword ranks the first time this tab is opened.
  useEffect(() => {
    if (!isActive || ranks !== null) return
    let cancelled = false
    fetch(`/api/admin/content/keyword-rankings?client_id=${clientId}`)
      .then(r => r.ok ? r.json() : { rankings: [] })
      .then(d => { if (!cancelled) setRanks((d.rankings ?? []) as KeywordRankRow[]) })
      .catch(() => { if (!cancelled) setRanks([]) })
    return () => { cancelled = true }
  }, [isActive, ranks, clientId])

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

  const filteredRanks = (ranks ?? []).filter(r =>
    !search || r.keyword.toLowerCase().includes(search.toLowerCase()))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>Analytics</h3>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            Search Console demand signals and DataForSEO keyword rank tracking. Keywords ranked below position 20 are the strongest candidates for new articles.
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
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter keywords or pages…"
            className="input"
            style={{ maxWidth: 260, fontSize: '0.8125rem', padding: '0.375rem 0.625rem' }}
          />
        </div>
      </div>

      {/* ── Keyword Rankings (DataForSEO) ──────────────────────────────────── */}
      <div className="card p-5" style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 10 }}>
          <span style={{
            display: 'inline-block', padding: '2px 10px', borderRadius: 999,
            fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
            background: '#eef2ff', color: '#4338ca',
          }}>
            Keyword Rankings
          </span>
          <span style={{ marginLeft: 8, fontSize: '0.72rem', color: 'var(--text-faint)' }}>DataForSEO</span>
        </div>
        <KeywordRankTable ranks={filteredRanks} loading={ranks === null} />
      </div>

      {/* ── Search Console insights ────────────────────────────────────────── */}
      {isEmpty ? (
        <div className="card p-6" style={{ textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            No Search Console data yet. Connect Google Search Console and run a sync.
          </p>
        </div>
      ) : (
        <div className="card p-5">
          <div style={{ marginBottom: 12, fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Search Console Insights</div>
          <GscSection badge="Growth Opportunities" badgeColor="#92400e" badgeBg="#fef3c7" rows={data.growth}     search={search} />
          <GscSection badge="Quick Wins"           badgeColor="#166534" badgeBg="#dcfce7" rows={data.quickWins}  search={search} />
          <GscSection badge="Low CTR"              badgeColor="#1e3a8a" badgeBg="#dbeafe" rows={data.lowCtr}     search={search} />
          <GscSection badge="High Volume Low Rank" badgeColor="#6b21a8" badgeBg="#f3e8ff" rows={data.highVolume} search={search} />
        </div>
      )}
    </div>
  )
}

function KeywordRankTable({ ranks, loading }: { ranks: KeywordRankRow[]; loading: boolean }) {
  if (loading) {
    return <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-faint)' }}>Loading rankings…</p>
  }
  if (ranks.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
        No keyword rankings yet. Connect <strong>DataForSEO</strong> on the Integrations page and attach this client&apos;s
        domain to start tracking. Keywords targeted by generated posts are registered automatically.
      </p>
    )
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            {(['Keyword','Position','Change','Volume','Difficulty'] as const).map(h => (
              <th key={h} style={{
                padding: '5px 8px', textAlign: h === 'Keyword' ? 'left' : 'right',
                fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-faint)',
                textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ranks.map((r, i) => (
            <tr key={r.keyword_id} style={{ borderBottom: i < ranks.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <td style={{ padding: '6px 8px', color: 'var(--text-primary)', fontWeight: 500, maxWidth: 260 }}>
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.keyword}>
                  {r.keyword}
                </span>
              </td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                <span style={{
                  display: 'inline-block', padding: '1px 6px', borderRadius: 4,
                  fontWeight: 600, fontSize: '0.75rem',
                  background: posBg(r.current_position), color: posColor(r.current_position),
                }}>
                  {r.current_position ?? '—'}
                </span>
              </td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                {r.movement === 'dropped'
                  ? <span style={{ color: 'var(--red)', fontWeight: 600, fontSize: '0.75rem' }} title={r.previous_position != null ? `was #${r.previous_position}` : undefined}>dropped</span>
                  : r.movement === 'entered'
                  ? <span style={{ color: '#16a34a', fontWeight: 600, fontSize: '0.75rem' }}>new</span>
                  : <RankDelta delta={r.position_delta} />}
              </td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>{fmtImpr(r.search_volume)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>
                {r.keyword_difficulty == null ? '—' : Math.round(r.keyword_difficulty)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Rank movement pill. Positive delta = improved (moved toward #1) → green ▲.
function RankDelta({ delta }: { delta: number | null }) {
  if (delta == null || delta === 0) return <span style={{ color: 'var(--text-faint)' }}>—</span>
  const improved = delta > 0
  return (
    <span style={{ color: improved ? '#16a34a' : '#dc2626', fontWeight: 600, fontSize: '0.75rem' }}>
      {improved ? '▲' : '▼'} {Math.abs(delta)}
    </span>
  )
}

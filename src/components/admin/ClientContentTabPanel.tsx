'use client'

import { useState, useEffect }                        from 'react'
import KeywordsTab from '@/components/admin/KeywordsTab'
import { useRouter, usePathname }                      from 'next/navigation'
import { SlidersHorizontal, TreeStructure, CalendarBlank, MagnifyingGlass } from '@phosphor-icons/react'
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

type SubTab = 'pipeline' | 'keywords' | 'sitemap' | 'settings'

interface TabDef { id: SubTab; label: string; icon: React.ReactNode; badge?: number }

// ─── Main component ───────────────────────────────────────────────────────────

export default function ClientContentTabPanel({
  clientId, clientName, isEcom, sites, contentSettings, aiConfigured, overviewStats, gscData, initialSubTab,
}: Props) {
  const router       = useRouter()
  const pathname     = usePathname()

  const VALID_TABS: SubTab[] = ['pipeline', 'keywords', 'sitemap', 'settings']
  // Backward-compat aliases so old deep links keep working (?subtab=overview|schedule|
  // brand-dna|gsc). 'gsc' was renamed to 'analytics'.
  const validSubTab = (s: string | undefined | null): SubTab => {
    if (s === 'overview' || s === 'schedule') return 'pipeline'
    if (s === 'brand-dna') return 'settings'
    // Analytics folded into Keywords; its old deep links land on the merged tab.
    if (s === 'gsc' || s === 'analytics') return 'keywords'
    return VALID_TABS.includes(s as SubTab) ? (s as SubTab) : 'pipeline'
  }

  const initial = validSubTab(initialSubTab)

  const [activeTab,    setActiveTab]    = useState<SubTab>(initial)
  const [visited,      setVisited]      = useState<Set<SubTab>>(() => new Set([initial]))
  const [animatingTab, setAnimatingTab] = useState<SubTab | null>(initial)
  // Bumped when the setup wizard closes or research is re-run from Settings, so the Analytics
  // tab drops its cached keyword data and refetches. Research run elsewhere used to stay
  // invisible there until a hard reload, which read as "research did nothing".
  const [researchEpoch, setResearchEpoch] = useState(0)
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
    { id: 'keywords',  label: 'Keywords',  icon: <MagnifyingGlass size={22} weight="duotone" /> },
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
          onComplete={() => { setShowWizard(false); setResearchEpoch(e => e + 1); router.refresh() }}
        />
      )}

      {/* Card nav */}
      <div className="cc-nav" style={{ '--cc-nav-count': TABS.length } as React.CSSProperties}>
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
                gap: 8, padding: '14px 6px', whiteSpace: 'nowrap',
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
        {visited.has('keywords') && (
          <div style={{ display: activeTab === 'keywords' ? 'block' : 'none' }} className={animatingTab === 'keywords' ? 'cc-tab-content' : ''}>
            <KeywordsTab clientId={clientId} isActive={activeTab === 'keywords'} epoch={researchEpoch} sites={sites} gscData={gscData} isEcom={isEcom} onResearchRun={() => setResearchEpoch(e => e + 1)} />
          </div>
        )}
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect }                        from 'react'
import KeywordsTab from '@/components/admin/KeywordsTab'
import { useRouter, usePathname }                      from 'next/navigation'
import { SlidersHorizontal, TreeStructure, CalendarBlank, MagnifyingGlass, Lightning } from '@phosphor-icons/react'
import { PillTabs }                                   from '@/components/ui/PillTabs'
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
  /** Unused since the Keywords tab stopped reading it; the client page still passes it. */
  isEcom?:         boolean
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
  clientId, clientName, sites, contentSettings, aiConfigured, overviewStats, gscData, initialSubTab,
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
  // Bumped when the setup wizard closes or research runs on the Keywords tab, so the Keywords tab
  // drops its cached keyword data and refetches. Research run elsewhere used to stay invisible
  // there until a hard reload, which read as "research did nothing".
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
    // The URL records the sub-tab (for reloads and links) without asking the server for the page
    // again: router.replace re-ran every query on the client page — two dozen — on each switch.
    const params = new URLSearchParams(window.location.search)
    params.set('subtab', id)
    window.history.replaceState(window.history.state, '', `${pathname}?${params.toString()}`)
  }

  const reviewBadge = overviewStats.forReviewPostsCount + overviewStats.saForReviewPostsCount

  // The Pipeline's plan-card test, as near as these counts allow: any topic or post that wasn't
  // turned down means the plan is under way, and the wizard's last step stops offering to start it.
  // recentPostsCount is left out on purpose — it counts every post generated this month, rejected
  // ones included, so a client whose posts were all discarded read as having a plan running.
  const planActive = overviewStats.upcomingTopicsCount
    + overviewStats.pendingTopicsCount + overviewStats.approvedTopicsCount
    + overviewStats.forReviewPostsCount + overviewStats.publishedPostsCount > 0
  // Which Settings section to show when another tab sends someone there. A counter as well as the
  // section, so asking twice for the same section still moves to it.
  const [settingsRequest, setSettingsRequest] = useState<{ section: 'schedule'; n: number } | null>(null)
  function openSettingsSchedule() {
    setSettingsRequest(r => ({ section: 'schedule', n: (r?.n ?? 0) + 1 }))
    handleTabChange('settings')
  }

  const TABS: TabDef[] = [
    { id: 'pipeline',  label: 'Pipeline',  icon: <CalendarBlank size={15} />, badge: reviewBadge || undefined },
    { id: 'keywords',  label: 'Keywords',  icon: <MagnifyingGlass size={15} /> },
    { id: 'sitemap',   label: 'Sitemap',   icon: <TreeStructure size={15} /> },
    { id: 'settings',  label: 'Settings',  icon: <SlidersHorizontal size={15} /> },
  ]

  return (
    <div>
      <style>{`
        @keyframes ccTabFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .cc-tab-content { animation: ccTabFadeIn 0.18s ease; }
        @media (prefers-reduced-motion: reduce) {
          .cc-tab-content { animation: none; }
        }
      `}</style>

      {/* Setup wizard overlay */}
      {showWizard && (
        <ClientContentSetupWizard
          clientId={clientId}
          clientName={clientName}
          planActive={planActive}
          onComplete={() => { setShowWizard(false); setResearchEpoch(e => e + 1); router.refresh() }}
        />
      )}

      <div className="cc-subnav">
        <PillTabs
          label="Content sections"
          activeId={activeTab}
          onSelect={id => handleTabChange(id as SubTab)}
          items={TABS.map(t => ({ id: t.id, label: t.label, icon: t.icon, count: t.badge ?? null, alert: t.id === 'pipeline' }))}
          idPrefix="cc"
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowWizard(true)}>
          <Lightning size={14} aria-hidden />Setup wizard
        </button>
      </div>

      {/* Tab content — each active tab fades in without unmounting keep-alive tabs */}
      <div>
        {visited.has('pipeline') && (
          <div id="cc-panel-pipeline" role="tabpanel" aria-labelledby="cc-tab-pipeline" style={{ display: activeTab === 'pipeline' ? 'block' : 'none' }} className={animatingTab === 'pipeline' ? 'cc-tab-content' : ''}>
            <ClientPipeline
              clientId={clientId}
              clientName={clientName}
              sites={sites}
              aiConfigured={aiConfigured}
              isActive={activeTab === 'pipeline'}
              contentSettings={contentSettings}
              onOpenSettings={openSettingsSchedule}
            />
          </div>
        )}
        {visited.has('settings') && (
          <div id="cc-panel-settings" role="tabpanel" aria-labelledby="cc-tab-settings" style={{ display: activeTab === 'settings' ? 'block' : 'none' }} className={animatingTab === 'settings' ? 'cc-tab-content' : ''}>
            <ClientContentSettings clientId={clientId} clientName={clientName} sites={sites} sectionRequest={settingsRequest} />
          </div>
        )}
        {visited.has('sitemap') && (
          <div id="cc-panel-sitemap" role="tabpanel" aria-labelledby="cc-tab-sitemap" style={{ display: activeTab === 'sitemap' ? 'block' : 'none' }} className={animatingTab === 'sitemap' ? 'cc-tab-content' : ''}>
            <ClientSitemapTab clientId={clientId} />
          </div>
        )}
        {visited.has('keywords') && (
          <div id="cc-panel-keywords" role="tabpanel" aria-labelledby="cc-tab-keywords" style={{ display: activeTab === 'keywords' ? 'block' : 'none' }} className={animatingTab === 'keywords' ? 'cc-tab-content' : ''}>
            <KeywordsTab clientId={clientId} isActive={activeTab === 'keywords'} epoch={researchEpoch} sites={sites} gscData={gscData} onResearchRun={() => setResearchEpoch(e => e + 1)} />
          </div>
        )}
      </div>
    </div>
  )
}

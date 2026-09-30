'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import MarketLine from './MarketLine'
import { SERVICES_HELP, RESEARCH_FIELDS_NOTE } from '@/lib/content/researchCopy'
import KeywordChipInput, { splitPhrases } from '@/components/admin/KeywordChipInput'
import KeywordResearchPanel, { type ResearchKeyword } from '@/components/admin/KeywordResearchPanel'

// ─── Types ────────────────────────────────────────────────────────────────────

interface BrandDna {
  business_background: string
  services: string
  target_audience: string
  geographic_focus: string
  brand_voice: string
  founded_year: string
  years_in_business: string
  phone_number: string
  owner_details: string
  licenses: string
  guarantees: string
  review_count: string
  emergency_availability: boolean
}

interface SitemapPage {
  url: string
  title: string | null
  isPriority: boolean
  isExcluded: boolean
}

interface Schedule {
  frequency: string
  dayOfWeek: number
  publishTime: string
  autoGenerate: boolean
}

interface KeywordResult {
  keyword:    string
  volume:     number | null
  /** Google Ads volume in the research location, when the run was local. */
  local_volume?: number | null
  difficulty: number | null
  intent:     string | null
  source?:    string | null
  /** How research ranked it, when the run recorded a score. */
  score?:     number | null
  /** Whether a person has picked this one for the writer. Absent on an unmigrated database. */
  chosen?:    boolean
}

interface ResearchData {
  keywords:     KeywordResult[]
  competitors:  string[]
  /** False when the client has no DataForSEO connection — the pool is then database-only. */
  connected:    boolean
  /** From a POST: false means nothing new was stored, and `reason` says why. */
  ok?:          boolean
  reason?:      string
  /** New keywords this run added to the pool. */
  discovered?:  number
  cost?:        number
  researchedAt?: string | null
  /** Where the pool was measured, when a research location is set. */
  researchLocation?: string | null
  /** Best-rated businesses in the map pack for the starting keywords; only on a fresh local run. */
  localPack?: Array<{ title: string; domain: string | null; rating: number | null; votes: number | null }>
  /** Set here, not by the server: this came from a run in this wizard rather than a stored read. */
  fromRun?: boolean
}

/** The result of a research run or read, and how it should read: good news, a caution, a failure. */
interface ResearchOutcome { tone: 'success' | 'warning' | 'error'; text: string }

interface Props {
  clientId:   string
  clientName: string
  onComplete: () => void
}

const TOTAL_STEPS = 9

/** Most starting keywords research is given. The chip input stops at the same number. */
const SEED_MAX = 25

const FREQ_OPTIONS = [
  { id: 'daily',    label: 'Daily',       sub: '1 post/day' },
  { id: 'weekly',   label: 'Weekly',      sub: '1 post/week' },
  { id: 'biweekly', label: 'Bi-Weekly',   sub: 'Every 2 weeks' },
  { id: 'monthly',  label: 'Monthly',     sub: 'Once a month' },
]

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

// ─── Wizard ───────────────────────────────────────────────────────────────────

export default function ClientContentSetupWizard({ clientId, clientName, onComplete }: Props) {
  const [step, setStep] = useState(1)

  // Step 1 state
  const [hasGsc, setHasGsc] = useState<boolean | null>(null)
  /** Whether DataForSEO is connected — the research step is the only one that needs it. */
  const [hasDfs, setHasDfs] = useState(false)
  const [wpUrl,  setWpUrl]  = useState('')

  // Step 2 state
  const [analyzeUrl,    setAnalyzeUrl]    = useState('')
  const [analyzing,     setAnalyzing]     = useState(false)
  const [analyzeMsg,    setAnalyzeMsg]    = useState('')
  const [brand,         setBrand]         = useState<BrandDna>({
    business_background: '', services: '', target_audience: '',
    geographic_focus: '', brand_voice: '', founded_year: '', years_in_business: '',
    phone_number: '', owner_details: '', licenses: '',
    guarantees: '', review_count: '', emergency_availability: false,
  })
  const [brandLoaded, setBrandLoaded] = useState(false)

  // Step 3 state — same brand object (e-e-a-t fields are in brand)

  // Step 4 state
  const [sitemapUrl,    setSitemapUrl]    = useState('')
  const [fetchingPages, setFetchingPages] = useState(false)
  const [sitemapMsg,    setSitemapMsg]    = useState('')
  const [pages,         setPages]         = useState<SitemapPage[]>([])

  // Step 5 state
  const [schedule, setSchedule] = useState<Schedule>({
    frequency: 'weekly', dayOfWeek: 1, publishTime: '09:00',
    autoGenerate: true,
  })
  // The client's already-saved schedule_start_date, if any. Completing the wizard must
  // NOT move it: for a rolling-monthly client that date IS the publish-day anchor, so
  // overwriting it with today silently shifts every future publish date.
  const [existingStartDate, setExistingStartDate] = useState<string | null>(null)
  const [imageGen,    setImageGen]    = useState(false)
  const [imagePrompt, setImagePrompt] = useState('')

  // Detected connection (B1/B2 — set during loadInit for connection_id save)
  const [detectedConnectionId, setDetectedConnectionId] = useState<string | null>(null)

  // Step 2: WP connect form state
  const [wpConnectSiteUrl,  setWpConnectSiteUrl]  = useState('')
  const [wpConnectUsername, setWpConnectUsername] = useState('')
  const [wpConnectAppPwd,   setWpConnectAppPwd]   = useState('')
  const [wpConnecting,      setWpConnecting]      = useState(false)
  const [wpConnectMsg,      setWpConnectMsg]      = useState('')
  const [wpJustConnected,   setWpJustConnected]   = useState(false)

  // Step 6 state — additional content types
  const [enableServicePages,    setEnableServicePages]    = useState(false)
  const [spGuidelinesWiz,       setSpGuidelinesWiz]       = useState('')
  const [enableRegularPages,    setEnableRegularPages]    = useState(false)
  const [rpGuidelinesWiz,       setRpGuidelinesWiz]       = useState('')

  // Step 7 state
  const [research,       setResearch]       = useState<ResearchData | null>(null)
  /**
   * Terms the operator knows the business should be found for, before any data exists.
   *
   * Seeds for research and nothing more: they widen what DataForSEO is asked about, then the
   * results are ranked on volume, difficulty and proven paid conversions like everything else.
   * A term typed here does not become a commissioned article — that is what makes it safe to
   * guess in this box.
   */
  const [foundationalKeywords, setFoundationalKeywords] = useState('')
  /**
   * The eeat_data column exactly as loaded.
   *
   * The wizard edits 8 of its 16 keys, but the save writes the whole JSONB column. Without the
   * original underneath, re-running the wizard deleted insurance, awards, team_experience,
   * brands_used, financing_options, warranties, case_studies, before_after_proof and
   * common_objections — all of which the settings tab maintains and the writer prompt reads.
   */
  const [loadedEeat, setLoadedEeat] = useState<Record<string, unknown>>({})
  /** 'loading' reads the stored pool (free); 'researching' is a paid run in flight. */
  const [researchPhase,   setResearchPhase]   = useState<'idle' | 'loading' | 'researching'>('idle')
  /** What the last run or read came to, said where the button is. */
  const [researchOutcome, setResearchOutcome] = useState<ResearchOutcome | null>(null)
  /** Ticks on the research step that have not been saved. Leaving the step drops them. */
  const [picksDirty,     setPicksDirty]     = useState(false)
  /** Set by a first Continue or Back over unsaved picks; the second press leaves. */
  const [leaveWarned,    setLeaveWarned]    = useState(false)

  // Saving state
  const [saving, setSaving]   = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  // ── Load initial data on mount ─────────────────────────────────────────────
  useEffect(() => {
    async function loadInit() {
      // Pages already imported for this client are shown, not hidden behind "Fetch Pages". The
      // step used to start empty on every visit, so a client whose sitemap had been imported
      // last week looked like it had never been — and fetching again was the only way to see the
      // ticks that were already saved.
      try {
        const res = await fetch(`/api/admin/content/sitemap-pages?client_id=${clientId}`)
        if (res.ok) {
          const list = await res.json() as Array<{ url: string; title: string | null; isPriority: boolean; isExcluded: boolean }>
          if (Array.isArray(list) && list.length > 0) {
            setPages(list.map(p => ({ url: p.url, title: p.title ?? null, isPriority: !!p.isPriority, isExcluded: !!p.isExcluded })))
            setSitemapMsg(`${list.length} page${list.length === 1 ? '' : 's'} already imported. Fetch again to pick up new ones.`)
          }
        }
      } catch { /* the step still works from scratch */ }

      // Multi-source URL detection: WP → BC → GSC priority order (B1)
      let connectionDetectedUrl = ''
      try {
        const res = await fetch(`/api/admin/clients/${clientId}/connections`)
        if (res.ok) {
          const conns = await res.json() as Array<{ id: string; type: string; site_url?: string | null }>
          let detectedId: string | null = null

          for (const conn of conns) {
            const cleanUrl = (conn.site_url ?? '').replace(/^sc-domain:/, 'https://')
            if (!cleanUrl) continue

            if (conn.type === 'wordpress') {
              connectionDetectedUrl = cleanUrl
              detectedId  = conn.id
              break // highest priority
            }
            if ((conn.type === 'bigcommerce' || conn.type === 'google_search_console') && !connectionDetectedUrl) {
              connectionDetectedUrl = cleanUrl
              detectedId  = conn.id
            }
          }

          if (connectionDetectedUrl) {
            setAnalyzeUrl(connectionDetectedUrl)
            setSitemapUrl(connectionDetectedUrl.replace(/\/$/, '') + '/sitemap_index.xml')
            setWpUrl(connectionDetectedUrl)
            setDetectedConnectionId(detectedId)
          }
          setHasGsc(conns.some(c => c.type === 'google_search_console'))
          setHasDfs(conns.some(c => c.type === 'dataforseo'))
        } else {
          setHasGsc(false)
        }
      } catch { setHasGsc(false) }

      // Pre-populate Step 6 from existing client settings (re-run support).
      // Also use saved sitemap_url as fallback when no connection URL was detected.
      try {
        const res = await fetch(`/api/admin/content/client-settings?client_id=${clientId}`)
        if (res.ok) {
          const cs = await res.json() as {
            generate_service_pages?: boolean
            generate_regular_pages?: boolean
            service_page_topic_guidelines?: string | null
            regular_page_topic_guidelines?: string | null
            sitemap_url?: string | null
            schedule_frequency?: string | null
            schedule_day_of_week?: number | null
            publish_time?: string | null
            auto_generate?: boolean | null
            schedule_start_date?: string | null
            business_background?: string | null
            services?: string | null
            target_audience?: string | null
            geographic_focus?: string | null
            brand_voice?: string | null
            phone_number?: string | null
            eeat_data?: Record<string, unknown> | null
            weeks_ahead?: number | null
            foundational_keywords?: string[] | null
            research_location?: unknown
            content_image_generation?: boolean | null
            content_image_prompt?: string | null
          }
          if (cs.generate_service_pages) setEnableServicePages(true)
          if (cs.generate_regular_pages) setEnableRegularPages(true)
          // Read back, because the save below always writes them. Unhydrated, reaching the
          // research step silently switched AI featured images off and blanked the prompt for
          // any client who had set them on the settings tab.
          if (typeof cs.content_image_generation === 'boolean') setImageGen(cs.content_image_generation)
          if (cs.content_image_prompt) setImagePrompt(cs.content_image_prompt)
          // Re-runs must show what was entered before, or the save at the end writes an empty
          // array over seeds someone chose.
          if (Array.isArray(cs.foundational_keywords) && cs.foundational_keywords.length > 0) {
            setFoundationalKeywords(cs.foundational_keywords.join(', '))
          }

          // Hydrate BRAND DNA. Without this the fields render empty on a re-run and the save at
          // the end writes those empties over a profile someone already curated. Every value is
          // kept only when the saved one is non-empty, so a half-filled record can still be
          // completed by the AI analysis rather than being blocked by it.
          const eeat = (cs.eeat_data ?? {}) as Record<string, unknown>
          // Held so the save can merge onto it instead of replacing the column.
          setLoadedEeat(eeat)
          const str  = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
          const savedBrand = {
            business_background: str(cs.business_background),
            services:            str(cs.services),
            target_audience:     str(cs.target_audience),
            geographic_focus:    str(cs.geographic_focus),
            brand_voice:         str(cs.brand_voice),
            phone_number:        str(cs.phone_number),
            founded_year:        str(eeat.founded_year),
            years_in_business:   str(eeat.years_in_business),
            owner_details:       str(eeat.owner_details),
            licenses:            str(eeat.licenses),
            guarantees:          str(eeat.guarantees),
            review_count:        str(eeat.review_count),
          }
          const hasSavedBrand = Object.values(savedBrand).some(v => v !== null)
          if (hasSavedBrand) {
            setBrand(prev => ({
              ...prev,
              business_background: savedBrand.business_background ?? prev.business_background,
              services:            savedBrand.services            ?? prev.services,
              target_audience:     savedBrand.target_audience     ?? prev.target_audience,
              geographic_focus:    savedBrand.geographic_focus    ?? prev.geographic_focus,
              brand_voice:         savedBrand.brand_voice         ?? prev.brand_voice,
              phone_number:        savedBrand.phone_number        ?? prev.phone_number,
              founded_year:        savedBrand.founded_year        ?? prev.founded_year,
              years_in_business:   savedBrand.years_in_business   ?? prev.years_in_business,
              owner_details:       savedBrand.owner_details       ?? prev.owner_details,
              licenses:            savedBrand.licenses            ?? prev.licenses,
              guarantees:          savedBrand.guarantees          ?? prev.guarantees,
              review_count:        savedBrand.review_count        ?? prev.review_count,
              emergency_availability: typeof eeat.emergency_availability === 'boolean'
                ? eeat.emergency_availability
                : prev.emergency_availability,
            }))
            // The profile exists, so the wizard should not insist on a fresh scan before
            // letting someone move on.
            setBrandLoaded(true)
          }

          // Hydrate the SCHEDULE too. Step 5's state was initialised to a hardcoded
          // weekly/Monday and never read the saved values, so re-opening the wizard on
          // an already-configured client and clicking through silently downgraded a
          // monthly client to weekly. Combined with the start-date reset below, a
          // re-run could move a client's whole publish series to a different day.
          if (cs.schedule_frequency || cs.schedule_day_of_week != null || cs.publish_time) {
            setSchedule(prev => ({
              frequency:    cs.schedule_frequency   ?? prev.frequency,
              dayOfWeek:    cs.schedule_day_of_week ?? prev.dayOfWeek,
              publishTime:  cs.publish_time         ?? prev.publishTime,
              autoGenerate: cs.auto_generate ?? prev.autoGenerate,
            }))
          }
          // Remember the existing anchor so completing the wizard does not move it.
          if (cs.schedule_start_date) setExistingStartDate(cs.schedule_start_date)
          if (cs.service_page_topic_guidelines) setSpGuidelinesWiz(cs.service_page_topic_guidelines)
          if (cs.regular_page_topic_guidelines) setRpGuidelinesWiz(cs.regular_page_topic_guidelines)
          // A SAVED sitemap URL always wins over the /sitemap_index.xml guess made from a
          // detected connection. It used to apply only when no connection was found, so a client
          // whose real sitemap is /wp-sitemap.xml or /sitemap.xml had it silently replaced with
          // the guess on every re-run — and the save at the end wrote the guess back.
          if (cs.sitemap_url) {
            setSitemapUrl(cs.sitemap_url)
            // Derive site URL from saved sitemap — strip any sitemap-like filename
            // (covers /sitemap_index.xml, /wp-sitemap.xml, /post-sitemap.xml, etc.)
            const derivedSite = cs.sitemap_url.replace(/\/[^/]*sitemap[^/]*\.xml$/i, '').replace(/\/$/, '')
            // Only when a live connection did not already give us a better site URL.
            if (derivedSite && !connectionDetectedUrl) setAnalyzeUrl(derivedSite)
          }
        }
      } catch { /* ignore */ }
    }
    loadInit()
  }, [clientId])

  // ── Actions ────────────────────────────────────────────────────────────────

  async function handleWpConnect() {
    if (!wpConnectSiteUrl.trim() || !wpConnectUsername.trim() || !wpConnectAppPwd.trim()) {
      setWpConnectMsg('All three fields are required.')
      return
    }
    setWpConnecting(true)
    setWpConnectMsg('')
    try {
      const normalised = wpConnectSiteUrl.trim().replace(/\/$/, '')
      const res = await fetch(`/api/admin/clients/${clientId}/direct-connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'wordpress', siteUrl: normalised, username: wpConnectUsername.trim(), appPassword: wpConnectAppPwd.trim() }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Connection failed')
      // Update URL states so brand analysis and sitemap steps are pre-filled
      setWpUrl(normalised)
      setAnalyzeUrl(normalised)
      setSitemapUrl(normalised + '/sitemap_index.xml')
      setWpJustConnected(true)
      // Re-fetch connections to pick up the new connector ID
      try {
        const connsRes = await fetch(`/api/admin/clients/${clientId}/connections`)
        if (connsRes.ok) {
          const conns = await connsRes.json() as Array<{ id: string; type: string; site_url?: string | null }>
          const wpConn = conns.find(c => c.type === 'wordpress')
          if (wpConn) setDetectedConnectionId(wpConn.id)
        }
      } catch { /* non-fatal */ }
    } catch (err) {
      setWpConnectMsg(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setWpConnecting(false)
    }
  }

  async function handleAnalyze() {
    if (!analyzeUrl.trim()) return
    setAnalyzing(true)
    setAnalyzeMsg('Scanning website…')
    try {
      const res  = await fetch('/api/admin/content/generate-brand-dna', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, site_url: analyzeUrl }),
      })
      const data = await res.json() as Partial<BrandDna> & { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Analysis failed')
      setBrand(prev => ({
        ...prev,
        business_background: data.business_background ?? prev.business_background,
        services:            data.services            ?? prev.services,
        target_audience:     data.target_audience     ?? prev.target_audience,
        geographic_focus:    data.geographic_focus    ?? prev.geographic_focus,
        brand_voice:         data.brand_voice         ?? prev.brand_voice,
        founded_year:        (data as Record<string, unknown>).founded_year as string ?? prev.founded_year,
        years_in_business:   (data as Record<string, unknown>).years_in_business as string ?? prev.years_in_business,
        phone_number:        (data as Record<string, unknown>).phone_number as string ?? prev.phone_number,
        owner_details:       (data as Record<string, unknown>).owner_details as string ?? prev.owner_details,
        licenses:            (data as Record<string, unknown>).licenses as string ?? prev.licenses,
        guarantees:          (data as Record<string, unknown>).guarantees as string ?? prev.guarantees,
        review_count:        (data as Record<string, unknown>).review_count as string ?? prev.review_count,
        emergency_availability: (data as Record<string, unknown>).emergency_availability as boolean ?? prev.emergency_availability,
      }))
      setBrandLoaded(true)
      setAnalyzeMsg('')
    } catch (err) {
      setAnalyzeMsg(err instanceof Error ? err.message : 'Analysis failed')
      setBrandLoaded(false)
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleFetchPages() {
    if (!sitemapUrl.trim()) {
      setSitemapMsg('Enter a sitemap URL above first.')
      return
    }
    setFetchingPages(true)
    setSitemapMsg('Fetching sitemap…')
    setPages([])
    try {
      // Save sitemap URL first so the parse endpoint can use it
      await fetch('/api/admin/content/client-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, sitemap_url: sitemapUrl }),
      })

      const res  = await fetch(`/api/admin/content/sitemap-parse?client_id=${clientId}`, { method: 'POST' })
      const data = await res.json() as SitemapPage[] | { error?: string }
      if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to fetch sitemap')
      const list = data as SitemapPage[]
      setPages(list)
      setSitemapMsg(`Found ${list.length} page${list.length !== 1 ? 's' : ''}`)
    } catch (err) {
      setSitemapMsg(err instanceof Error ? err.message : 'Failed')
    } finally {
      setFetchingPages(false)
    }
  }

  // The starting keywords are deliberately not pre-filled from Services: the research step offers
  // "Use the services from step 3" as a button, so the default is one click away and the two
  // fields stop looking like one field shown twice.

  /**
   * Research this market. Spends, so it runs only when the operator presses the button.
   *
   * It used to run from an effect on reaching this step, which bought DataForSEO research — and
   * saved every answer in the wizard — because someone clicked Continue. Entering the step now
   * shows the stored pool, a free read, and this is the one thing on the step that spends.
   *
   * The answers are saved first because research reads the services, the service areas and the
   * seed terms from the saved settings; unsaved, it would research the business as it was before
   * this wizard opened. Called from a click, so saveSettings reads what is on screen now.
   *
   * The first run for a client is a plain POST. Once a client has been researched it is forced,
   * which replaces the unchosen candidates: otherwise a corrected seed list would pay again and
   * show the old list plus a few extras.
   */
  async function researchMarket() {
    if (researchPhase === 'researching') return
    const hadRun = !!research?.researchedAt || (research?.keywords.length ?? 0) > 0
    setResearchPhase('researching')
    setResearchOutcome(null)
    try {
      try {
        await saveSettings()
      } catch (e) {
        setResearchOutcome({
          tone: 'error',
          text: `Couldn’t save your answers, so research didn’t run. ${e instanceof Error ? e.message : ''}`.trim(),
        })
        return
      }
      const res  = await fetch('/api/admin/content/keyword-research', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ client_id: clientId, ...(hadRun ? { force: true } : {}) }),
      })
      const data = await res.json().catch(() => ({})) as Partial<ResearchData> & { error?: string }
      if (!res.ok) {
        // 403: a viewer cannot re-run research. 429: it ran less than an hour ago. Both carry a
        // sentence written for the operator.
        setResearchOutcome({
          tone: res.status === 429 ? 'warning' : 'error',
          text: data.error ?? `Research didn’t run (HTTP ${res.status}).`,
        })
        return
      }
      if (data.ok === false) {
        // Nothing new was stored — over the month's budget, no connection, a storage failure —
        // and the pool was left as it was, so show the stored one again.
        setResearchOutcome({ tone: 'warning', text: data.reason ?? 'Research didn’t store anything new.' })
        await reloadStoredResearch()
        return
      }
      setResearch({
        ...data,
        keywords:    data.keywords ?? [],
        competitors: data.competitors ?? [],
        connected:   data.connected ?? true,
        fromRun:     true,
      })
      const n = data.discovered ?? 0
      setResearchOutcome({
        tone: 'success',
        text: n > 0
          ? `Found ${n.toLocaleString()} new keyword${n === 1 ? '' : 's'}. Tick the ones worth writing about, then save.`
          : 'No new keywords this time. The list below is what research already holds.',
      })
    } catch {
      setResearchOutcome({ tone: 'error', text: 'Research didn’t finish — the connection dropped. Try again.' })
    } finally {
      setResearchPhase('idle')
    }
  }

  /**
   * Read the stored pool. Free — a database read, and the GET never spends.
   *
   * Used on entering the research step and after picks are saved. Keeps what only a run returns
   * (competitors, the map pack) and replaces the rows, so the list the panel reconciles against
   * is what the server now holds. Returns whether it could read.
   */
  const reloadStoredResearch = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/admin/content/keyword-research?client_id=${clientId}`)
      if (!res.ok) return false
      const d = await res.json() as ResearchData
      setResearch(prev => ({
        ...(prev ?? { competitors: [], connected: d.connected }),
        keywords:         d.keywords ?? [],
        researchedAt:     d.researchedAt ?? prev?.researchedAt ?? null,
        researchLocation: d.researchLocation ?? prev?.researchLocation ?? null,
      }))
      return true
    } catch {
      return false
    }
  }, [clientId])

  // Entering the research step shows what is already stored. Nothing here spends.
  useEffect(() => {
    if (step !== 8 || !hasDfs) return
    let cancelled = false
    setResearchPhase('loading')
    void reloadStoredResearch().then(ok => {
      if (cancelled) return
      if (!ok) setResearchOutcome({ tone: 'error', text: 'Couldn’t load the saved keyword list. Step back and forward again to retry.' })
      setResearchPhase(p => p === 'loading' ? 'idle' : p)
    })
    return () => { cancelled = true; setResearchPhase(p => p === 'loading' ? 'idle' : p) }
  }, [step, hasDfs, reloadStoredResearch])

  /**
   * Write every answer in the wizard to the client's settings.
   *
   * `wizardCompleted` is sent only when given: the save before a research run leaves it as it
   * was, so researching from a re-opened wizard does not mark a set-up client as unfinished.
   */
  async function saveSettings(wizardCompleted?: boolean) {
    const eeatData = {
      founded_year:           brand.founded_year,
      years_in_business:      brand.years_in_business,
      phone_number:           brand.phone_number,
      owner_details:          brand.owner_details,
      licenses:               brand.licenses,
      guarantees:             brand.guarantees,
      review_count:           brand.review_count,
      emergency_availability: brand.emergency_availability,
    }

    const res = await fetch('/api/admin/content/client-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:            clientId,
        business_background:  brand.business_background,
        services:             brand.services,
        target_audience:      brand.target_audience,
        geographic_focus:     brand.geographic_focus,
        brand_voice:          brand.brand_voice,
        phone_number:         brand.phone_number,
        // Seeds for research, not a content plan — see migration 222. Split the way the chip
        // input wrote them: a plain comma split turned "gutter guards (mesh, micro-mesh)" into
        // two broken seeds. Capped at what the chip input accepts, so nothing shown is dropped.
        foundational_keywords: splitPhrases(foundationalKeywords).slice(0, SEED_MAX),
        sitemap_url:          sitemapUrl || undefined,
        schedule_frequency:   schedule.frequency,
        schedule_day_of_week: schedule.dayOfWeek,
        // Keep the existing anchor on a re-run; only stamp today on first setup.
        schedule_start_date:  existingStartDate ?? new Date().toISOString().slice(0, 10),
        publish_time:         schedule.publishTime,
        auto_generate:   schedule.autoGenerate,
        // Sent WITH auto_generate, or the single tick in this wizard becomes one-way: the
        // content-topics cron treats a lagging sub-flag as a legacy row and heals it to true,
        // so unticking the box here never actually turned auto-approve or auto-push back off.
        auto_approve_topics: schedule.autoGenerate,
        auto_push_posts:     schedule.autoGenerate,
        generate_service_pages:         enableServicePages,
        service_page_topic_guidelines:  spGuidelinesWiz || null,
        generate_regular_pages:         enableRegularPages,
        regular_page_topic_guidelines:  rpGuidelinesWiz || null,
        // Merged, not replaced: the wizard owns 8 keys of a 16-key column and must not delete
        // the 9 the settings tab maintains — several of which the writer prompt reads.
        eeat_data:                      { ...loadedEeat, ...eeatData },
        ...(wizardCompleted === undefined ? {} : { wizard_completed: wizardCompleted }),
        connection_id:                  detectedConnectionId ?? undefined,
        content_image_generation:       imageGen,
        content_image_prompt:           imagePrompt || null,
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(data.error ?? 'Failed to save settings')
    }
  }

  async function handleSave() {
    setSaving(true)
    setSaveMsg('')
    try {
      await saveSettings(true)
      onComplete()
    } catch {
      setSaveMsg('Save failed — please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveAndGenerate() {
    setSaving(true)
    setSaveMsg('')
    try {
      await saveSettings(true)
      // Use calendar/generate to spread topics across scheduled publish slots with proper dates
      const res = await fetch('/api/admin/content/calendar/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // No start_date. saveSettings above deliberately keeps existingStartDate so a re-run
        // does not move a client's publish anchor — and calendar/generate gives an explicit
        // start_date precedence over the saved one, so passing today undid that immediately and
        // re-anchored the whole series off-cadence.
        body: JSON.stringify({ client_id: clientId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? 'Generation failed')
      }
      onComplete()
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : 'Save failed — please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleSkip = useCallback(async () => {
    await fetch('/api/admin/content/client-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, wizard_completed: true }),
    }).catch(() => {})
    onComplete()
  }, [clientId, onComplete])

  // ── ESC to close ──────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleSkip() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSkip])

  const onPicksDirty = useCallback((dirty: boolean) => {
    setPicksDirty(dirty)
    if (!dirty) setLeaveWarned(false)
  }, [])

  /** Leaving the research step unmounts the list, and unsaved ticks go with it. Say so once. */
  function guardLeave(): boolean {
    if (step === 8 && picksDirty && !leaveWarned) { setLeaveWarned(true); return false }
    setLeaveWarned(false)
    setPicksDirty(false)
    return true
  }
  function next() { if (guardLeave()) setStep(s => Math.min(s + 1, TOTAL_STEPS)) }
  function back() { if (guardLeave()) setStep(s => Math.max(s - 1, 1)) }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 2000, padding: '1rem',
      }}
    >
      <div style={{
        background: 'var(--bg-surface)',
        borderRadius: 16,
        maxWidth: 680,
        width: '100%',
        maxHeight: '92vh',
        overflowY: 'auto',
        boxShadow: '0 32px 100px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem 0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <StepDots current={step} total={TOTAL_STEPS} />
          <button
            onClick={handleSkip}
            style={{ background: 'none', border: 'none', fontSize: '0.75rem', color: 'var(--text-faint)', cursor: 'pointer', padding: '4px 8px', borderRadius: 4 }}
          >
            Skip Setup
          </button>
        </div>

        {/* Step body */}
        <div style={{ padding: '1.5rem', flex: 1 }}>
          {step === 1 && <StepWelcome clientName={clientName} hasGsc={hasGsc} wpUrl={wpUrl} />}
          {step === 2 && (
            <StepWpConnect
              clientId={clientId}
              wpUrl={wpUrl}
              siteUrlInput={wpConnectSiteUrl}
              setSiteUrlInput={setWpConnectSiteUrl}
              username={wpConnectUsername}
              setUsername={setWpConnectUsername}
              appPassword={wpConnectAppPwd}
              setAppPassword={setWpConnectAppPwd}
              connecting={wpConnecting}
              connectMsg={wpConnectMsg}
              justConnected={wpJustConnected}
              onConnect={handleWpConnect}
              onSkip={next}
            />
          )}
          {step === 3 && (
            <StepBrandAnalysis
              analyzeUrl={analyzeUrl}
              setAnalyzeUrl={setAnalyzeUrl}
              onAnalyze={handleAnalyze}
              analyzing={analyzing}
              analyzeMsg={analyzeMsg}
              brand={brand}
              setBrand={setBrand}
              brandLoaded={brandLoaded}
            />
          )}
          {step === 4 && <StepEeat brand={brand} setBrand={setBrand} />}
          {step === 5 && (
            <StepSitemap
              clientId={clientId}
              sitemapUrl={sitemapUrl}
              setSitemapUrl={setSitemapUrl}
              onFetch={handleFetchPages}
              fetching={fetchingPages}
              fetchMsg={sitemapMsg}
              pages={pages}
              setPages={setPages}
            />
          )}
          {step === 6 && (
            <StepSchedule
              schedule={schedule}
              setSchedule={setSchedule}
              imageGen={imageGen}
              setImageGen={setImageGen}
              imagePrompt={imagePrompt}
              setImagePrompt={setImagePrompt}
            />
          )}
          {step === 7 && (
            <StepContentTypes
              enableServicePages={enableServicePages}
              setEnableServicePages={setEnableServicePages}
              spGuidelines={spGuidelinesWiz}
              setSpGuidelines={setSpGuidelinesWiz}
              enableRegularPages={enableRegularPages}
              setEnableRegularPages={setEnableRegularPages}
              rpGuidelines={rpGuidelinesWiz}
              setRpGuidelines={setRpGuidelinesWiz}
            />
          )}
          {step === 8 && (
            <StepResearch
              research={research}
              phase={researchPhase}
              outcome={researchOutcome}
              clientId={clientId}
              servicesText={brand.services}
              seeds={foundationalKeywords}
              setSeeds={setFoundationalKeywords}
              onResearch={() => void researchMarket()}
              hasDfs={hasDfs}
              onPicksSaved={reloadStoredResearch}
              onPicksDirty={onPicksDirty}
            />
          )}
          {step === 9 && (
            <StepReady
              clientName={clientName}
              brand={brand}
              schedule={schedule}
              pagesCount={pages.length}
              hasGsc={hasGsc ?? false}
              hasResearch={(research?.keywords.length ?? 0) > 0}
              saving={saving}
              saveMsg={saveMsg}
              onSave={handleSave}
              onSaveAndGenerate={handleSaveAndGenerate}
            />
          )}
        </div>

        {/* Footer nav */}
        {step < 9 && (
          <div style={{
            padding: '1rem 1.5rem 1.25rem',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            borderTop: '1px solid var(--border)',
          }}>
            <button
              onClick={back}
              disabled={step === 1}
              className="btn btn-secondary"
              style={{ fontSize: '0.875rem', opacity: step === 1 ? 0.3 : 1 }}
            >
              ← Back
            </button>
            {leaveWarned && picksDirty && (
              <p role="alert" style={{ margin: 0, flex: '1 1 200px', fontSize: '0.8125rem', color: 'var(--amber)', lineHeight: 1.4 }}>
                Your ticks aren&apos;t saved. Press <strong>Save selection</strong> first, or leave without them.
              </p>
            )}
            <button
              onClick={next}
              className="btn btn-primary"
              style={{ fontSize: '0.875rem' }}
            >
              {leaveWarned && picksDirty
                ? 'Leave without saving →'
                : step === 7 || (step === 8 && !hasDfs) ? 'Skip →' : 'Continue →'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          style={{
            width: i + 1 === current ? 20 : 8,
            height: 8,
            borderRadius: 4,
            background: i + 1 <= current ? 'var(--blue)' : 'var(--border)',
            transition: 'all 0.25s ease',
          }}
        />
      ))}
      <span style={{ fontSize: '0.6875rem', color: 'var(--text-faint)', marginLeft: 8 }}>
        Step {current} of {total}
      </span>
    </div>
  )
}

function StepTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ margin: '0 0 0.375rem', fontSize: '1.375rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.25 }}>
      {children}
    </h2>
  )
}

function StepSub({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: '0 0 1.5rem', fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
      {children}
    </p>
  )
}

function Field({ label, children, drivesResearch }: {
  label: string
  children: React.ReactNode
  /** Marks a field the research reads, as opposed to one that only shapes the writing. */
  drivesResearch?: boolean
}) {
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
        {label}
        {drivesResearch && (
          <span
            title="Read by keyword research: changing this changes what we find."
            style={{
              fontSize: '0.5625rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              padding: '1px 6px', borderRadius: 999,
              background: 'var(--blue-subtle)', color: 'var(--blue)',
            }}
          >
            research
          </span>
        )}
      </label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.5rem 0.625rem', borderRadius: 6,
  border: '1px solid var(--border)', fontSize: '0.875rem',
  background: 'var(--bg-surface)', color: 'var(--text-primary)',
  boxSizing: 'border-box',
}

const taStyle: React.CSSProperties = {
  ...inputStyle, minHeight: 80, resize: 'vertical' as const, fontFamily: 'inherit',
}

// ─── Step 1: Welcome ──────────────────────────────────────────────────────────

function StepWelcome({ clientName, hasGsc, wpUrl }: { clientName: string; hasGsc: boolean | null; wpUrl: string }) {
  return (
    <div>
      <StepTitle>Let&apos;s set up content for {clientName}</StepTitle>
      <StepSub>This wizard guides you through configuring the AI content pipeline. It only takes a few minutes.</StepSub>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { icon: '🗓', title: 'Set a Schedule', body: 'Choose how often posts should publish and configure automation.' },
          { icon: '🔍', title: 'Research Topics', body: 'AI will find the best keyword opportunities based on GSC and competitor data.' },
          { icon: '✍', title: 'Generate Posts', body: 'Full-length, SEO-optimised posts written with the client\'s brand voice.' },
        ].map(c => (
          <div key={c.title} style={{ padding: '1rem', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-subtle)' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: 6 }}>{c.icon}</div>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 4, color: 'var(--text-primary)' }}>{c.title}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{c.body}</div>
          </div>
        ))}
      </div>

      {hasGsc === false && (
        <div style={{ padding: '0.875rem 1rem', borderRadius: 8, background: 'var(--amber-subtle)', border: '1px solid var(--amber)', marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: '0.8125rem', color: 'var(--text-primary)', marginBottom: 3 }}>Google Search Console not connected</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Topic suggestions will be less precise without real keyword data. Connect Search Console on the client&apos;s Integrations tab for best results.
          </div>
        </div>
      )}

      {wpUrl && (
        <div style={{ padding: '0.875rem 1rem', borderRadius: 8, background: 'var(--green-subtle)', border: '1px solid var(--green)', marginBottom: 8 }}>
          <div style={{ fontWeight: 600, fontSize: '0.8125rem', color: 'var(--text-primary)', marginBottom: 2 }}>WordPress connected</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{wpUrl}</div>
        </div>
      )}
    </div>
  )
}

// ─── Step 2: WordPress Connection ────────────────────────────────────────────

function StepWpConnect({
  clientId, wpUrl, siteUrlInput, setSiteUrlInput, username, setUsername,
  appPassword, setAppPassword, connecting, connectMsg, justConnected, onConnect, onSkip,
}: {
  clientId: string
  wpUrl: string
  siteUrlInput: string
  setSiteUrlInput: (v: string) => void
  username: string
  setUsername: (v: string) => void
  appPassword: string
  setAppPassword: (v: string) => void
  connecting: boolean
  connectMsg: string
  justConnected: boolean
  onConnect: () => void
  onSkip: () => void
}) {
  void clientId // used in parent for the API call
  const isConnected = !!wpUrl

  if (isConnected) {
    return (
      <div>
        <StepTitle>WordPress Connected</StepTitle>
        <StepSub>Your client&apos;s WordPress site is already connected and ready for publishing.</StepSub>
        <style>{`
          @keyframes wp-slide-in { from { transform:translateY(6px); opacity:0 } to { transform:translateY(0); opacity:1 } }
        `}</style>
        <div style={{
          padding: '1.25rem 1.5rem',
          borderRadius: 12,
          border: '2px solid var(--green)',
          background: 'var(--green-subtle)',
          display: 'flex', alignItems: 'center', gap: 16,
          animation: 'wp-slide-in 0.35s ease',
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%', background: 'var(--green)', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <polyline points="5,13 9,17 19,7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--text-primary)' }}>Connected</div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: 2 }}>{wpUrl}</div>
          </div>
        </div>
        <p style={{ marginTop: 16, fontSize: '0.8125rem', color: 'var(--text-muted)', textAlign: 'center' }}>
          Click <strong>Continue</strong> to proceed to the next step.
        </p>
      </div>
    )
  }

  return (
    <div>
      <StepTitle>Connect WordPress</StepTitle>
      <StepSub>
        Connect your client&apos;s WordPress site so posts can be published automatically.
        You&apos;ll need the site URL and a WordPress Application Password.
      </StepSub>

      {justConnected ? (
        <>
          <style>{`
            @keyframes wp-check-in { from { transform:scale(0.8); opacity:0 } to { transform:scale(1); opacity:1 } }
            @keyframes check-draw  { from { stroke-dashoffset:50; opacity:0 } to { stroke-dashoffset:0; opacity:1 } }
          `}</style>
          <div style={{
            padding: '1.5rem',
            borderRadius: 12,
            border: '2px solid var(--green)',
            background: 'var(--green-subtle)',
            display: 'flex', alignItems: 'center', gap: 16,
            animation: 'wp-check-in 0.4s cubic-bezier(0.34,1.56,0.64,1)',
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%', background: 'var(--green)', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <polyline
                  points="5,13 9,17 19,7"
                  stroke="white"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="50"
                  strokeDashoffset="0"
                  style={{ animation: 'check-draw 0.4s ease 0.15s both' }}
                />
              </svg>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--text-primary)' }}>WordPress connected!</div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: 2 }}>{siteUrlInput.trim().replace(/\/$/, '')}</div>
            </div>
          </div>
          <p style={{ marginTop: 16, fontSize: '0.8125rem', color: 'var(--text-muted)', textAlign: 'center' }}>
            Connection saved. Click <strong>Continue</strong> to proceed.
          </p>
        </>
      ) : (
        <>
          <Field label="WordPress Site URL">
            <input
              type="url"
              value={siteUrlInput}
              onChange={e => setSiteUrlInput(e.target.value)}
              placeholder="https://example.com"
              style={inputStyle}
            />
          </Field>
          <Field label="WordPress Username">
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Admin username"
              style={inputStyle}
              autoComplete="username"
            />
          </Field>
          <Field label="Application Password">
            <input
              type="password"
              value={appPassword}
              onChange={e => setAppPassword(e.target.value)}
              placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
              style={inputStyle}
              autoComplete="new-password"
            />
          </Field>

          <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginBottom: 16, lineHeight: 1.5 }}>
            Generate an Application Password in WP Admin → Users → Profile → Application Passwords section.
          </p>

          {connectMsg && (
            <div style={{ padding: '0.625rem 0.875rem', borderRadius: 6, background: 'var(--red-subtle)', color: 'var(--red)', fontSize: '0.8125rem', marginBottom: 16 }}>
              {connectMsg}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button
              onClick={onConnect}
              disabled={connecting || !siteUrlInput.trim() || !username.trim() || !appPassword.trim()}
              className="btn btn-primary"
              style={{ fontSize: '0.875rem' }}
            >
              {connecting ? 'Connecting…' : 'Connect WordPress'}
            </button>
            <button
              onClick={onSkip}
              style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: '0.8125rem', padding: 0 }}
            >
              Skip — not using WordPress
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Step 3: Brand Analysis (was Step 2) ─────────────────────────────────────

function StepBrandAnalysis({ analyzeUrl, setAnalyzeUrl, onAnalyze, analyzing, analyzeMsg, brand, setBrand, brandLoaded }: {
  analyzeUrl: string
  setAnalyzeUrl: (v: string) => void
  onAnalyze: () => void
  analyzing: boolean
  analyzeMsg: string
  brand: BrandDna
  setBrand: (b: BrandDna) => void
  brandLoaded: boolean
}) {
  return (
    <div>
      <StepTitle>Analyze this business</StepTitle>
      <StepSub>Enter the website URL and we&apos;ll extract brand information automatically. You can edit everything after.</StepSub>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="url"
          value={analyzeUrl}
          onChange={e => setAnalyzeUrl(e.target.value)}
          placeholder="https://example.com"
          style={{ ...inputStyle, flex: 1 }}
        />
        <button
          onClick={onAnalyze}
          disabled={analyzing || !analyzeUrl.trim()}
          className="btn btn-primary"
          style={{ fontSize: '0.875rem', whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          {analyzing ? 'Analyzing…' : 'Analyze Website'}
        </button>
      </div>

      {analyzeMsg && (
        <p style={{ fontSize: '0.8125rem', color: analyzeMsg.includes('ailed') ? 'var(--red)' : 'var(--text-muted)', marginBottom: 12 }}>
          {analyzeMsg}
        </p>
      )}

      {(brandLoaded || brand.business_background) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.5 }}>
            {RESEARCH_FIELDS_NOTE}
          </p>
          <Field label="Business Background">
            <textarea value={brand.business_background} onChange={e => setBrand({ ...brand, business_background: e.target.value })} style={taStyle} />
          </Field>
          <Field label="What they sell" drivesResearch>
            <KeywordChipInput
              value={brand.services}
              onChange={v => setBrand({ ...brand, services: v })}
              placeholder="Plumbing, HVAC, Electrical"
            />
            <p style={{ fontSize: '0.6875rem', color: 'var(--text-faint)', marginTop: 4, lineHeight: 1.5 }}>
              {SERVICES_HELP}
            </p>
          </Field>
          <Field label="Target Audience">
            <input type="text" value={brand.target_audience} onChange={e => setBrand({ ...brand, target_audience: e.target.value })} style={inputStyle} />
          </Field>

          <Field label="Service Areas" drivesResearch>
            <KeywordChipInput
              value={brand.geographic_focus}
              onChange={v => setBrand({ ...brand, geographic_focus: v })}
              placeholder="Austin, Round Rock, Hill Country…"
            />
            <MarketLine geographicFocus={brand.geographic_focus} />
          </Field>
          {/* Research Location used to sit here. It was a second place to name the market the
              first service area already names, and in production not one client had ever set it.
              The market is derived from the first service area and shown under it. */}
          <Field label="Brand Voice">
            <input type="text" value={brand.brand_voice} onChange={e => setBrand({ ...brand, brand_voice: e.target.value })} style={inputStyle} placeholder="Professional, approachable, trustworthy" />
          </Field>
        </div>
      )}

      {!brandLoaded && !brand.business_background && (
        <div style={{ padding: '2rem', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 10, color: 'var(--text-faint)', fontSize: '0.875rem' }}>
          Enter a website URL above and click &quot;Analyze Website&quot; to auto-fill brand info, or continue to fill it in manually.
        </div>
      )}
    </div>
  )
}

// ─── Step 3: E-E-A-T Signals ─────────────────────────────────────────────────

function StepEeat({ brand, setBrand }: { brand: BrandDna; setBrand: (b: BrandDna) => void }) {
  return (
    <div>
      <StepTitle>Trust &amp; credibility signals</StepTitle>
      <StepSub>These help the AI write with real authority. E-E-A-T signals significantly improve content quality and rankings for local businesses.</StepSub>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
        <Field label="Year Founded">
          <input type="number" min={1800} max={new Date().getFullYear()} value={brand.founded_year} onChange={e => setBrand({ ...brand, founded_year: e.target.value })} style={inputStyle} placeholder="2003" />
        </Field>
        <Field label="Phone Number">
          <input type="text" value={brand.phone_number} onChange={e => setBrand({ ...brand, phone_number: e.target.value })} style={inputStyle} placeholder="(555) 123-4567" />
        </Field>
        <Field label="Number of Reviews">
          <input type="text" value={brand.review_count} onChange={e => setBrand({ ...brand, review_count: e.target.value })} style={inputStyle} placeholder="200+ Google reviews" />
        </Field>
        <Field label="Owner / Operator Name">
          <input type="text" value={brand.owner_details} onChange={e => setBrand({ ...brand, owner_details: e.target.value })} style={inputStyle} placeholder="John Smith" />
        </Field>
        <Field label="Licenses / Certifications">
          <input type="text" value={brand.licenses} onChange={e => setBrand({ ...brand, licenses: e.target.value })} style={inputStyle} placeholder="Licensed, Bonded, Insured" />
        </Field>
        <Field label="Guarantees / Warranties">
          <input type="text" value={brand.guarantees} onChange={e => setBrand({ ...brand, guarantees: e.target.value })} style={inputStyle} placeholder="100% satisfaction guarantee" />
        </Field>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, padding: '0.75rem 1rem', borderRadius: 8, background: 'var(--bg-subtle)', border: '1px solid var(--border)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1 }}>
          <input
            type="checkbox"
            checked={brand.emergency_availability}
            onChange={e => setBrand({ ...brand, emergency_availability: e.target.checked })}
            style={{ width: 16, height: 16 }}
          />
          <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>24/7 Emergency availability</span>
        </label>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>Boosts local search intent matching</span>
      </div>
    </div>
  )
}

// ─── Step 4: Sitemap ──────────────────────────────────────────────────────────

function StepSitemap({ clientId, sitemapUrl, setSitemapUrl, onFetch, fetching, fetchMsg, pages, setPages }: {
  clientId: string
  sitemapUrl: string
  setSitemapUrl: (v: string) => void
  onFetch: () => void
  fetching: boolean
  fetchMsg: string
  pages: SitemapPage[]
  setPages: (p: SitemapPage[]) => void
}) {
  const [saveErr, setSaveErr] = useState<string | null>(null)

  /**
   * Persist a flag change.
   *
   * These toggles used to set React state and nothing else. sitemap-parse stores the URLs but
   * deliberately leaves is_priority / is_excluded alone so a re-parse cannot wipe them, and the
   * wizard never wrote them either — so every page came out of onboarding unflagged. The
   * exclusions never reached the client's sitemap tab, and, more quietly, no page was ever
   * marked priority, which is what the generator's "link to at least 2 priority pages"
   * instruction reads. Same endpoint the sitemap tab uses, so both surfaces now agree.
   *
   * Written per toggle rather than batched on step change: the wizard can be closed at any
   * step, and a flag the user set should survive that.
   */
  async function persist(body: Record<string, unknown>) {
    try {
      const res = await fetch('/api/admin/content/sitemap-pages', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ client_id: clientId, ...body }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? `Save failed (${res.status})`)
      }
      setSaveErr(null)
    } catch (e) {
      // Keep the optimistic state on screen but say it did not stick, rather than silently
      // showing a checkbox that means nothing.
      setSaveErr(e instanceof Error ? e.message : 'Could not save that change')
    }
  }

  function togglePriority(idx: number) {
    const next = !pages[idx].isPriority
    setPages(pages.map((p, i) => i === idx ? { ...p, isPriority: next } : p))
    void persist({ url: pages[idx].url, is_priority: next })
  }
  function toggleExclude(idx: number) {
    const next = !pages[idx].isExcluded
    setPages(pages.map((p, i) => i === idx ? { ...p, isExcluded: next } : p))
    void persist({ url: pages[idx].url, is_excluded: next })
  }
  function markServicePages() {
    // Only the pages this actually changes are sent; the endpoint's bulk path takes the list.
    const isService = (url: string) => url.includes('/service')
    const serviceUrls = pages.filter(p => isService(p.url)).map(p => p.url)
    const newlyPriority = pages.filter(p => isService(p.url) && !p.isPriority).map(p => p.url)
    setPages(pages.map(p => ({ ...p, isPriority: isService(p.url) || p.isPriority })))
    // The button is a classification as much as a ranking. is_service_page is what the sitemap
    // tab reads and what marks these as commercial pages rather than articles, and it is written
    // for EVERY service URL — scoping it to the ones whose priority changed meant a page already
    // marked priority never got classified. Sequential, so the two writes cannot race on the
    // error banner.
    if (serviceUrls.length) {
      void (async () => {
        if (newlyPriority.length) await persist({ urls: newlyPriority, is_priority: true })
        await persist({ urls: serviceUrls, is_service_page: true })
      })()
    }
  }

  return (
    <div>
      <StepTitle>Import your sitemap</StepTitle>
      <StepSub>We&apos;ll crawl the sitemap to find internal link targets. Mark important pages as Priority to guide topic selection.</StepSub>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          type="url"
          value={sitemapUrl}
          onChange={e => setSitemapUrl(e.target.value)}
          placeholder="https://example.com/sitemap.xml"
          style={{ ...inputStyle, flex: 1 }}
        />
        <button
          onClick={onFetch}
          disabled={fetching || !sitemapUrl.trim()}
          className="btn btn-primary"
          style={{ fontSize: '0.875rem', whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          {fetching ? 'Fetching…' : 'Fetch Pages'}
        </button>
      </div>

      {fetchMsg && (
        <p style={{ fontSize: '0.8125rem', color: fetchMsg.includes('ailed') ? 'var(--red)' : 'var(--text-muted)', marginBottom: 10 }}>
          {fetchMsg}
        </p>
      )}

      {saveErr && (
        <p style={{ fontSize: '0.8125rem', color: 'var(--red)', marginBottom: 10 }}>
          {saveErr} — the ticks below may not have been saved.
        </p>
      )}

      {pages.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <button onClick={markServicePages} className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '3px 10px' }}>
              Mark /service pages as Priority
            </button>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>
              {pages.filter(p => p.isPriority).length} priority · {pages.filter(p => p.isExcluded).length} excluded
            </span>
          </div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', maxHeight: 260, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-subtle)', position: 'sticky', top: 0 }}>
                  <th style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--text-faint)', fontWeight: 600 }}>URL</th>
                  <th style={{ padding: '6px 8px', textAlign: 'center', color: 'var(--text-faint)', fontWeight: 600, width: 70 }}>Priority</th>
                  <th style={{ padding: '6px 8px', textAlign: 'center', color: 'var(--text-faint)', fontWeight: 600, width: 70 }}>Exclude</th>
                </tr>
              </thead>
              <tbody>
                {pages.slice(0, 200).map((p, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '5px 10px', color: 'var(--text-muted)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', maxWidth: 400 }}>
                      {p.title || p.url.split('/').filter(Boolean).pop() || p.url}
                      <span style={{ color: 'var(--text-faint)', display: 'block', fontSize: '0.6875rem' }}>{p.url}</span>
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                      <input type="checkbox" checked={p.isPriority} onChange={() => togglePriority(i)} />
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                      <input type="checkbox" checked={p.isExcluded} onChange={() => toggleExclude(i)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages.length > 200 && (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: 4 }}>Showing first 200 of {pages.length} pages.</p>
          )}
        </>
      )}

      {pages.length === 0 && !fetching && (
        <div style={{ padding: '1.5rem', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 10, color: 'var(--text-faint)', fontSize: '0.875rem' }}>
          Enter a sitemap URL above and click &quot;Fetch Pages&quot;, or skip this step.
        </div>
      )}
    </div>
  )
}

// ─── Step 5: Schedule ─────────────────────────────────────────────────────────

function StepSchedule({
  schedule, setSchedule, imageGen, setImageGen, imagePrompt, setImagePrompt,
}: {
  schedule: Schedule; setSchedule: (s: Schedule) => void
  imageGen: boolean; setImageGen: (v: boolean) => void
  imagePrompt: string; setImagePrompt: (v: string) => void
}) {
  const needsDay = ['weekly', 'biweekly'].includes(schedule.frequency)

  return (
    <div>
      <StepTitle>Publishing schedule</StepTitle>
      <StepSub>How often should this client&apos;s posts be published? You can change this later under Settings → Schedule on the Content tab.</StepSub>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 20 }}>
        {FREQ_OPTIONS.map(opt => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setSchedule({ ...schedule, frequency: opt.id })}
            style={{
              padding: '1rem',
              borderRadius: 10,
              border: `2px solid ${schedule.frequency === opt.id ? 'var(--blue)' : 'var(--border)'}`,
              background: schedule.frequency === opt.id ? 'var(--blue-subtle)' : 'var(--bg-surface)',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: schedule.frequency === opt.id ? 'var(--blue)' : 'var(--text-primary)' }}>{opt.label}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: 2 }}>{opt.sub}</div>
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
        {needsDay && (
          <Field label="Day of Week">
            <select value={schedule.dayOfWeek} onChange={e => setSchedule({ ...schedule, dayOfWeek: Number(e.target.value) })} style={inputStyle}>
              {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </Field>
        )}
        <Field label="Publish Time">
          <input type="time" value={schedule.publishTime} onChange={e => setSchedule({ ...schedule, publishTime: e.target.value })} style={inputStyle} />
        </Field>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.625rem 0.875rem', borderRadius: 8, background: 'var(--bg-subtle)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={schedule.autoGenerate}
            onChange={e => setSchedule({ ...schedule, autoGenerate: e.target.checked })}
            style={{ width: 15, height: 15 }}
          />
          <div>
            <div style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>Auto-generate posts</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>Automatically generate posts from approved topics</div>
          </div>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.625rem 0.875rem', borderRadius: 8, background: 'var(--bg-subtle)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={imageGen}
            onChange={e => setImageGen(e.target.checked)}
            style={{ width: 15, height: 15 }}
          />
          <div>
            <div style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>Generate AI featured image</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>Uses the OpenAI image model chosen in Settings to create a featured image for each post</div>
          </div>
        </label>

        {imageGen && (
          <input
            type="text"
            value={imagePrompt}
            onChange={e => setImagePrompt(e.target.value)}
            placeholder="e.g. Outdoor lifestyle photo, warm tones, no text overlays"
            style={inputStyle}
          />
        )}
      </div>
    </div>
  )
}

// ─── Step 6: Additional Content Types ─────────────────────────────────────────

function StepContentTypes({
  enableServicePages, setEnableServicePages, spGuidelines, setSpGuidelines,
  enableRegularPages, setEnableRegularPages, rpGuidelines, setRpGuidelines,
}: {
  enableServicePages: boolean; setEnableServicePages: (v: boolean) => void
  spGuidelines: string; setSpGuidelines: (v: string) => void
  enableRegularPages: boolean; setEnableRegularPages: (v: boolean) => void
  rpGuidelines: string; setRpGuidelines: (v: string) => void
}) {
  return (
    <div>
      <StepTitle>
        Additional Content Types
        <span className="badge badge-amber" style={{ marginLeft: 10, verticalAlign: 'middle', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', borderRadius: 999 }}>
          Coming soon
        </span>
      </StepTitle>
      <StepSub>
        AI-generated Service Pages and Regular Pages alongside blog posts. Not switched on yet —
        the options below are shown so you can see what is planned, and nothing here is saved.
        Pages can still be generated on demand from the Pipeline tab today.
      </StepSub>

      {/* Disabled until the automation behind these exists: the content-topics cron reads the
          two flags and deliberately discards them, so a tick here has never driven anything. */}
      <div aria-disabled="true" style={{ opacity: 0.45, pointerEvents: 'none', userSelect: 'none' }}>
      {/* Service Pages */}
      <div className="card p-4" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <input
            type="checkbox"
            id="wiz-sp"
            checked={enableServicePages}
            onChange={e => setEnableServicePages(e.target.checked)}
            style={{ width: 18, height: 18, marginTop: 2, cursor: 'pointer', flexShrink: 0 }}
          />
          <label htmlFor="wiz-sp" style={{ cursor: 'pointer', flex: 1 }}>
            <p style={{ fontWeight: 600, fontSize: '0.9375rem', marginBottom: '0.2rem' }}>Service Pages</p>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: enableServicePages ? '0.75rem' : 0 }}>
              AI-generated landing pages targeting each of your services. Great for service-based businesses that want dedicated pages per offering.
            </p>
          </label>
        </div>
        {enableServicePages && (
          <textarea
            className="input"
            rows={3}
            placeholder="Topic guidelines for service pages (optional) — e.g. 'Focus on local intent, include pricing ranges…'"
            value={spGuidelines}
            onChange={e => setSpGuidelines(e.target.value)}
            style={{ width: '100%', resize: 'vertical', fontSize: '0.8125rem', marginTop: 8 }}
          />
        )}
      </div>

      {/* Regular Pages */}
      <div className="card p-4">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <input
            type="checkbox"
            id="wiz-rp"
            checked={enableRegularPages}
            onChange={e => setEnableRegularPages(e.target.checked)}
            style={{ width: 18, height: 18, marginTop: 2, cursor: 'pointer', flexShrink: 0 }}
          />
          <label htmlFor="wiz-rp" style={{ cursor: 'pointer', flex: 1 }}>
            <p style={{ fontWeight: 600, fontSize: '0.9375rem', marginBottom: '0.2rem' }}>Regular Pages</p>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: enableRegularPages ? '0.75rem' : 0 }}>
              Evergreen pages like About Us, FAQ, Resources, and more. Ideal for filling out a site&apos;s content architecture.
            </p>
          </label>
        </div>
        {enableRegularPages && (
          <textarea
            className="input"
            rows={3}
            placeholder="Topic guidelines for regular pages (optional) — e.g. 'Keep a professional tone, avoid technical jargon…'"
            value={rpGuidelines}
            onChange={e => setRpGuidelines(e.target.value)}
            style={{ width: '100%', resize: 'vertical', fontSize: '0.8125rem', marginTop: 8 }}
          />
        )}
      </div>

      </div>

      <p style={{ marginTop: 16, fontSize: '0.75rem', color: 'var(--text-faint)' }}>
        Press Skip to move on. This step saves nothing yet.
      </p>
    </div>
  )
}

// --- Step 7: Research --------------------------------------------------------

function StepResearch({ research, phase, outcome, clientId, servicesText, seeds, setSeeds, onResearch, hasDfs, onPicksSaved, onPicksDirty }: {
  research:  ResearchData | null
  /** 'loading' is the free read of the stored pool; 'researching' is a paid run. */
  phase:     'idle' | 'loading' | 'researching'
  outcome:   ResearchOutcome | null
  clientId:  string
  /** Step 3's Services, offered as a starting point rather than copied in silently. */
  servicesText: string
  seeds:     string
  setSeeds:  (v: string) => void
  /** Saves the answers and runs research. Spends. */
  onResearch: () => void
  /** Whether this client has a DataForSEO connection. Without one there is nothing to research. */
  hasDfs:    boolean
  /** After the picks are saved, so the wizard's copy of the pool matches the server's. */
  onPicksSaved: () => void
  onPicksDirty: (dirty: boolean) => void
}) {
  // Every hook first. An early return above a useState changes the hook order between renders,
  // which React refuses — and this component is rendered with hasDfs false and then true as the
  // connection check resolves, so it would have hit exactly that.
  const [confirming, setConfirming] = useState(false)
  const place = research?.researchLocation ? research.researchLocation.split(',')[0] : null
  // Built once per pool, not per render: the panel reconciles its ticks against this list, and
  // a fresh array on every keystroke in the seeds box is what used to wipe them.
  const rawKeywords = research?.keywords
  const panelKeywords = useMemo<ResearchKeyword[]>(() => (rawKeywords ?? []).map(k => ({
    keyword:      k.keyword,
    volume:       k.volume ?? null,
    difficulty:   k.difficulty ?? null,
    intent:       k.intent ?? null,
    source:       k.source ?? null,
    score:        k.score ?? null,
    local_volume: k.local_volume ?? null,
    chosen:       k.chosen ?? false,
  })), [rawKeywords])
  const geoWords = useMemo(() => place ? [place] : [], [place])

  // Nothing to research without DataForSEO, so ask for it here instead of running a step that can
  // only come back empty. Everything else in the wizard works without it; this is the one screen
  // that does not, and it is better to say so than to show an empty list and let the operator
  // wonder which of the previous eight answers was wrong.
  if (!hasDfs) {
    return (
      <div>
        <StepTitle>Connect DataForSEO to research keywords</StepTitle>
        <StepSub>
          Keyword research needs DataForSEO — it is what finds what people search for, what this
          client already ranks for, and what competitors rank for. Connect it on the client&apos;s
          Integrations tab and come back, or skip: everything else here is already set up, and you
          can add your own keywords by hand on the Keywords tab at any time.
        </StepSub>
        <a
          // The Integrations tab's id is `sources`; ?tab=integrations matched nothing and landed
          // on Overview.
          href={`/admin/clients/${clientId}?tab=sources`}
          target="_blank" rel="noopener noreferrer"
          className="btn btn-secondary"
          style={{ display: 'inline-block', fontSize: '0.875rem', marginTop: 4 }}
        >
          Open Integrations →
        </a>
      </div>
    )
  }

  const researching  = phase === 'researching'
  const busy         = phase !== 'idle'
  const keywords     = research?.keywords ?? []
  const competitors  = research?.competitors ?? []
  const localPack    = research?.localPack ?? []
  const hadRun       = !!research?.researchedAt || keywords.length > 0
  const researchedOn = research?.researchedAt ? new Date(research.researchedAt).toLocaleDateString() : null
  const canResearch  = !!(seeds.trim() || servicesText.trim())

  return (
    <div>
      <StepTitle>Choose what to write around</StepTitle>
      <StepSub>
        Search terms this business could realistically win, and the sites already winning them.
        Tick the ones worth pursuing — topics are only ever chosen from keywords you tick. You can
        change the picks at any time on the client&apos;s Keywords tab.
      </StepSub>

      {/* Starting keywords + look again: the two things an operator can do about a bad list */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '0.75rem 1rem', marginBottom: 12, background: 'var(--bg-subtle)' }}>
        <label htmlFor="wizard-starting-keywords" style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
          Search from
        </label>
        <p style={{ fontSize: '0.6875rem', color: 'var(--text-faint)', margin: '0 0 6px', lineHeight: 1.5 }}>
          {SERVICES_HELP}
          {servicesText.trim() && !seeds.trim() ? ' Start from the services you entered, or type your own.' : ''}
        </p>
        {servicesText.trim() && !seeds.trim() && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', marginBottom: 8 }}
            onClick={() => setSeeds(splitPhrases(servicesText).slice(0, SEED_MAX).join(', '))}
            disabled={busy}
          >
            Use the services from step 3
          </button>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <KeywordChipInput
              id="wizard-starting-keywords"
              value={seeds}
              onChange={setSeeds}
              disabled={busy}
              max={SEED_MAX}
              placeholder="permanent outdoor lighting, landscape lighting installation…"
            />
          </div>
          {confirming ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 200 }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                Replace the unticked ideas below? Ticked keywords stay.
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="btn btn-secondary" style={{ fontSize: '0.75rem' }} onClick={() => setConfirming(false)}>Cancel</button>
                <button type="button" className="btn btn-primary" style={{ fontSize: '0.75rem' }} onClick={() => { setConfirming(false); onResearch() }}>Yes, look again</button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => (hadRun ? setConfirming(true) : onResearch())}
              disabled={busy || !canResearch}
              title="Uses DataForSEO credit"
              style={{ whiteSpace: 'nowrap', fontSize: '0.8125rem' }}
            >
              {researching ? 'Researching…' : hadRun ? 'Look again' : 'Research this market'}
            </button>
          )}
        </div>
        {/* Said plainly, because it is the one button in the wizard that costs money. */}
        <p style={{ fontSize: '0.6875rem', color: 'var(--text-faint)', margin: '6px 0 0', lineHeight: 1.5 }}>
          {hadRun
            ? `Last researched ${researchedOn ?? 'earlier'}, and refreshed by itself once a month. Looking again spends DataForSEO credit now: it saves your answers, then replaces the unticked ideas with a fresh search from these terms.`
            : 'Research spends DataForSEO credit, so it runs only when you press the button. It saves your answers so far first, because it searches from them. After that it refreshes by itself once a month.'}
        </p>
      </div>

      {outcome && (
        <div
          role={outcome.tone === 'error' ? 'alert' : 'status'}
          style={{
            padding: '0.625rem 0.875rem', borderRadius: 8, marginBottom: 12,
            fontSize: '0.8125rem', lineHeight: 1.45, color: 'var(--text-primary)',
            background: `var(--${OUTCOME_TONE[outcome.tone]}-subtle)`,
            border: `1px solid var(--${OUTCOME_TONE[outcome.tone]})`,
          }}
        >
          {outcome.text}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 16 }}>
        {/* Keyword ideas — choosing is the work, so it leads and gets the full width */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '0.85rem 1rem' }}>
          <div style={{ fontWeight: 600, fontSize: '0.8125rem', color: 'var(--text-primary)', marginBottom: 8 }}>
            Search terms worth pursuing
          </div>
          {researching && (
            <p role="status" style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', margin: '0 0 8px' }}>
              Looking at this market — usually 20–40 seconds.
            </p>
          )}
          {phase === 'loading' && !research ? (
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-faint)', margin: 0 }}>Loading the saved list…</p>
          ) : keywords.length === 0 ? (
            !researching && (
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', margin: 0 }}>
                Nothing researched yet. Press <strong>Research this market</strong> to look.
              </p>
            )
          ) : (
            // Stays mounted through a run, so ticks not yet saved survive it.
            <KeywordResearchPanel
              clientId={clientId}
              keywords={panelKeywords}
              geoWords={geoWords}
              place={place}
              busy={busy}
              onChanged={onPicksSaved}
              onDirtyChange={onPicksDirty}
            />
          )}
        </div>

        {/* Competing sites */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '0.75rem 1rem', background: 'var(--bg-subtle)', fontWeight: 600, fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
            Competing sites{place ? ` in ${place}` : ''}
          </div>
          <div style={{ padding: '0.875rem 1rem' }}>
            {researching ? (
              <LoadingRow label="Finding competing sites…" />
            ) : competitors.length === 0 && localPack.length === 0 ? (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)', lineHeight: 1.5 }}>
                {/* Competing sites come back from a run and are not stored, so a list read from
                    storage has none to show. That is not the same as a run that found none. */}
                {research?.fromRun
                  ? 'No competing sites found for these keywords. Directories and marketplaces are left out on purpose — try more specific starting keywords and look again.'
                  : hadRun
                    ? 'Competing sites are shown straight after a run, and aren’t kept. Look again to see them.'
                    : 'Shown once research has run.'}
              </div>
            ) : (
              <>
                {competitors.length > 0 && (
                  <>
                    <p style={{ fontSize: '0.6875rem', color: 'var(--text-faint)', margin: '0 0 8px', lineHeight: 1.5 }}>
                      {place
                        ? `Who a searcher in ${place} sees for the starting keywords — search results and the map pack, strongest first.`
                        : 'Sites ranking for the starting keywords, strongest first.'}
                      {' '}The top three&apos;s own keywords join the list.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {competitors.map((c, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--blue)', flexShrink: 0 }} />
                          <a href={`https://${c}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', fontFamily: 'monospace', textDecoration: 'none' }}>{c}</a>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {localPack.length > 0 && (
                  <div style={{ marginTop: competitors.length ? 12 : 0 }}>
                    <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 6 }}>
                      Top rated in the map pack
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {localPack.map((p, i) => (
                        <div key={i} style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', display: 'flex', gap: 6, alignItems: 'baseline' }}>
                          {p.domain
                            ? <a href={`https://${p.domain}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-primary)', textDecoration: 'none' }}>{p.title}</a>
                            : <span>{p.title}</span>}
                          {p.rating != null && (
                            <span style={{ fontSize: '0.6875rem', color: 'var(--text-faint)' }}>
                              ★ {p.rating.toFixed(1)}{p.votes != null ? ` (${p.votes.toLocaleString()})` : ''}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

    </div>
  )
}

/** Outcome tone → the theme colour family it is drawn in. */
const OUTCOME_TONE: Record<ResearchOutcome['tone'], 'green' | 'amber' | 'red'> = {
  success: 'green',
  warning: 'amber',
  error:   'red',
}

function LoadingRow({ label }: { label: string }) {
  return (
    <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
      <span aria-hidden style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
      {label}
    </div>
  )
}

// ─── Step 8: Ready ────────────────────────────────────────────────────────────

function StepReady({ clientName, brand, schedule, pagesCount, hasGsc, hasResearch, saving, saveMsg, onSave, onSaveAndGenerate }: {
  clientName: string
  brand: BrandDna
  schedule: Schedule
  pagesCount: number
  hasGsc: boolean
  hasResearch: boolean
  saving: boolean
  saveMsg: string
  onSave: () => void
  onSaveAndGenerate: () => void
}) {
  const freqLabel = FREQ_OPTIONS.find(f => f.id === schedule.frequency)?.label ?? schedule.frequency

  const summaryRows = [
    { label: 'Frequency',     value: freqLabel },
    { label: 'Publish time',  value: schedule.publishTime },
    { label: 'Sitemap pages', value: pagesCount > 0 ? String(pagesCount) : '—' },
  ]

  const statusChecks = [
    { label: 'Business profile',      ok: !!brand.business_background },
    { label: 'Google Search Console', ok: hasGsc },
    { label: 'Keyword research', ok: hasResearch },
    { label: 'Sitemap',       ok: pagesCount > 0 },
  ]

  return (
    <div>
      <StepTitle>Setup complete!</StepTitle>
      <StepSub>{clientName} is ready for AI content generation.</StepSub>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '1rem' }}>
          <div style={{ fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', marginBottom: 10 }}>Schedule Summary</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {summaryRows.map(r => (
              <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>{r.label}</span>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '1rem' }}>
          <div style={{ fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', marginBottom: 10 }}>What we have for this client</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {statusChecks.map(c => (
              <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem' }}>
                <span style={{ width: 18, height: 18, borderRadius: '50%', background: c.ok ? 'var(--green-subtle)' : 'var(--bg-subtle)', color: c.ok ? 'var(--green)' : 'var(--text-faint)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.625rem', flexShrink: 0, fontWeight: 700 }}>
                  {c.ok ? '✓' : '—'}
                </span>
                <span style={{ color: c.ok ? 'var(--text-primary)' : 'var(--text-faint)' }}>{c.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {saveMsg && (
        <p style={{ fontSize: '0.8125rem', color: 'var(--red)', marginBottom: 12 }}>{saveMsg}</p>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={onSave}
          disabled={saving}
          className="btn btn-secondary"
          style={{ fontSize: '0.875rem', flex: 1 }}
        >
          {saving ? 'Saving…' : 'Save Setup'}
        </button>
        <button
          onClick={onSaveAndGenerate}
          disabled={saving}
          className="btn btn-primary"
          style={{ fontSize: '0.875rem', flex: 2 }}
        >
          {saving ? 'Saving…' : 'Save & Generate First Topics'}
        </button>
      </div>
    </div>
  )
}

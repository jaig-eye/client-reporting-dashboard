'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

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
  difficulty: number | null
  intent:     string | null
  source?:    string | null
}

interface ResearchData {
  keywords:     KeywordResult[]
  competitors:  string[]
  /** False when the client has no DataForSEO connection — the pool is then database-only. */
  connected:    boolean
  reason?:      string
  discovered?:  number
  cost?:        number
  researchedAt?: string | null
}

interface Props {
  clientId:   string
  clientName: string
  onComplete: () => void
}

const TOTAL_STEPS = 9

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
  const [researchDone,   setResearchDone]   = useState(false)

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

  /**
   * Run the real research for this client.
   *
   * POST because it spends: this is the DataForSEO discovery topic selection would otherwise buy
   * later, moved to where somebody is watching. What it stores is what generation reads, so the
   * first content run reuses this rather than researching again.
   *
   * Brand answers and foundational keywords are saved first — the research reads services,
   * geography and the seed terms from content_settings, so an unsaved wizard would research the
   * wrong business.
   */
  /**
   * Seed the foundational keywords from the services once, when there is nothing to lose.
   *
   * The services are already used as research seeds either way — this only puts them in front of
   * the operator so they can be corrected before anything is spent, rather than being applied
   * invisibly. Runs only while the box is untouched and empty, so a saved value and anything
   * typed by hand both survive; clearing the box deliberately leaves it cleared.
   */
  const seedsPrefilled = useRef(false)
  useEffect(() => {
    if (seedsPrefilled.current || foundationalKeywords.trim()) return
    const fromServices = brand.services
      .split(/[,;\n]+/).map(v => v.trim()).filter(v => v.length > 2).slice(0, 12)
    if (fromServices.length === 0) return
    seedsPrefilled.current = true
    setFoundationalKeywords(fromServices.join(', '))
  }, [brand.services])

  // Re-entrancy guard. Deliberately a ref, not `researchDone`: that is the "finished" flag the
  // step reads to stop showing a spinner, and using one value for both made the spinner
  // unreachable — it was set before the awaits, so the panel rendered its empty state while the
  // request was still in flight.
  const researchStarted = useRef(false)

  useEffect(() => {
    if (step !== 7 || researchStarted.current) return
    researchStarted.current = true
    void (async () => {
      try {
        // Read at call time from the render that reached this step, so it saves what the
        // operator actually entered. An earlier version wrapped this in useCallback keyed on
        // [clientId, researchDone], which froze the first render's saveSettings and wrote the
        // wizard's INITIAL state over the loaded profile — blanking brand answers, resetting the
        // schedule and moving schedule_start_date to today — and then researched the settings it
        // had just erased.
        await saveSettings(false)
        const res  = await fetch('/api/admin/content/keyword-research', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ client_id: clientId }),
        })
        const data = await res.json() as ResearchData
        setResearch(res.ok ? data : { keywords: [], competitors: [], connected: false, reason: 'Research failed' })
      } catch {
        setResearch({ keywords: [], competitors: [], connected: false, reason: 'Research failed' })
      } finally {
        setResearchDone(true)
      }
    })()
    // saveSettings and clientId are read inside the async body from this render's closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const [rerunning, setRerunning] = useState(false)

  /**
   * Look again, with the seeds as they are now. Spends — this is the deliberate re-run the
   * automatic one is not — and rebuilds the pool rather than adding to it, so a corrected seed
   * list produces a corrected list, not the old list plus a few extras.
   */
  async function rerunResearch() {
    if (rerunning) return
    setRerunning(true)
    try {
      await saveSettings(false)
      const res  = await fetch('/api/admin/content/keyword-research', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ client_id: clientId, force: true }),
      })
      const data = await res.json() as ResearchData
      setResearch(res.ok ? data : { keywords: [], competitors: [], connected: false, reason: 'Research failed' })
    } catch {
      setResearch({ keywords: [], competitors: [], connected: false, reason: 'Research failed' })
    } finally {
      setRerunning(false)
      setResearchDone(true)
    }
  }

  /** "Not this one." Gone from the list now, and from every read of the pool once the server agrees. */
  async function dismissKeyword(keyword: string) {
    setResearch(prev => prev ? { ...prev, keywords: prev.keywords.filter(k => k.keyword !== keyword) } : prev)
    try {
      await fetch('/api/admin/content/keyword-research', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ client_id: clientId, keyword, dismissed: true }),
      })
    } catch { /* optimistic; it will still be in the pool next time, and can be dismissed again */ }
  }

  async function saveSettings(wizardCompleted: boolean) {
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
        // Seeds for research, not a content plan — see migration 222.
        foundational_keywords: foundationalKeywords
          .split(/[,;\n]+/).map(v => v.trim()).filter(Boolean).slice(0, 25),
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
        wizard_completed:               wizardCompleted,
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

  function next() { setStep(s => Math.min(s + 1, TOTAL_STEPS)) }
  function back() { setStep(s => Math.max(s - 1, 1)) }

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
              foundationalKeywords={foundationalKeywords}
              setFoundationalKeywords={setFoundationalKeywords}
              onSeedsEdited={() => { seedsPrefilled.current = true }}
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
              done={researchDone}
              seeds={foundationalKeywords}
              setSeeds={v => { seedsPrefilled.current = true; setFoundationalKeywords(v) }}
              onRerun={rerunResearch}
              rerunning={rerunning}
              onDismiss={dismissKeyword}
            />
          )}
          {step === 9 && (
            <StepReady
              clientName={clientName}
              brand={brand}
              schedule={schedule}
              pagesCount={pages.length}
              hasGsc={hasGsc ?? false}
              hasResearch={research?.connected ?? false}
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
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
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
            <button
              onClick={next}
              className="btn btn-primary"
              style={{ fontSize: '0.875rem' }}
            >
              {step === 7 ? 'Skip →' : 'Continue →'}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
        {label}
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
        <div style={{ padding: '0.875rem 1rem', borderRadius: 8, background: '#fef3c7', border: '1px solid #fde68a', marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: '0.8125rem', color: '#92400e', marginBottom: 3 }}>Google Search Console not connected</div>
          <div style={{ fontSize: '0.75rem', color: '#92400e', lineHeight: 1.5 }}>
            Topic suggestions will be less precise without real keyword data. Connect GSC in Data Connections for best results.
          </div>
        </div>
      )}

      {wpUrl && (
        <div style={{ padding: '0.875rem 1rem', borderRadius: 8, background: '#f0fdf4', border: '1px solid #86efac', marginBottom: 8 }}>
          <div style={{ fontWeight: 600, fontSize: '0.8125rem', color: '#166534', marginBottom: 2 }}>WordPress connected</div>
          <div style={{ fontSize: '0.75rem', color: '#166534' }}>{wpUrl}</div>
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
          border: '2px solid #86efac',
          background: '#f0fdf4',
          display: 'flex', alignItems: 'center', gap: 16,
          animation: 'wp-slide-in 0.35s ease',
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%', background: '#16a34a', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <polyline points="5,13 9,17 19,7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: '#166534' }}>Connected</div>
            <div style={{ fontSize: '0.8125rem', color: '#166534', opacity: 0.8, marginTop: 2 }}>{wpUrl}</div>
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
            border: '2px solid #86efac',
            background: '#f0fdf4',
            display: 'flex', alignItems: 'center', gap: 16,
            animation: 'wp-check-in 0.4s cubic-bezier(0.34,1.56,0.64,1)',
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%', background: '#16a34a', flexShrink: 0,
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
              <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: '#166534' }}>WordPress connected!</div>
              <div style={{ fontSize: '0.8125rem', color: '#166534', opacity: 0.8, marginTop: 2 }}>{siteUrlInput.trim().replace(/\/$/, '')}</div>
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
            <div style={{ padding: '0.625rem 0.875rem', borderRadius: 6, background: '#fee2e2', color: '#dc2626', fontSize: '0.8125rem', marginBottom: 16 }}>
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

function StepBrandAnalysis({ analyzeUrl, setAnalyzeUrl, onAnalyze, analyzing, analyzeMsg, brand, setBrand, brandLoaded, foundationalKeywords, setFoundationalKeywords, onSeedsEdited }: {
  analyzeUrl: string
  setAnalyzeUrl: (v: string) => void
  onAnalyze: () => void
  analyzing: boolean
  analyzeMsg: string
  brand: BrandDna
  setBrand: (b: BrandDna) => void
  brandLoaded: boolean
  foundationalKeywords: string
  setFoundationalKeywords: (v: string) => void
  /** Marks the seeds as operator-owned so the services pre-fill never runs again. */
  onSeedsEdited: () => void
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
          <Field label="Business Background">
            <textarea value={brand.business_background} onChange={e => setBrand({ ...brand, business_background: e.target.value })} style={taStyle} />
          </Field>
          <Field label="Services">
            <input type="text" value={brand.services} onChange={e => setBrand({ ...brand, services: e.target.value })} style={inputStyle} placeholder="Plumbing, HVAC, Electrical" />
          </Field>
          <Field label="Target Audience">
            <input type="text" value={brand.target_audience} onChange={e => setBrand({ ...brand, target_audience: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="Foundational Keywords">
            <input
              type="text"
              value={foundationalKeywords}
              onChange={e => { onSeedsEdited(); setFoundationalKeywords(e.target.value) }}
              style={inputStyle}
              placeholder="mobile detailing, ceramic coating, paint correction"
            />
            <p style={{ fontSize: '0.6875rem', color: 'var(--text-faint)', marginTop: 4, lineHeight: 1.5 }}>
              Terms this business should be found for. Used to widen keyword research — they are a
              starting point, not a content plan, and the research can rank other opportunities above them.
            </p>
          </Field>

          <Field label="Geographic Focus">
            <input type="text" value={brand.geographic_focus} onChange={e => setBrand({ ...brand, geographic_focus: e.target.value })} style={inputStyle} placeholder="Austin, TX" />
          </Field>
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
      <StepSub>How often should this client&apos;s posts be published? You can change this later in the Schedule tab.</StepSub>

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
              background: schedule.frequency === opt.id ? '#eff6ff' : 'var(--bg-surface)',
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
            <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>Uses DALL-E to create a featured image for each post</div>
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
        <span style={{ marginLeft: 10, verticalAlign: 'middle', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 999, background: '#fef3c7', color: '#92400e' }}>
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
        Press Continue. This step saves nothing yet.
      </p>
    </div>
  )
}

// --- Step 7: Research --------------------------------------------------------

function StepResearch({ research, done, seeds, setSeeds, onRerun, rerunning, onDismiss }: {
  research:  ResearchData | null
  done:      boolean
  seeds:     string
  setSeeds:  (v: string) => void
  onRerun:   () => void
  rerunning: boolean
  onDismiss: (keyword: string) => void
}) {
  const busy = !done || rerunning
  const sourceLabel: Record<string, string> = { dataforseo: 'DataForSEO', ahrefs: 'Ahrefs', google_ads: 'Google Ads' }
  return (
    <div>
      <StepTitle>Researching your market</StepTitle>
      <StepSub>
        Keyword opportunities and competing sites for this client. Remove anything that is not this
        business, or change the seed terms and look again.
      </StepSub>

      {/* Seeds + re-run: the two things an operator can do about a bad list */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '0.75rem 1rem', marginBottom: 12, background: 'var(--bg-subtle)' }}>
        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
          Seed terms
        </label>
        <p style={{ fontSize: '0.6875rem', color: 'var(--text-faint)', margin: '0 0 6px', lineHeight: 1.5 }}>
          What this business should be found for. Research widens out from these; results that share
          none of their words are dropped. They do not become topics on their own.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <textarea
            className="input"
            rows={2}
            value={seeds}
            onChange={e => setSeeds(e.target.value)}
            placeholder="permanent outdoor lighting, landscape lighting installation, christmas light installers"
            style={{ flex: 1, resize: 'vertical', fontSize: '0.8125rem' }}
            disabled={busy}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={onRerun}
            disabled={busy || !seeds.trim()}
            title="Clears the current candidates and researches again from these seeds. Costs a few cents."
            style={{ whiteSpace: 'nowrap', fontSize: '0.8125rem' }}
          >
            {rerunning ? 'Researching…' : 'Re-run research'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {/* Keywords panel */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '0.75rem 1rem', background: 'var(--bg-subtle)', fontWeight: 600, fontSize: '0.8125rem', color: 'var(--text-primary)', display: 'flex', justifyContent: 'space-between' }}>
            <span>Keyword Research</span>
            {done && !rerunning && research && research.keywords.length > 0 && (
              <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>{research.keywords.length} shown</span>
            )}
          </div>
          <div style={{ padding: '0.875rem 1rem' }}>
            {busy ? (
              <StatusRow label={rerunning ? 'Researching again from the new seeds…' : 'Researching the market…'} status="loading" />
            ) : !research?.connected ? (
              <div style={{ fontSize: '0.75rem', color: '#92400e', background: '#fef3c7', padding: '0.625rem', borderRadius: 6, lineHeight: 1.5 }}>
                No DataForSEO connection for this client, so this is built from ad and Ahrefs data
                already in the dashboard. Connect DataForSEO for volumes, difficulty and competitors.
              </div>
            ) : research.keywords.length === 0 ? (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>
                {research.reason ?? 'No keyword data found.'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 300, overflowY: 'auto' }}>
                {research.keywords.slice(0, 60).map(kw => (
                  <div key={kw.keyword} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={kw.keyword}>
                        {kw.keyword}
                      </div>
                      <div style={{ fontSize: '0.625rem', color: 'var(--text-faint)', display: 'flex', gap: 6 }}>
                        {kw.intent && <span>{kw.intent}</span>}
                        {kw.source && <span>{sourceLabel[kw.source] ?? kw.source}</span>}
                      </div>
                    </div>
                    {kw.volume != null && (
                      <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {kw.volume.toLocaleString()}/mo
                      </span>
                    )}
                    {kw.difficulty != null && (
                      <span style={{ fontSize: '0.6875rem', padding: '1px 6px', borderRadius: 999, whiteSpace: 'nowrap',
                        background: kw.difficulty <= 30 ? '#dcfce7' : kw.difficulty <= 60 ? '#fef3c7' : '#fee2e2',
                        color:      kw.difficulty <= 30 ? '#166534' : kw.difficulty <= 60 ? '#92400e' : '#991b1b' }}>
                        KD {Math.round(kw.difficulty)}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onDismiss(kw.keyword)}
                      title="Not this business. Removes it from the candidates for good."
                      aria-label={`Dismiss ${kw.keyword}`}
                      style={{ border: 'none', background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer', fontSize: '0.875rem', lineHeight: 1, padding: '0 2px' }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            {done && !rerunning && research && (
              <div style={{ fontSize: '0.6875rem', color: 'var(--text-faint)', marginTop: 8, lineHeight: 1.5 }}>
                {research.discovered != null && (
                  <>{research.discovered.toLocaleString()} candidate{research.discovered === 1 ? '' : 's'} found
                  {research.cost != null && research.cost > 0 ? ` · $${research.cost.toFixed(2)}` : ''}. </>
                )}
                {research.reason && research.keywords.length > 0 ? `${research.reason}. ` : ''}
                Content generation reads this pool for the next 30 days.
              </div>
            )}
          </div>
        </div>

        {/* Competitors panel */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '0.75rem 1rem', background: 'var(--bg-subtle)', fontWeight: 600, fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
            Competitor Analysis
          </div>
          <div style={{ padding: '0.875rem 1rem' }}>
            {busy ? (
              <StatusRow label="Finding competitors…" status="loading" />
            ) : (research?.competitors ?? []).length === 0 ? (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)', lineHeight: 1.5 }}>
                {research?.connected
                  ? (research.reason
                      ? 'Competitors are only listed on a fresh run — re-run research to see them.'
                      : 'DataForSEO found no competing domains it could name for this site. Directories and marketplaces are excluded on purpose; a site with little search footprint may not have overlapping rivals in the index yet.')
                  : 'Connect DataForSEO for this client to see who they compete with.'}
              </div>
            ) : (
              <>
                <p style={{ fontSize: '0.6875rem', color: 'var(--text-faint)', margin: '0 0 8px', lineHeight: 1.5 }}>
                  Sites that rank for the same searches, by overlap. Their ranking keywords are part of the pool.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {research!.competitors.map((c, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6', flexShrink: 0 }} />
                      <a href={`https://${c}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', fontFamily: 'monospace', textDecoration: 'none' }}>{c}</a>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {done && !rerunning && (
        <div style={{ padding: '0.75rem 1rem', borderRadius: 8, background: '#f0fdf4', border: '1px solid #86efac', fontSize: '0.8125rem', color: '#166534' }}>
          Research complete. Topic selection reads these candidates alongside Search Console, Ads and Ahrefs.
        </div>
      )}
    </div>
  )
}

function StatusRow({ label, status }: { label: string; status: 'loading' | 'done' | 'error' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
      {status === 'loading' && <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>}
      {status === 'done'    && <span style={{ color: '#16a34a' }}>✓</span>}
      {status === 'error'   && <span style={{ color: '#dc2626' }}>✗</span>}
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
    { label: 'Brand DNA',     ok: !!brand.business_background },
    { label: 'GSC Connected', ok: hasGsc },
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
          <div style={{ fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', marginBottom: 10 }}>Data Sources</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {statusChecks.map(c => (
              <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem' }}>
                <span style={{ width: 18, height: 18, borderRadius: '50%', background: c.ok ? '#dcfce7' : '#f3f4f6', color: c.ok ? '#16a34a' : '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.625rem', flexShrink: 0, fontWeight: 700 }}>
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

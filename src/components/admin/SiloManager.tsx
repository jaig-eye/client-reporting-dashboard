'use client'

// Priority topics: how the team steers a client's content. "We want a batch of commercial
// landscaping posts" is a set of keywords; each one becomes a post, and the set takes the client's
// next open publish dates ahead of the usual topic picks until its keywords run out.
//
// Stored as content_silos and content_silo_keywords, and still called silos in the API and the
// database. The UI stopped calling them "Topic Silos" because nobody steering a batch of posts thinks
// in pillar-cluster terms, and the old section — collapsed at the very bottom of the Pipeline — was
// the opposite of what a priority is. It sits above the calendar now, open, so a batch someone just
// added is the first thing they see coming back.
//
// What it says, and why it says it that way (see PrioritySetCard for the card itself):
//
//   - Which set goes next: the API returns sets in the order the topic run takes them (priority,
//     then oldest first), and the first that is a hub or still has keywords waiting takes the date.
//   - When: the next open date from the API, and the day its topic gets picked. A set added today
//     is usually picked weeks before it publishes, when that date comes into the planning window —
//     never "now" unless it really is.
//   - "Pick topics now" only where it can do something, and it reports what happened — including
//     nothing. The old "Generate Topics" button toasted "Topics are generating" whatever the server
//     answered, including when every date was already taken.
//
// Self-contained: owns its data, the add/edit modal, the archive confirm and a local toast.

import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSiloSounds } from '@/lib/useSiloSounds'
import PrioritySetCard, { type CardNotice } from '@/components/admin/PrioritySetCard'
import PrioritySetModal, { draftFrom, type SetDraft } from '@/components/admin/PrioritySetModal'
import {
  fmtPublishDay, inRunOrder, nextUpId, parseKeywordLines,
  type LinkTask, type NextSlot, type PrioritySet, type SetKeyword,
} from '@/components/admin/priorityTopics'

type Modal = { mode: 'create' } | { mode: 'edit'; set: PrioritySet }
/** The anchor the Content page's overview links to. */
const SECTION_ID = 'priority-topics'
const ACTIVE_TOPIC = ['pending', 'approved', 'generating', 'generated', 'scheduled']

async function readError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({})) as { error?: string }
  return body.error ?? `${fallback} (HTTP ${res.status})`
}

export default function SiloManager({ clientId, onGenerated }: {
  clientId: string
  /** After topics are picked here, so the calendar below reloads. */
  onGenerated?: () => void
}) {
  const [sets,      setSets]      = useState<PrioritySet[] | null>(null)
  const [slot,      setSlot]      = useState<NextSlot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [keywords,  setKeywords]  = useState<Record<string, SetKeyword[] | null>>({})
  const [kwErrors,  setKwErrors]  = useState<Record<string, string | null>>({})
  const [notices,   setNotices]   = useState<Record<string, CardNotice | null>>({})
  const [picking,   setPicking]   = useState<Record<string, boolean>>({})
  const [modal,     setModal]     = useState<Modal | null>(null)
  const [saving,    setSaving]    = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [archiving, setArchiving] = useState<{ set: PrioritySet; active: number } | null>(null)
  const [toast,     setToast]     = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null)
  const { playSiloCreated, playClusterAdded, playTopicGenerated } = useSiloSounds(true)
  const headingId = useId()

  const showToast = useCallback((msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 4200)
  }, [])
  const notify = (id: string, n: CardNotice | null) => setNotices(p => ({ ...p, [id]: n }))

  const loadKeywords = useCallback((id: string) => {
    setKwErrors(p => ({ ...p, [id]: null }))
    fetch(`/api/admin/content/silos/${id}/keywords`)
      .then(async r => { if (!r.ok) throw new Error(await readError(r, 'Couldn’t load')); return r.json() })
      .then((d: { keywords?: SetKeyword[] }) => setKeywords(p => ({
        ...p,
        // Only the queue — `selected` — which is what the counts and the topic run go by.
        [id]: (d.keywords ?? []).filter(k => k.selected !== false),
      })))
      .catch(e => setKwErrors(p => ({ ...p, [id]: e instanceof Error ? e.message : 'Couldn’t load' })))
  }, [])

  const loadSets = useCallback(async (withKeywords = true) => {
    setLoadError(null)
    try {
      const r = await fetch(`/api/admin/content/silos?client_id=${clientId}`)
      if (!r.ok) throw new Error(await readError(r, 'Couldn’t load'))
      const d = await r.json() as { silos?: PrioritySet[]; schedule?: NextSlot | null }
      const list = d.silos ?? []
      setSets(list)
      setSlot(d.schedule ?? null)
      if (withKeywords) list.forEach(s => loadKeywords(s.id))
    } catch (e) {
      // Never stand in an empty list for a failed read: "nothing prioritised" would invite adding
      // a batch that is already there.
      setLoadError(e instanceof Error ? e.message : 'Couldn’t load')
    }
  }, [clientId, loadKeywords])

  useEffect(() => { void loadSets() }, [loadSets])

  // Arriving from the Content page's overview (…&subtab=pipeline#priority-topics): bring the
  // section into view once it has loaded, since the calendar above it can still be filling in when
  // the browser does its own jump to the anchor.
  const [arrived, setArrived] = useState(false)
  useEffect(() => {
    if (arrived || sets === null || typeof window === 'undefined') return
    setArrived(true)
    if (window.location.hash === `#${SECTION_ID}`) {
      document.getElementById(SECTION_ID)?.scrollIntoView({ block: 'start' })
    }
  }, [sets, arrived])

  // ── Order: what goes next first, then sets waiting for keywords, then finished ones ────────
  const nextId = useMemo(() => nextUpId(sets ?? []), [sets])
  const ordered = useMemo(() => {
    // Oldest first, as the topic run takes them. A set with a main page ends like any other.
    const list = inRunOrder(sets ?? [])
    const live  = list.filter(s => s.keywordUnused > 0)
    const empty = list.filter(s => s.keywordTotal === 0)
    const done  = list.filter(s => s.keywordTotal > 0 && s.keywordUnused === 0)
    return [...live, ...empty, ...done]
  }, [sets])
  const next = (sets ?? []).find(s => s.id === nextId) ?? null

  // ── Actions ─────────────────────────────────────────────────────────────
  async function addKeywords(set: PrioritySet, list: string[]): Promise<boolean> {
    notify(set.id, null)
    try {
      const r = await fetch(`/api/admin/content/silos/${set.id}/keywords`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keywords: list }),
      })
      if (!r.ok) throw new Error(await readError(r, 'Couldn’t add them'))
      const d = await r.json() as { added?: number; skipped?: number }
      const added = d.added ?? 0, skipped = d.skipped ?? 0
      notify(set.id, added > 0
        ? { tone: 'success', text: `Added ${added} keyword${added === 1 ? '' : 's'}.${skipped ? ` ${skipped} ${skipped === 1 ? 'was' : 'were'} already in this set.` : ''}` }
        : { tone: 'neutral', text: 'Those are all already in this set.' })
      if (added > 0) playClusterAdded()
      loadKeywords(set.id); void loadSets(false)
      return true
    } catch (e) {
      notify(set.id, { tone: 'error', text: e instanceof Error ? e.message : 'Couldn’t add them' })
      return false
    }
  }

  async function removeKeyword(set: PrioritySet, k: SetKeyword) {
    notify(set.id, null)
    const r = await fetch(`/api/admin/content/silos/${set.id}/keywords/${k.id}`, { method: 'DELETE' }).catch(() => null)
    if (r?.ok) {
      setKeywords(p => ({ ...p, [set.id]: (p[set.id] ?? []).filter(x => x.id !== k.id) }))
      notify(set.id, { tone: 'neutral', text: `Removed “${k.keyword}”.` })
    } else {
      // 409: it was picked between loading the list and pressing ×. The server's sentence says so.
      notify(set.id, { tone: 'error', text: r ? await readError(r, `Couldn’t remove “${k.keyword}”`) : `Couldn’t remove “${k.keyword}”.` })
    }
    loadKeywords(set.id); void loadSets(false)
  }

  async function pickNow(set: PrioritySet) {
    notify(set.id, null)
    setPicking(p => ({ ...p, [set.id]: true }))
    try {
      // No weeks_ahead: the client's own planning window decides which dates are open.
      const r = await fetch('/api/admin/content/calendar/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, silo_id: set.id }),
      })
      if (!r.ok) throw new Error(await readError(r, 'Couldn’t pick topics'))
      const d = await r.json() as { queued?: boolean; slots?: string[]; dates?: number; reason?: string }
      if (!d.queued) {
        notify(set.id, { tone: 'warning', text: nothingToPick(d.reason, slot) })
        return
      }
      const dates = Array.from(new Set(d.slots ?? [])).sort()
      const n = d.dates ?? dates.length
      playTopicGenerated()
      // It fills at most one date per keyword waiting, so fewer dates than are open is expected.
      const capped = set.keywordUnused > 0 && n >= set.keywordUnused
        ? ` That’s every keyword it has waiting.`
        : ''
      notify(set.id, {
        tone: 'success',
        text: (n === 1 && dates[0]
          ? `Picking a topic for ${fmtPublishDay(dates[0])} from this set.`
          : `Picking topics for ${n} open dates from this set${dates[0] ? `, starting ${fmtPublishDay(dates[0])}` : ''}.`)
          + `${capped} They show in the calendar in a minute or two.`,
      })
      // Picking runs in the background; look again once it has had time to land.
      setTimeout(() => { void loadSets(); onGenerated?.() }, 4000)
    } catch (e) {
      notify(set.id, { tone: 'error', text: e instanceof Error ? e.message : 'Couldn’t pick topics' })
    } finally {
      setPicking(p => ({ ...p, [set.id]: false }))
    }
  }

  async function save(draft: SetDraft) {
    if (!modal) return
    setSaving(true); setModalError(null)
    const fields = {
      name:                  draft.name.trim(),
      description:           draft.notes.trim() || null,
      hub_page_url:          draft.hubUrl.trim() || null,
      hub_page_title:        draft.hubTitle.trim() || null,
    }
    try {
      if (modal.mode === 'create') {
        const { keywords: list } = parseKeywordLines(draft.keywords)
        const r = await fetch('/api/admin/content/silos', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, content_type: 'blog', ...fields, keywords: list }),
        })
        if (!r.ok) throw new Error(await readError(r, 'Couldn’t add the set'))
        // 207: the set saved but its keywords did not. r.ok is true for 207, so this has to be
        // looked for, or the failure hides behind "added" and the set sits empty with no reason.
        const d = await r.json().catch(() => ({})) as { warning?: string; keywordsAdded?: number }
        setModal(null); playSiloCreated(); void loadSets()
        if (d.warning) showToast(`${fields.name} was added, but its keywords weren’t: ${d.warning}`, 'error')
        else {
          const n = d.keywordsAdded ?? 0
          showToast(n > 0 ? `Added “${fields.name}” with ${n} keyword${n === 1 ? '' : 's'}.` : `Added “${fields.name}”. Add keywords to it to start.`)
        }
      } else {
        const r = await fetch(`/api/admin/content/silos?id=${modal.set.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields),
        })
        if (!r.ok) throw new Error(await readError(r, 'Couldn’t save'))
        setModal(null); void loadSets(false)
        showToast(`Saved “${fields.name}”.`)
      }
    } catch (e) {
      setModalError(e instanceof Error ? e.message : 'Couldn’t save')
    } finally {
      setSaving(false)
    }
  }

  async function requestArchive(set: PrioritySet) {
    // Topics this set already put in the pipeline stay there; say so before archiving. Asked for by
    // set, and still checked by set here: a server that ignored the filter used to count every
    // topic the client had, which told people a set with one topic in the pipeline had nine.
    const r = await fetch(`/api/admin/content/topics?client_id=${clientId}&silo_id=${set.id}`).catch(() => null)
    const list = r?.ok ? await r.json().catch(() => []) as Array<{ status: string; silo_id?: string | null }> : []
    const active = Array.isArray(list) ? list.filter(t => t.silo_id === set.id && ACTIVE_TOPIC.includes(t.status)).length : 0
    if (active > 0) { setArchiving({ set, active }); return }
    await archive(set)
  }

  /**
   * Mark one link added (or not). Shown at once, put back if the server says no — a checklist that
   * waits on a round trip per tick is slower than the job it tracks.
   */
  async function setLinkDone(set: PrioritySet, task: LinkTask, done: boolean) {
    notify(set.id, null)
    const matches = (e: unknown) => {
      const x = (e ?? {}) as Record<string, unknown>
      return x.url === task.url && x.added_at === task.addedAt && (x.kind === 'previous' ? 'previous' : 'hub') === task.kind
    }
    const before = set.pending_links ?? []
    const optimistic = before.map(e => matches(e) ? { ...(e as object), done_at: done ? new Date().toISOString() : null } : e)
    const put = (links: unknown[]) => setSets(p => (p ?? []).map(s => s.id === set.id ? { ...s, pending_links: links } : s))
    put(optimistic)
    try {
      const r = await fetch(`/api/admin/content/silos/${set.id}/link-tasks`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: task.url, added_at: task.addedAt, kind: task.kind, done }),
      })
      if (!r.ok) throw new Error(await readError(r, 'Couldn’t save that'))
      const d = await r.json().catch(() => ({})) as { pending_links?: unknown[] }
      if (Array.isArray(d.pending_links)) put(d.pending_links)
    } catch (e) {
      put(before)
      notify(set.id, { tone: 'error', text: `Couldn’t mark that link ${done ? 'added' : 'not added'}: ${e instanceof Error ? e.message : 'try again'}` })
    }
  }

  async function archive(set: PrioritySet) {
    setArchiving(null)
    const r = await fetch(`/api/admin/content/silos?id=${set.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'archived' }),
    }).catch(() => null)
    if (!r?.ok) { showToast(r ? await readError(r, 'Couldn’t archive') : 'Couldn’t archive', 'error'); return }
    setSets(p => (p ?? []).filter(s => s.id !== set.id))
    showToast(`Archived “${set.name}”. It won’t take any more publish dates.`)
    void loadSets(false)
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <section id={SECTION_ID} className="card pt-section" data-pt-section aria-labelledby={headingId}>
      <div className="pt-section-head">
        <div>
          <h3 id={headingId} className="pt-section-title">
            Priority topics
            {sets && sets.length > 0 && <span className="pt-section-count">{sets.length}</span>}
          </h3>
          <p className="pt-section-lede">
            Keywords you want written next. Each one becomes a post, and they take the next open
            publish dates ahead of the usual topic picks.
          </p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setModalError(null); setModal({ mode: 'create' }) }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add priority topics
        </button>
      </div>

      {loadError ? (
        <div className="pt-alert" role="alert">
          <p>Couldn’t load the priority topics ({loadError}).</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadSets()}>Retry</button>
        </div>
      ) : sets === null ? (
        <div className="pt-loading" aria-busy="true" aria-label="Loading priority topics">
          <span className="skeleton" style={{ height: 14, width: '40%' }} />
          <span className="skeleton" style={{ height: 6, width: '100%' }} />
          <span className="skeleton" style={{ height: 12, width: '70%' }} />
        </div>
      ) : sets.length === 0 ? (
        <p className="pt-empty">
          Nothing is prioritized for this client. Add a batch — say, ten commercial landscaping
          keywords — and they take the next publish dates, one post each.
        </p>
      ) : (
        <div className="pt-sets">
          {ordered.map(set => (
            <PrioritySetCard
              key={set.id}
              set={set}
              keywords={keywords[set.id] ?? null}
              keywordsError={kwErrors[set.id] ?? null}
              isNext={set.id === nextId}
              aheadOf={next && set.id !== nextId && set.keywordUnused > 0
                ? { name: next.name, left: next.keywordUnused }
                : null}
              slot={slot}
              picking={!!picking[set.id]}
              notice={notices[set.id] ?? null}
              onReloadKeywords={() => loadKeywords(set.id)}
              onAddKeywords={list => addKeywords(set, list)}
              onRemoveKeyword={k => void removeKeyword(set, k)}
              onLinkDone={(task, done) => void setLinkDone(set, task, done)}
              onPickNow={() => void pickNow(set)}
              onEdit={() => { setModalError(null); setModal({ mode: 'edit', set }) }}
              onArchive={() => void requestArchive(set)}
            />
          ))}
        </div>
      )}

      {/* Dialogs go to the body: the section is a size container, and the tab around it animates
          with a transform, either of which can pin a fixed overlay to it instead of the window. */}
      {modal && createPortal(
        <PrioritySetModal
          key={modal.mode === 'edit' ? modal.set.id : 'create'}
          mode={modal.mode}
          initial={draftFrom(modal.mode === 'edit' ? modal.set : null)}
          saving={saving}
          error={modalError}
          onCancel={() => setModal(null)}
          onSave={draft => void save(draft)}
        />,
        document.body,
      )}

      {archiving && createPortal(
        <div className="pt-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setArchiving(null) }}>
          <div className="pt-modal pt-modal--small card" role="alertdialog" aria-modal="true" aria-labelledby={`${headingId}-arch`}>
            <div className="pt-modal-head">
              <h3 id={`${headingId}-arch`} className="pt-modal-title">Archive “{archiving.set.name}”?</h3>
            </div>
            <div className="pt-modal-body">
              <p className="pt-modal-lede">
                {archiving.active === 1 ? 'One topic from this set is' : `${archiving.active} topics from this set are`} still
                in the pipeline. {archiving.active === 1 ? 'It stays' : 'They stay'} there and will still be written —
                archiving only stops this set taking any more publish dates.
              </p>
            </div>
            <div className="pt-modal-foot">
              <button type="button" className="btn btn-secondary" onClick={() => setArchiving(null)} autoFocus>Keep it</button>
              <button type="button" className="btn btn-danger" onClick={() => void archive(archiving.set)}>Archive</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {toast && <div id="content-toast-container"><div className={`content-toast content-toast--${toast.type}`} role="status">{toast.msg}</div></div>}
    </section>
  )
}

/** Why "Pick topics now" found nothing, in plain words. */
function nothingToPick(reason: string | undefined, slot: NextSlot | null): string {
  if (!reason || /already have topics/i.test(reason)) {
    return slot?.picksOn
      ? `Nothing to pick yet: every date in the planning window already has a topic. The next one opens on ${fmtPublishDay(slot.picksOn)}.`
      : 'Nothing to pick: every date in the planning window already has a topic.'
  }
  if (/deliberately emptied|reopen_suppressed/i.test(reason)) {
    return 'Nothing to pick: the open dates were cleared by hand, so they stay empty.'
  }
  return reason
}

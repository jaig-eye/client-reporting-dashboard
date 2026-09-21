'use client'

import { useState, useEffect, useRef, useMemo, type ComponentType } from 'react'
import {
  PushPin, Trash, PencilSimple, X, MagnifyingGlass, LockSimple,
  NotePencil, ChatCircleText, Key, GlobeSimple, HardDrives, ShieldCheck,
  CreditCard, WarningCircle, ClockCounterClockwise, SlidersHorizontal, Megaphone, LinkSimple,
  type IconProps,
} from '@phosphor-icons/react'
import {
  NOTE_TEMPLATES,
  NOTE_TEMPLATE_LIST,
  isNoteCategory,
  noteSearchText,
  type NoteCategory,
} from '@/lib/note-templates'
import { NoteTemplateFields, NoteFieldsReadout, NoteCategoryChip, noteFieldsSummary } from './NoteTemplateFields'
import { NoteSecretInput, NoteSecretReveal } from './NoteSecretField'
import SaveStatus, { useSaveStatus } from '@/components/ui/SaveStatus'

interface NoteUser {
  name:       string
  avatar_url: string | null
}

interface Note {
  id:         string
  title:      string | null
  content:    string
  category:   string
  has_secret?: boolean
  fields:     Record<string, string> | null
  pinned:     boolean
  created_at: string
  user_id:    string | null
  updated_at: string | null
  updated_by: string | null
  users:      NoteUser | null
  editor:     NoteUser | null
}

const CATEGORY_ICONS: Record<NoteCategory, ComponentType<IconProps>> = {
  general:    NotePencil,
  contact:    ChatCircleText,
  login:      Key,
  dns:        GlobeSimple,
  hosting:    HardDrives,
  access:     ShieldCheck,
  billing:    CreditCard,
  issue:      WarningCircle,
  change:     ClockCounterClockwise,
  preference: SlidersHorizontal,
  client_update: Megaphone,
  seo_work:   LinkSimple,
}

/** How many notes the feed shows before "Show more". Searching shows everything. */
const FEED_LIMIT = 6

function templateFor(category: string) {
  return NOTE_TEMPLATES[(isNoteCategory(category) ? category : 'general') as NoteCategory]
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2)    return 'just now'
  if (mins < 60)   return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)    return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30)   return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOf(today) - startOf(d)) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return d.toLocaleDateString('en-US', {
    weekday: days < 7 ? 'long' : undefined,
    month: 'short', day: 'numeric',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  })
}

function Avatar({ name, avatarUrl }: { name: string | null; avatarUrl: string | null }) {
  const initials = name
    ? name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : '?'
  if (avatarUrl) {
    return <img src={avatarUrl} alt="" className="note-avatar" />
  }
  return <span className="note-avatar" aria-hidden>{initials}</span>
}

function sortNotes(arr: Note[]): Note[] {
  return [...arr].sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned ? 1 : -1
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({})) as { error?: string }
  return body.error || `${fallback} (HTTP ${res.status})`
}

export default function ClientNotesStream({
  clientId,
  onContactLogged,
}: {
  clientId: string
  /** Fired when a contact-log note stamps clients.last_contacted_at. */
  onContactLogged?: (isoDate: string) => void
}) {
  const [notes,    setNotes]    = useState<Note[]>([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [catFilter, setCatFilter] = useState<NoteCategory | 'all'>('all')
  const [showAll,  setShowAll]  = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)

  // Pin/delete are instant actions; they report through the shared save pattern.
  const status = useSaveStatus()

  // Composer
  const [composerOpen,  setComposerOpen]  = useState(false)
  const [draftTitle,    setDraftTitle]    = useState('')
  const [draft,         setDraft]         = useState('')
  const [draftCategory, setDraftCategory] = useState<NoteCategory>('general')
  const [draftFields,   setDraftFields]   = useState<Record<string, string>>({})
  const [draftSecret,   setDraftSecret]   = useState('')
  const [saving,        setSaving]        = useState(false)
  const [composerError, setComposerError] = useState<string | null>(null)

  // Expanded note dialog
  const [expanded,     setExpanded]     = useState<Note | null>(null)
  const [editing,      setEditing]      = useState(false)
  const [editTitle,    setEditTitle]    = useState('')
  const [editContent,  setEditContent]  = useState('')
  const [editFields,   setEditFields]   = useState<Record<string, string>>({})
  const [editSecret,   setEditSecret]   = useState('')
  // '' means "leave the stored credential alone", so clearing needs its own flag.
  const [editSecretClear, setEditSecretClear] = useState(false)
  const [editSaving,   setEditSaving]   = useState(false)
  const [editError,    setEditError]    = useState<string | null>(null)
  const [modalConfirmDelete, setModalConfirmDelete] = useState(false)

  const bodyRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fetch(`/api/admin/clients/${clientId}/notes`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((d: { notes: Note[] }) => setNotes(d.notes))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [clientId])

  // Escape closes the dialog.
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeNote() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  const draftTemplate  = NOTE_TEMPLATES[draftCategory]
  const draftHasFields = Object.values(draftFields).some(v => v.trim() !== '')
  const canSaveDraft   = draft.trim() !== '' || draftHasFields

  function resetDraft() {
    setDraft(''); setDraftTitle(''); setDraftFields({}); setDraftCategory('general'); setDraftSecret('')
    setComposerError(null)
  }

  function closeComposer() {
    resetDraft()
    setComposerOpen(false)
    bodyRef.current?.blur()
  }

  async function addNote() {
    const content = draft.trim()
    if (!canSaveDraft || saving) return
    setSaving(true)

    const cleanFields = Object.fromEntries(
      Object.entries(draftFields).filter(([, v]) => v.trim() !== ''),
    )

    const temp: Note = {
      id: `temp-${Date.now()}`,
      title:      draftTitle.trim() || null,
      content,
      category:   draftCategory,
      fields:     cleanFields,
      pinned:     false,
      created_at: new Date().toISOString(),
      user_id:    null,
      updated_at: null,
      updated_by: null,
      users:      null,
      editor:     null,
    }
    setNotes(prev => sortNotes([temp, ...prev]))
    // The secret belongs in the snapshot too, so a failed save never throws away
    // the password the user had just typed.
    const snapshot = { title: draftTitle, category: draftCategory, fields: draftFields, secret: draftSecret }
    setDraft(''); setDraftTitle(''); setDraftFields({}); setDraftSecret(''); setComposerError(null)

    try {
      const res = await fetch(`/api/admin/clients/${clientId}/notes`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          content,
          title:    snapshot.title.trim() || null,
          category: snapshot.category,
          fields:   cleanFields,
          ...(snapshot.secret ? { secret: snapshot.secret } : {}),
        }),
      })
      // The server explains exactly why (an unset CREDENTIAL_ENCRYPTION_KEY, an
      // empty note, a DB error) — surface it rather than failing silently.
      if (!res.ok) throw new Error(await readError(res, 'Could not save the note'))
      const { note, contactStampedAt } = await res.json() as { note: Note; contactStampedAt: string | null }
      setNotes(prev => sortNotes(prev.map(n => n.id === temp.id ? note : n)))
      if (contactStampedAt) onContactLogged?.(contactStampedAt)
      setComposerOpen(false)
      setDraftCategory('general')
    } catch (e) {
      setNotes(prev => prev.filter(n => n.id !== temp.id))
      setDraft(content)
      setDraftTitle(snapshot.title)
      setDraftFields(snapshot.fields)
      setDraftSecret(snapshot.secret)
      setComposerError(e instanceof Error ? e.message : 'Could not save the note')
    } finally {
      setSaving(false)
    }
  }

  function deleteNote(id: string) {
    setConfirmingDelete(null)
    setModalConfirmDelete(false)
    if (expanded?.id === id) closeNote()
    void status.run(async () => {
      const snapshot = notes.find(n => n.id === id)
      setNotes(prev => prev.filter(n => n.id !== id))
      const res = await fetch(`/api/admin/clients/${clientId}/notes/${id}`, { method: 'DELETE' }).catch(() => null)
      if (!res || !res.ok) {
        if (snapshot) setNotes(prev => sortNotes([snapshot, ...prev.filter(n => n.id !== id)]))
        throw new Error(res ? await readError(res, 'Could not delete the note') : 'Could not reach the server')
      }
    })
  }

  function togglePin(note: Note) {
    const next = !note.pinned
    void status.run(async () => {
      const apply = (v: boolean) => {
        setNotes(prev => sortNotes(prev.map(n => n.id === note.id ? { ...n, pinned: v } : n)))
        setExpanded(e => e && e.id === note.id ? { ...e, pinned: v } : e)
      }
      apply(next)
      const res = await fetch(`/api/admin/clients/${clientId}/notes/${note.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pinned: next }),
      }).catch(() => null)
      if (!res || !res.ok) {
        apply(!next)
        throw new Error(res ? await readError(res, 'Could not update the pin') : 'Could not reach the server')
      }
    })
  }

  async function saveEdit(note: Note) {
    const content = editContent.trim()
    const cleanFields = Object.fromEntries(
      Object.entries(editFields).filter(([, v]) => v.trim() !== ''),
    )
    if ((!content && Object.keys(cleanFields).length === 0) || editSaving) return
    setEditSaving(true)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/notes/${note.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          content,
          title:    editTitle.trim() || null,
          category: note.category,
          // Every declared field — hidden and retired ones included — round-trips
          // here, so editing never erases answers the composer no longer asks for.
          fields:   cleanFields,
          // Only send a secret when one was typed or explicitly cleared; omitting
          // the key leaves the stored credential untouched.
          ...(editSecret !== '' || editSecretClear ? { secret: editSecretClear ? '' : editSecret } : {}),
        }),
      })
      if (!res.ok) throw new Error(await readError(res, 'Could not save the note'))
      const { note: updated } = await res.json() as { note: Note }
      setNotes(prev => sortNotes(prev.map(n => n.id === note.id ? updated : n)))
      setExpanded(updated)
      setEditing(false)
      setEditError(null)
    } catch (e) {
      // Stay in edit mode so nothing typed is lost, and say why.
      setEditError(e instanceof Error ? e.message : 'Could not save the note')
    } finally {
      setEditSaving(false)
    }
  }

  function openNote(note: Note) {
    if (note.id.startsWith('temp-')) return
    setEditError(null)
    setModalConfirmDelete(false)
    setExpanded(note)
    setEditing(false)
  }

  function closeNote() {
    setExpanded(null)
    setEditing(false)
    setModalConfirmDelete(false)
  }

  function startEdit() {
    if (!expanded) return
    setEditTitle(expanded.title ?? '')
    setEditContent(expanded.content)
    setEditFields({ ...(expanded.fields ?? {}) })
    setEditSecret(''); setEditSecretClear(false)
    setEditError(null)
    setEditing(true)
  }

  // Categories that actually appear on this client, so the pill row only offers
  // filters that can return something.
  const presentCategories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const n of notes) counts.set(n.category, (counts.get(n.category) ?? 0) + 1)
    return NOTE_TEMPLATE_LIST
      .filter(t => counts.has(t.key))
      .map(t => ({ template: t, count: counts.get(t.key) ?? 0 }))
  }, [notes])

  // The pill row is hidden when fewer than two categories remain, so a filter
  // that no longer matches anything would be unclearable (deleting the last note
  // of the filtered category unmounts the only "All" button). Derive the
  // effective filter instead of trusting the stored one.
  const activeCatFilter = catFilter !== 'all' && !presentCategories.some(c => c.template.key === catFilter)
    ? 'all'
    : catFilter

  useEffect(() => {
    if (activeCatFilter !== catFilter) setCatFilter('all')
  }, [activeCatFilter, catFilter])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return notes.filter(n => {
      if (activeCatFilter !== 'all' && n.category !== activeCatFilter) return false
      if (!q) return true
      return noteSearchText(n).includes(q)
    })
  }, [notes, search, activeCatFilter])

  const isFiltering = search.trim() !== '' || activeCatFilter !== 'all'
  const visible = showAll || isFiltering ? filtered : filtered.slice(0, FEED_LIMIT)
  const hiddenCount = filtered.length - visible.length

  // Pinned notes first as their own group, then the rest grouped by day.
  const groups = useMemo(() => {
    const out: { key: string; label: string; pinned?: boolean; items: Note[] }[] = []
    const pinned = visible.filter(n => n.pinned)
    if (pinned.length) out.push({ key: 'pinned', label: 'Pinned', pinned: true, items: pinned })
    for (const n of visible.filter(x => !x.pinned)) {
      const label = dayLabel(n.created_at)
      const last = out[out.length - 1]
      if (last && !last.pinned && last.label === label) last.items.push(n)
      else out.push({ key: `day-${label}`, label, items: [n] })
    }
    return out
  }, [visible])

  const expandedTemplate = expanded ? templateFor(expanded.category) : null

  return (
    <section className="notes" aria-label="Notes">
      {/* Header: title, save status, search */}
      <div className="notes__head">
        <div className="notes__title">
          <h2 className="section-title">Notes</h2>
          {notes.length > 0 && <span className="notes__total">{notes.length}</span>}
          <SaveStatus state={status.state} error={status.error} retry={status.retry} />
        </div>
        <label className="notes__search">
          <MagnifyingGlass size={14} aria-hidden className="notes__search-icon" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search notes"
            aria-label="Search notes"
          />
        </label>
      </div>

      {/* Composer — always visible, expands on focus */}
      <div className={`note-composer${composerOpen ? ' is-open' : ''}`}>
        {composerOpen && (
          <div className="note-composer__types" role="radiogroup" aria-label="Note type">
            {NOTE_TEMPLATE_LIST.map(t => {
              const Icon = CATEGORY_ICONS[t.key]
              const on = t.key === draftCategory
              return (
                <button
                  key={t.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`note-type${on ? ' is-active' : ''}`}
                  onClick={() => {
                    setDraftCategory(t.key)
                    setDraftFields({})   // answers belong to the template that declared them
                    if (!t.hasSecret) setDraftSecret('')
                  }}
                >
                  <Icon size={14} weight={on ? 'fill' : 'regular'} aria-hidden />
                  {t.label}
                </button>
              )
            })}
          </div>
        )}

        {composerOpen && draftCategory !== 'general' && (
          <p className="note-composer__hint">{draftTemplate.hint}</p>
        )}

        {composerOpen && (
          <input
            className="note-composer__title"
            value={draftTitle}
            onChange={e => setDraftTitle(e.target.value)}
            placeholder="Title (optional)"
            aria-label="Note title"
          />
        )}

        <textarea
          ref={bodyRef}
          className="note-composer__body"
          value={draft}
          onFocus={() => setComposerOpen(true)}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void addNote() }
            if (e.key === 'Escape' && !canSaveDraft) closeComposer()
          }}
          placeholder={composerOpen ? `${draftTemplate.bodyLabel}…` : 'Write a note…'}
          aria-label="Note"
          rows={composerOpen ? 3 : 1}
        />

        {composerOpen && (
          <>
            <NoteTemplateFields
              key={draftCategory}
              template={draftTemplate}
              values={draftFields}
              onChange={(k, v) => setDraftFields(prev => ({ ...prev, [k]: v }))}
              afterEssential={draftTemplate.hasSecret && (
                <NoteSecretInput hasSecret={false} value={draftSecret} onChange={setDraftSecret} />
              )}
            />

            {composerError && <div className="note-error" role="alert">{composerError}</div>}

            <div className="note-composer__foot">
              <span className="note-composer__meta">
                {draftTemplate.stampsContact ? 'Updates Last contacted' : 'Ctrl + Enter to post'}
              </span>
              <button type="button" className="note-btn note-btn--ghost" onClick={closeComposer}>
                Cancel
              </button>
              <button
                type="button"
                className="note-btn note-btn--primary"
                onClick={() => void addNote()}
                disabled={!canSaveDraft || saving}
              >
                {saving ? 'Posting…' : 'Post'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Type filter pills — only categories this client actually has */}
      {presentCategories.length > 1 && (
        <div className="note-filters" role="toolbar" aria-label="Filter notes by type">
          <button
            type="button"
            className={`note-filter${activeCatFilter === 'all' ? ' is-active' : ''}`}
            aria-pressed={activeCatFilter === 'all'}
            onClick={() => setCatFilter('all')}
          >
            All <span className="note-filter__count">{notes.length}</span>
          </button>
          {presentCategories.map(({ template: t, count }) => {
            const on = activeCatFilter === t.key
            return (
              <button
                key={t.key}
                type="button"
                className={`note-filter${on ? ' is-active' : ''}`}
                aria-pressed={on}
                onClick={() => setCatFilter(on ? 'all' : t.key)}
              >
                {t.label} <span className="note-filter__count">{count}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Feed */}
      {loading && (
        <div className="note-feed" aria-busy="true">
          <div className="skeleton" style={{ height: 56 }} />
          <div className="skeleton" style={{ height: 56 }} />
        </div>
      )}
      {!loading && filtered.length === 0 && (
        <p className="note-empty">
          {isFiltering ? 'No notes match this filter.' : 'No notes yet — write the first one above.'}
        </p>
      )}

      {!loading && groups.length > 0 && (
        <div className="note-feed">
          {groups.map(group => (
            <div key={group.key} className="note-group">
              <div className="note-group__label">
                {group.pinned && <PushPin size={11} weight="fill" aria-hidden />}
                {group.label}
              </div>
              <ul className="note-group__list">
                {group.items.map(note => {
                  const t = templateFor(note.category)
                  const summary = noteFieldsSummary(t, note.fields)
                  const confirming = confirmingDelete === note.id
                  const pending = note.id.startsWith('temp-')
                  return (
                    <li
                      key={note.id}
                      className={`note-item${note.pinned ? ' is-pinned' : ''}${pending ? ' is-pending' : ''}`}
                    >
                      <div
                        className="note-item__main"
                        role="button"
                        tabIndex={0}
                        aria-label={`Open note${note.title ? `: ${note.title}` : ''}`}
                        onClick={() => openNote(note)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openNote(note) } }}
                      >
                        <Avatar name={note.users?.name ?? null} avatarUrl={note.users?.avatar_url ?? null} />
                        <div className="note-item__body">
                          <div className="note-item__meta">
                            <span className="note-item__author">{note.users?.name ?? 'Admin'}</span>
                            <span>{pending ? 'Posting…' : relativeTime(note.created_at)}</span>
                            {note.updated_at && <span title={`Edited by ${note.editor?.name ?? 'Admin'} ${relativeTime(note.updated_at)}`}>· edited</span>}
                            {note.category !== 'general' && <NoteCategoryChip template={t} />}
                            {note.has_secret && (
                              <span className="note-item__lock" title="Holds an encrypted password">
                                <LockSimple size={11} weight="bold" aria-hidden /> Password
                              </span>
                            )}
                          </div>
                          {note.title && <p className="note-item__title">{note.title}</p>}
                          {note.content
                            ? <p className="note-item__preview">{note.content}</p>
                            : summary && <p className="note-item__preview note-item__preview--fields">{summary}</p>}
                        </div>
                      </div>

                      {!pending && (
                        <div className="note-item__actions">
                          <button
                            type="button"
                            className={`note-icon-btn${note.pinned ? ' is-on' : ''}`}
                            onClick={() => togglePin(note)}
                            aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
                            aria-pressed={note.pinned}
                            title={note.pinned ? 'Unpin' : 'Pin'}
                          >
                            <PushPin size={15} weight={note.pinned ? 'fill' : 'regular'} aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="note-icon-btn note-icon-btn--danger"
                            onClick={() => setConfirmingDelete(confirming ? null : note.id)}
                            aria-label="Delete note"
                            aria-expanded={confirming}
                            title="Delete"
                          >
                            <Trash size={15} aria-hidden />
                          </button>
                        </div>
                      )}

                      {confirming && (
                        <div className="note-confirm" role="alertdialog" aria-label="Confirm delete">
                          <span>Delete this note{note.has_secret ? ' and its stored password' : ''}? This can&apos;t be undone.</span>
                          <button type="button" className="note-btn note-btn--ghost" onClick={() => setConfirmingDelete(null)}>
                            Cancel
                          </button>
                          <button type="button" className="note-btn note-btn--danger-solid" onClick={() => deleteNote(note.id)}>
                            Delete
                          </button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}

          {hiddenCount > 0 && (
            <button type="button" className="note-more" onClick={() => setShowAll(true)}>
              Show {hiddenCount} more note{hiddenCount === 1 ? '' : 's'}
            </button>
          )}
          {showAll && !isFiltering && filtered.length > FEED_LIMIT && (
            <button type="button" className="note-more" onClick={() => setShowAll(false)}>
              Show less
            </button>
          )}
        </div>
      )}

      {/* Expanded note dialog */}
      {expanded && expandedTemplate && (
        <div
          className="note-modal"
          onClick={e => { if (e.target === e.currentTarget) closeNote() }}
        >
          <div className="note-modal__dialog" role="dialog" aria-modal="true" aria-label={expanded.title ?? 'Note'}>
            <div className="note-modal__head">
              <div className="note-modal__heading">
                <NoteCategoryChip template={expandedTemplate} size="md" />
                {editing ? (
                  <input
                    className="note-composer__title note-modal__title-input"
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    placeholder="Title (optional)"
                    aria-label="Note title"
                  />
                ) : (
                  <p className="note-modal__title">{expanded.title ?? 'Untitled note'}</p>
                )}
              </div>
              <div className="note-modal__tools">
                {!editing && (
                  <button type="button" onClick={startEdit} className="note-icon-btn" aria-label="Edit note" title="Edit">
                    <PencilSimple size={16} aria-hidden />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => togglePin(expanded)}
                  className={`note-icon-btn${expanded.pinned ? ' is-on' : ''}`}
                  aria-label={expanded.pinned ? 'Unpin note' : 'Pin note'}
                  aria-pressed={expanded.pinned}
                  title={expanded.pinned ? 'Unpin' : 'Pin'}
                >
                  <PushPin size={16} weight={expanded.pinned ? 'fill' : 'regular'} aria-hidden />
                </button>
                <button type="button" onClick={closeNote} className="note-icon-btn" aria-label="Close" title="Close">
                  <X size={16} aria-hidden />
                </button>
              </div>
            </div>

            <div className="note-modal__body">
              {editing ? (
                <div className="note-modal__edit">
                  <textarea
                    className="note-composer__body note-modal__textarea"
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    rows={6}
                    aria-label="Note"
                    placeholder={`${expandedTemplate.bodyLabel}…`}
                  />
                  <NoteTemplateFields
                    template={expandedTemplate}
                    values={editFields}
                    onChange={(k, v) => setEditFields(prev => ({ ...prev, [k]: v }))}
                    afterEssential={expandedTemplate.hasSecret && (
                      <div>
                        <NoteSecretInput
                          hasSecret={!!expanded.has_secret && !editSecretClear}
                          value={editSecret}
                          onChange={v => { setEditSecret(v); setEditSecretClear(false) }}
                          onClear={() => { setEditSecret(''); setEditSecretClear(true) }}
                        />
                        {editSecretClear && (
                          <p className="note-secret__error">The stored password will be removed when you save.</p>
                        )}
                      </div>
                    )}
                  />
                </div>
              ) : (
                <>
                  {expanded.content && <p className="note-modal__content">{expanded.content}</p>}
                  {/* The credential is fetched on demand from the audited reveal
                      endpoint — it is never part of the note payload. */}
                  <NoteSecretReveal clientId={clientId} noteId={expanded.id} hasSecret={!!expanded.has_secret} />
                  <NoteFieldsReadout template={expandedTemplate} values={expanded.fields ?? {}} />
                </>
              )}
            </div>

            <div className="note-modal__foot">
              {editing && editError && <div className="note-error" role="alert">{editError}</div>}
              {!editing && modalConfirmDelete && (
                <div className="note-confirm note-confirm--modal" role="alertdialog" aria-label="Confirm delete">
                  <span>Delete this note{expanded.has_secret ? ' and its stored password' : ''}? This can&apos;t be undone.</span>
                </div>
              )}
              <div className="note-modal__foot-row">
                <div className="note-modal__byline">
                  <Avatar name={expanded.users?.name ?? null} avatarUrl={expanded.users?.avatar_url ?? null} />
                  <span>
                    {expanded.users?.name ?? 'Admin'} · {relativeTime(expanded.created_at)}
                    {expanded.updated_at && <> · edited by {expanded.editor?.name ?? 'Admin'} {relativeTime(expanded.updated_at)}</>}
                  </span>
                </div>
                {editing ? (
                  <div className="note-modal__actions">
                    <button type="button" className="note-btn note-btn--ghost" onClick={() => { setEditing(false); setEditError(null) }}>
                      Cancel
                    </button>
                    <button type="button" className="note-btn note-btn--primary" onClick={() => void saveEdit(expanded)} disabled={editSaving}>
                      {editSaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                ) : modalConfirmDelete ? (
                  <div className="note-modal__actions">
                    <button type="button" className="note-btn note-btn--ghost" onClick={() => setModalConfirmDelete(false)}>
                      Cancel
                    </button>
                    <button type="button" className="note-btn note-btn--danger-solid" onClick={() => deleteNote(expanded.id)}>
                      Delete
                    </button>
                  </div>
                ) : (
                  <button type="button" className="note-btn note-btn--ghost note-btn--danger" onClick={() => setModalConfirmDelete(true)}>
                    <Trash size={14} aria-hidden /> Delete
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

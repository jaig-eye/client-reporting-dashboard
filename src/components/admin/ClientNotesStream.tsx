'use client'

// Client → Overview → the workspace's Notes tab: everything worth remembering about a client
// (calls, logins, decisions). A composer on top, then the notes, pinned first, each saying who
// wrote it and exactly when (date and time). A note opens in the shared Dialog to read in full,
// edit or pin; deleting asks first. With no notes yet, the space shows what notes are for and
// three ways to start one.

import { useState, useEffect, useRef, useMemo } from 'react'
import { PushPin, Trash, PencilSimple, MagnifyingGlass, NotePencil, ChatCircleText, Key, X } from '@phosphor-icons/react'
import {
  NOTE_TEMPLATES,
  NOTE_TEMPLATE_LIST,
  isNoteCategory,
  noteSearchText,
  type NoteCategory,
} from '@/lib/note-templates'
import { NoteTemplateFields, NoteFieldsReadout, NoteCategoryChip } from './NoteTemplateFields'
import { NoteSecretInput, NoteSecretReveal } from './NoteSecretField'
import { PillTabs } from '@/components/ui/PillTabs'
import StatusBadge from '@/components/ui/StatusBadge'
import { Sk } from '@/components/ui/Skeleton'
import Dialog, { ConfirmDialog } from '@/components/ui/Dialog'

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

/** How many notes show before "Show more". A search or a filter shows everything that matches. */
const FEED_LIMIT = 8

function templateFor(category: string) {
  return NOTE_TEMPLATES[(isNoteCategory(category) ? category : 'general') as NoteCategory]
}

/** "Sep 29, 2026, 4:12 PM": every note says exactly when it was written, never just "3d ago". */
function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** How long ago, for the tooltip on an exact time. */
function relativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 2)  return 'just now'
  if (mins < 60) return `${mins} minutes ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function When({ iso }: { iso: string }) {
  return <time dateTime={iso} title={relativeTime(iso)}>{fmtWhen(iso)}</time>
}

function Avatar({ name, avatarUrl }: { name: string | null; avatarUrl: string | null }) {
  const initials = name
    ? name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : '?'
  return (
    <span className="co-avatar co-avatar--sm" aria-hidden>
      {avatarUrl ? <img src={avatarUrl} alt="" /> : initials}
    </span>
  )
}

function sortNotes(arr: Note[]): Note[] {
  return [...arr].sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned ? 1 : -1
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

/** No notes yet: a little stack of notes, what they're for, and three ways to start one. */
function NotesEmpty({ onStart }: { onStart: (kind: NoteCategory, fields?: Record<string, string>) => void }) {
  return (
    <div className="co-nempty">
      <div className="co-nempty-art" aria-hidden>
        <span className="co-nempty-card co-nempty-card--back" />
        <span className="co-nempty-card co-nempty-card--mid" />
        <span className="co-nempty-card co-nempty-card--front">
          <PushPin size={13} weight="fill" className="co-nempty-pin" />
          <span className="co-nempty-line" style={{ width: '62%' }} />
          <span className="co-nempty-line co-nempty-line--soft" style={{ width: '88%' }} />
          <span className="co-nempty-line co-nempty-line--soft" style={{ width: '74%' }} />
          <span className="co-nempty-foot"><span className="co-nempty-dot" /><span className="co-nempty-line co-nempty-line--soft" style={{ width: '40%' }} /></span>
        </span>
      </div>
      <p className="co-nempty-title">No notes yet</p>
      <p className="co-nempty-text">Calls, logins and decisions live here, so anyone on the team can pick up where the last person left off.</p>
      <div className="co-nempty-actions">
        <button type="button" className="btn btn-primary" onClick={() => onStart('general')}><NotePencil size={15} aria-hidden />Write a note</button>
        <button type="button" className="btn btn-secondary" onClick={() => onStart('contact', { channel: 'Call' })}><ChatCircleText size={15} aria-hidden />Log a call</button>
        <button type="button" className="btn btn-secondary" onClick={() => onStart('login')}><Key size={15} aria-hidden />Save a login</button>
      </div>
    </div>
  )
}

export default function ClientNotesStream({
  clientId,
  onContactLogged,
  onCount,
}: {
  clientId: string
  /** Fired when a contact-log note stamps clients.last_contacted_at. */
  onContactLogged?: (isoDate: string) => void
  /** The number of notes, for the workspace's Notes tab. */
  onCount?: (count: number) => void
}) {
  const [notes,    setNotes]    = useState<Note[]>([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [catFilter, setCatFilter] = useState<NoteCategory | 'all'>('all')
  const [showAll,   setShowAll]   = useState(false)
  const [deleting,  setDeleting]  = useState<Note | null>(null)

  // Add-note form
  const [addingNote,    setAddingNote]    = useState(false)
  const [draftTitle,    setDraftTitle]    = useState('')
  const [draft,         setDraft]         = useState('')
  const [draftCategory, setDraftCategory] = useState<NoteCategory>('general')
  const [draftFields,   setDraftFields]   = useState<Record<string, string>>({})
  const [draftSecret,   setDraftSecret]   = useState('')
  const [saving,        setSaving]        = useState(false)
  const [saveError,     setSaveError]     = useState<string | null>(null)

  // Expanded note popup
  const [expanded,     setExpanded]     = useState<Note | null>(null)
  const [editing,      setEditing]      = useState(false)
  const [editTitle,    setEditTitle]    = useState('')
  const [editContent,  setEditContent]  = useState('')
  const [editFields,   setEditFields]   = useState<Record<string, string>>({})
  const [editSecret,   setEditSecret]   = useState('')
  // '' means "leave the stored credential alone", so clearing needs its own flag.
  const [editSecretClear, setEditSecretClear] = useState(false)
  const [editSaving,   setEditSaving]   = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fetch(`/api/admin/clients/${clientId}/notes`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((d: { notes: Note[] }) => setNotes(d.notes))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [clientId])

  const onCountRef = useRef(onCount)
  onCountRef.current = onCount
  useEffect(() => { if (!loading) onCountRef.current?.(notes.length) }, [notes.length, loading])

  const draftTemplate = NOTE_TEMPLATES[draftCategory]
  const draftHasFields = Object.values(draftFields).some(v => v.trim() !== '')
  const canSaveDraft   = draft.trim() !== '' || draftHasFields

  function resetDraft() {
    setDraft(''); setDraftTitle(''); setDraftFields({}); setDraftCategory('general'); setDraftSecret('')
  }

  /** Open the composer on a kind of note, with any answers filled in ("Log a call" picks Call). */
  function openComposer(kind: NoteCategory = 'general', fields: Record<string, string> = {}) {
    resetDraft()
    setDraftCategory(kind)
    setDraftFields(fields)
    setSaveError(null)
    setAddingNote(true)
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
    // The secret belongs in the snapshot too. It used to be cleared before the
    // request and never restored, so a failed save silently threw away the
    // password the user had just typed.
    const snapshot = { title: draftTitle, category: draftCategory, fields: draftFields, secret: draftSecret }
    setDraft(''); setDraftTitle(''); setDraftFields({}); setDraftSecret(''); setSaveError(null)

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
      if (!res.ok) {
        // The server explains exactly why (an unset CREDENTIAL_ENCRYPTION_KEY,
        // an empty note, a DB error). Throwing that away is what made a failed
        // save look like nothing happening at all.
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error || `Could not save the note (HTTP ${res.status})`)
      }
      const { note, contactStampedAt } = await res.json() as { note: Note; contactStampedAt: string | null }
      setNotes(prev => sortNotes(prev.map(n => n.id === temp.id ? note : n)))
      if (contactStampedAt) onContactLogged?.(contactStampedAt)
      setAddingNote(false)
      setDraftCategory('general')
    } catch (e) {
      setNotes(prev => prev.filter(n => n.id !== temp.id))
      setDraft(content)
      setDraftTitle(snapshot.title)
      setDraftFields(snapshot.fields)
      setDraftSecret(snapshot.secret)
      setSaveError(e instanceof Error ? e.message : 'Could not save the note')
    } finally {
      setSaving(false)
    }
  }

  // Runs from the ConfirmDialog. A failure throws, so the dialog says so and stays open.
  async function deleteNote(id: string) {
    const res = await fetch(`/api/admin/clients/${clientId}/notes/${id}`, { method: 'DELETE' }).catch(() => null)
    if (!res?.ok) throw new Error('The note couldn’t be deleted. Try again.')
    setNotes(prev => prev.filter(n => n.id !== id))
    if (expanded?.id === id) { setExpanded(null); setEditing(false) }
    setDeleting(null)
  }

  async function togglePin(note: Note) {
    const next = !note.pinned
    setNotes(prev => sortNotes(prev.map(n => n.id === note.id ? { ...n, pinned: next } : n)))
    if (expanded?.id === note.id) setExpanded(e => e ? { ...e, pinned: next } : e)
    await fetch(`/api/admin/clients/${clientId}/notes/${note.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ pinned: next }),
    }).catch(() => {})
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
          fields:   cleanFields,
          // Only send a secret when one was typed or explicitly cleared; omitting
          // the key leaves the stored credential untouched.
          ...(editSecret !== "" || editSecretClear ? { secret: editSecretClear ? "" : editSecret } : {}),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error || `Could not save the note (HTTP ${res.status})`)
      }
      const { note: updated } = await res.json() as { note: Note }
      setNotes(prev => sortNotes(prev.map(n => n.id === note.id ? updated : n)))
      setExpanded(updated)
      setEditing(false)
      setSaveError(null)
    } catch (e) {
      // Stay in edit mode so nothing typed is lost, and say why.
      setSaveError(e instanceof Error ? e.message : 'Could not save the note')
    } finally {
      setEditSaving(false)
    }
  }

  function openNote(note: Note) {
    setSaveError(null)
    setExpanded(note)
    setEditing(false)
  }

  function startEdit() {
    if (!expanded) return
    setEditTitle(expanded.title ?? '')
    setEditContent(expanded.content)
    setEditFields({ ...(expanded.fields ?? {}) })
    setEditSecret(''); setEditSecretClear(false)
    setEditing(true)
  }

  // Categories that actually appear on this client, so the chip row only offers
  // filters that can return something.
  const presentCategories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const n of notes) counts.set(n.category, (counts.get(n.category) ?? 0) + 1)
    return NOTE_TEMPLATE_LIST
      .filter(t => counts.has(t.key))
      .map(t => ({ template: t, count: counts.get(t.key) ?? 0 }))
  }, [notes])

  // The chip row is hidden when fewer than two categories remain, so a filter
  // that no longer matches anything would be unclearable: deleting the last
  // 'issue' note while filtering on it unmounts the row (including the only
  // "All" button) and leaves the pane permanently empty until a page reload.
  // Derive the effective filter instead of trusting the stored one.
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

  const expandedTemplate = expanded ? templateFor(expanded.category) : null

  function closeExpanded() { setExpanded(null); setEditing(false) }
  function stopEditing() { setEditing(false); setSaveError(null) }
  // The Edit button goes away once editing starts, so focus moves to the title rather than the page.
  const editTitleRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (editing) editTitleRef.current?.focus() }, [editing])

  const filteringNotes = search.trim() !== '' || activeCatFilter !== 'all'
  const shown = showAll || filteringNotes ? filtered : filtered.slice(0, FEED_LIMIT)
  const hidden = filtered.length - shown.length

  return (
    <div className="co-nb">
      {/* The composer: a quiet bar until it's opened */}
      {addingNote ? (
        <div className="co-compose">
          <div className="co-compose-head">
            <p className="co-compose-title">New note</p>
            <button type="button" className="co-iconbtn" onClick={() => { setAddingNote(false); resetDraft(); setSaveError(null) }} aria-label="Close the new note" title="Close">
              <X size={15} aria-hidden />
            </button>
          </div>
          <div>
            <label className="co-label" htmlFor={`note-kind-${clientId}`}>Kind of note</label>
            <select
              id={`note-kind-${clientId}`}
              className="input"
              value={draftCategory}
              onChange={e => {
                const next = e.target.value as NoteCategory
                setDraftCategory(next)
                setDraftFields({})   // answers belong to the template that declared them
              }}
            >
              {NOTE_TEMPLATE_LIST.map(t => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
            <p className="co-hint">{draftTemplate.hint}</p>
          </div>

          <NoteTemplateFields
            template={draftTemplate}
            values={draftFields}
            onChange={(k, v) => setDraftFields(prev => ({ ...prev, [k]: v }))}
          />

          {draftTemplate.hasSecret && (
            <NoteSecretInput
              hasSecret={false}
              value={draftSecret}
              onChange={setDraftSecret}
            />
          )}

          <input
            className="input"
            value={draftTitle}
            onChange={e => setDraftTitle(e.target.value)}
            placeholder="Title (optional)"
            aria-label="Title"
          />
          <textarea
            ref={textareaRef}
            className="input"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void addNote() }
            }}
            placeholder={`${draftTemplate.bodyLabel}…`}
            aria-label={draftTemplate.bodyLabel}
            rows={3}
            autoFocus
            style={{ resize: 'vertical' }}
          />
          {saveError && <div className="ui-notice ui-notice--danger" role="alert" style={{ margin: 0 }}>{saveError}</div>}

          <div className="co-actions co-actions--end">
            {draftTemplate.stampsContact && (
              <span className="co-hint" style={{ margin: '0 auto 0 0' }}>Saving this updates Last contacted</span>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAddingNote(false); resetDraft() }}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void addNote()} disabled={!canSaveDraft || saving}>
              {saving ? 'Saving…' : 'Save note'}
            </button>
          </div>
        </div>
      ) : !loading && notes.length > 0 && (
        <button type="button" className="co-compose-bar" onClick={() => openComposer()}>
          <span className="co-compose-icon" aria-hidden><PencilSimple size={15} /></span>
          <span className="co-compose-bar-text">Write a note…</span>
          <span className="co-compose-bar-hint">Calls, logins, decisions</span>
        </button>
      )}

      {/* Search, and the kinds this client actually has */}
      {!loading && notes.length > 0 && (notes.length > 3 || presentCategories.length > 1) && (
        <div className="co-nb-tools">
          {presentCategories.length > 1 && (
            <PillTabs
              label="Filter notes by kind"
              activeId={activeCatFilter}
              onSelect={id => setCatFilter(id !== 'all' && isNoteCategory(id) ? id : 'all')}
              items={[
                { id: 'all', label: 'All', count: notes.length },
                ...presentCategories.map(({ template: t, count }) => ({ id: t.key, label: t.label, count })),
              ]}
            />
          )}
          <label className="co-search">
            <MagnifyingGlass size={14} aria-hidden />
            <span className="sr-only">Search notes</span>
            <input type="search" className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search notes" />
          </label>
        </div>
      )}

      {/* The notes */}
      {loading ? (
        <div className="co-feed" aria-busy="true" aria-label="Loading notes">
          {[0, 1].map(i => (
            <span key={i} className="co-nc co-nc--sk">
              <Sk w="38%" h={14} /><Sk w="92%" h={11} /><Sk w="70%" h={11} />
              <span style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}><Sk w={22} h={22} r={11} /><Sk w="30%" h={10} /></span>
            </span>
          ))}
        </div>
      ) : notes.length === 0 ? (
        !addingNote && <NotesEmpty onStart={openComposer} />
      ) : filtered.length === 0 ? (
        <div className="co-nb-none">
          <p>No notes match.</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setCatFilter('all') }}>Clear the search</button>
        </div>
      ) : (
        <>
          <ul className="co-feed">
            {shown.map(note => {
              const t = templateFor(note.category)
              const fieldCount = Object.values(note.fields ?? {}).filter(v => String(v).trim() !== '').length
              const tinted = note.category !== 'general'
              const name = note.title ?? (note.content.split('\n')[0].slice(0, 60) || t.label)
              return (
                <li
                  key={note.id}
                  className={`co-nc${note.pinned ? ' co-nc--pinned' : ''}`}
                  style={tinted ? { ['--cat' as string]: t.color } : undefined}
                >
                  {/* Covers the card, so a click anywhere opens the note; the buttons sit above it. */}
                  <button type="button" className="co-nc-open" onClick={() => openNote(note)} aria-label={`Open the note: ${name}`} />
                  {(note.title || note.pinned) && (
                    <div className="co-nc-head">
                      {note.title && <h3 className="co-nc-title">{note.title}</h3>}
                      {note.pinned && <StatusBadge tone="info" dot={false}>Pinned</StatusBadge>}
                    </div>
                  )}
                  {note.content
                    ? <p className="co-nc-body">{note.content}</p>
                    : fieldCount > 0 && <p className="co-nc-fields">{fieldCount} detail{fieldCount === 1 ? '' : 's'} saved{note.has_secret ? ', and a password' : ''}</p>}
                  <div className="co-nc-foot">
                    <Avatar name={note.users?.name ?? null} avatarUrl={note.users?.avatar_url ?? null} />
                    <span className="co-nc-author">{note.users?.name ?? 'Admin'}</span>
                    <span className="co-nc-when"><When iso={note.created_at} /></span>
                    {note.updated_at && <span className="co-nc-edited">Edited <When iso={note.updated_at} /></span>}
                    {tinted && <span className="co-nc-kind"><NoteCategoryChip template={t} /></span>}
                    <span className="co-nc-actions">
                      <button
                        type="button"
                        className="co-iconbtn"
                        onClick={() => void togglePin(note)}
                        aria-pressed={note.pinned}
                        aria-label={note.pinned ? `Unpin ${name}` : `Pin ${name} to the top`}
                        title={note.pinned ? 'Unpin' : 'Pin to the top'}
                      >
                        <PushPin size={15} weight={note.pinned ? 'fill' : 'regular'} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="co-iconbtn co-iconbtn--danger"
                        onClick={() => setDeleting(note)}
                        aria-label={`Delete ${name}`}
                        title="Delete note"
                      >
                        <Trash size={15} aria-hidden />
                      </button>
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
          {hidden > 0 && (
            <button type="button" className="btn btn-ghost btn-sm co-nb-more" onClick={() => setShowAll(true)}>
              Show {hidden} more note{hidden === 1 ? '' : 's'}
            </button>
          )}
        </>
      )}

      {/* Expanded note */}
      <Dialog
        open={!!(expanded && expandedTemplate)}
        onClose={closeExpanded}
        // Escape steps back out of editing first, then closes.
        onEscape={() => { if (editing) stopEditing(); else closeExpanded() }}
        initialFocus="dialog"
        title={editing ? 'Edit note' : expanded?.title ?? <span className="co-untitled">Untitled note</span>}
        description={expandedTemplate && <span className="co-note-kind"><NoteCategoryChip template={expandedTemplate} size="md" /></span>}
        actions={expanded && <>
          {!editing && (
            <button type="button" className="co-iconbtn" onClick={startEdit} aria-label="Edit note" title="Edit note">
              <PencilSimple size={16} aria-hidden />
            </button>
          )}
          <button
            type="button"
            className="co-iconbtn"
            onClick={() => void togglePin(expanded)}
            aria-pressed={expanded.pinned}
            aria-label={expanded.pinned ? 'Unpin note' : 'Pin note to the top'}
            title={expanded.pinned ? 'Unpin' : 'Pin to the top'}
          >
            <PushPin size={16} weight={expanded.pinned ? 'fill' : 'regular'} aria-hidden />
          </button>
        </>}
        bodyClassName="co-nd-body"
        footer={expanded && (editing ? <>
          {saveError && <p className="ui-dialog-error" role="alert">{saveError}</p>}
          <button type="button" className="btn btn-secondary" onClick={stopEditing}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => void saveEdit(expanded)} disabled={editSaving}>
            {editSaving ? 'Saving…' : 'Save changes'}
          </button>
        </> : (
          <button type="button" className="btn btn-ghost co-danger-text" onClick={() => setDeleting(expanded)}>
            <Trash size={14} aria-hidden />Delete note
          </button>
        ))}
      >
        {expanded && expandedTemplate && <>
          {editing ? (
            <>
              <input
                ref={editTitleRef}
                className="input co-edit-title"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                placeholder="Title (optional)"
                aria-label="Title"
              />
              <NoteTemplateFields
                template={expandedTemplate}
                values={editFields}
                onChange={(k, v) => setEditFields(prev => ({ ...prev, [k]: v }))}
              />

              {expandedTemplate.hasSecret && (
                <div>
                  <NoteSecretInput
                    hasSecret={!!expanded.has_secret && !editSecretClear}
                    value={editSecret}
                    onChange={v => { setEditSecret(v); setEditSecretClear(false) }}
                    onClear={() => { setEditSecret(''); setEditSecretClear(true) }}
                  />
                  {editSecretClear && (
                    <p className="co-hint co-neg">The stored password will be removed when you save.</p>
                  )}
                </div>
              )}
              <textarea
                className="input"
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                aria-label={expandedTemplate.bodyLabel}
                rows={8}
              />
            </>
          ) : (
            <>
              {/* The credential is fetched on demand from the audited reveal
                  endpoint — it is never part of the note payload. */}
              <NoteSecretReveal
                clientId={clientId}
                noteId={expanded.id}
                hasSecret={!!expanded.has_secret}
              />
              <NoteFieldsReadout template={expandedTemplate} values={expanded.fields ?? {}} />
              {expanded.content && <p className="co-dialog-content">{expanded.content}</p>}
            </>
          )}
          <p className="co-dialog-meta">
            Written by {expanded.users?.name ?? 'Admin'} on <When iso={expanded.created_at} />
            {expanded.updated_at && <>. Edited by {expanded.editor?.name ?? 'Admin'} on <When iso={expanded.updated_at} /></>}
          </p>
        </>}
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        tone="danger"
        title="Delete this note?"
        confirmLabel="Delete note"
        busyLabel="Deleting…"
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting ? deleteNote(deleting.id) : undefined}
      >
        <p>{deleting?.title ? `“${deleting.title}” goes` : 'It goes'} for everyone on the team{deleting?.has_secret ? ', with its saved password' : ''}. This can’t be undone.</p>
      </ConfirmDialog>
    </div>
  )
}

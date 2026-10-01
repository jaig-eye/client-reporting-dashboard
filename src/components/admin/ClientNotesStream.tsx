'use client'

// Client → Overview → Notes: everything worth remembering about a client (calls, logins,
// decisions), filterable by kind and searchable. A note opens in a dialog to read in full, edit,
// pin or delete. Rendered as its own Section so the search and Add note sit in the section header.

import { useState, useEffect, useRef, useMemo } from 'react'
import { PushPin, Trash, PencilSimple, X, MagnifyingGlass, Plus } from '@phosphor-icons/react'
import {
  NOTE_TEMPLATES,
  NOTE_TEMPLATE_LIST,
  isNoteCategory,
  noteSearchText,
  type NoteCategory,
} from '@/lib/note-templates'
import { NoteTemplateFields, NoteFieldsReadout, NoteCategoryChip } from './NoteTemplateFields'
import { NoteSecretInput, NoteSecretReveal } from './NoteSecretField'
import Section from '@/components/ui/Section'
import { PillTabs } from '@/components/ui/PillTabs'
import { Sk } from '@/components/ui/Skeleton'

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

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Dialog focus: move focus in on open, keep Tab inside, Escape calls onEscape, give focus back to
 * whatever opened it on close, and stop the page scrolling underneath.
 */
function useDialogFocus(open: boolean, ref: React.RefObject<HTMLElement>, onEscape: () => void) {
  const escRef = useRef(onEscape)
  useEffect(() => { escRef.current = onEscape })
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const root = ref.current
    root?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); escRef.current(); return }
      if (e.key !== 'Tab' || !root) return
      const f = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.getClientRects().length > 0)
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === root)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [open, ref])
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

  const draftTemplate = NOTE_TEMPLATES[draftCategory]
  const draftHasFields = Object.values(draftFields).some(v => v.trim() !== '')
  const canSaveDraft   = draft.trim() !== '' || draftHasFields

  function resetDraft() {
    setDraft(''); setDraftTitle(''); setDraftFields({}); setDraftCategory('general'); setDraftSecret('')
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

  async function deleteNote(id: string) {
    const snapshot = notes.find(n => n.id === id)
    setNotes(prev => prev.filter(n => n.id !== id))
    if (expanded?.id === id) setExpanded(null)
    const res = await fetch(`/api/admin/clients/${clientId}/notes/${id}`, { method: 'DELETE' }).catch(() => null)
    if (snapshot && (!res || !res.ok)) {
      setNotes(prev => sortNotes([snapshot, ...prev]))
    }
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

  const dialogRef = useRef<HTMLDivElement>(null)
  function closeExpanded() { setExpanded(null); setEditing(false) }
  // Escape steps back out of editing first, then closes.
  useDialogFocus(!!expanded, dialogRef, () => {
    if (editing) { setEditing(false); setSaveError(null) } else closeExpanded()
  })

  return (
    <Section
      title="Notes"
      description="Calls, logins, decisions: anything worth remembering about this client."
      actions={<>
        <label className="co-search">
          <MagnifyingGlass size={14} aria-hidden />
          <span className="sr-only">Search notes</span>
          <input
            type="search"
            className="input"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search notes"
          />
        </label>
        <button
          type="button"
          onClick={() => { setAddingNote(v => !v); resetDraft(); setSaveError(null) }}
          className="btn btn-secondary btn-sm"
          aria-expanded={addingNote}
        >
          <Plus size={14} weight="bold" aria-hidden />Add note
        </button>
      </>}
    >
      <div className="co-notes-tools">
        {/* Category filter — only categories this client actually has */}
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

        {/* Add note form */}
        {addingNote && (
          <div className="co-subform">
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
        )}
      </div>

      {/* Notes list */}
      {loading ? (
        <div className="co-notes-sk" aria-busy="true" aria-label="Loading notes">
          <Sk h={62} /><Sk h={62} />
        </div>
      ) : filtered.length === 0 ? (
        <p className="co-hint" style={{ margin: 0 }}>
          {search.trim() || activeCatFilter !== 'all' ? 'No notes match this filter.' : 'No notes yet.'}
        </p>
      ) : (
        <div className="co-notes">
          {filtered.map(note => {
            const t = templateFor(note.category)
            const fieldCount = Object.values(note.fields ?? {}).filter(v => String(v).trim() !== '').length
            const tinted = note.category !== 'general'
            return (
              <div
                key={note.id}
                className={`co-note${note.pinned ? ' co-note--pinned' : ''}`}
                data-cat={tinted ? note.category : undefined}
                style={tinted ? { ['--cat' as string]: t.color } : undefined}
                onClick={() => openNote(note)}
              >
                <Avatar name={note.users?.name ?? null} avatarUrl={note.users?.avatar_url ?? null} />
                {/* The card opens on a click anywhere; this button is its keyboard and screen-reader handle. */}
                <button type="button" className="co-note-open">
                  {note.title && <span className="co-note-title">{note.title}</span>}
                  {note.content
                    ? <span className="co-note-body">{note.content}</span>
                    : fieldCount > 0 && <span className="co-note-fields">{fieldCount} field{fieldCount === 1 ? '' : 's'} filled in</span>}
                  <span className="co-note-meta">
                    {tinted && <NoteCategoryChip template={t} />}
                    <span>{note.users?.name ?? 'Admin'}, {relativeTime(note.created_at)}</span>
                    {note.updated_at && <span>· edited by {note.editor?.name ?? 'Admin'} {relativeTime(note.updated_at)}</span>}
                    {note.pinned && <span className="co-warn">· pinned</span>}
                  </span>
                </button>
                <div className="co-note-actions" onClick={e => e.stopPropagation()}>
                  <button
                    type="button"
                    className="co-iconbtn"
                    onClick={() => void togglePin(note)}
                    aria-pressed={note.pinned}
                    aria-label={note.pinned ? 'Unpin note' : 'Pin note to the top'}
                    title={note.pinned ? 'Unpin' : 'Pin to the top'}
                  >
                    <PushPin size={15} weight={note.pinned ? 'fill' : 'regular'} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="co-iconbtn co-iconbtn--danger"
                    onClick={() => void deleteNote(note.id)}
                    aria-label="Delete note"
                    title="Delete note"
                  >
                    <Trash size={15} aria-hidden />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Expanded note */}
      {expanded && expandedTemplate && (
        <div className="co-scrim" onClick={e => { if (e.target === e.currentTarget) closeExpanded() }}>
          <div
            ref={dialogRef}
            className="co-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={expanded.title ?? `${expandedTemplate.label} note`}
            tabIndex={-1}
          >
            <div className="co-dialog-head">
              <div className="co-dialog-head-text">
                <NoteCategoryChip template={expandedTemplate} size="md" />
                {editing ? (
                  <input
                    className="input"
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    placeholder="Title (optional)"
                    aria-label="Title"
                    style={{ fontWeight: 600 }}
                  />
                ) : (
                  <h2 className={`co-dialog-title${expanded.title ? '' : ' co-dialog-title--empty'}`}>
                    {expanded.title ?? 'Untitled note'}
                  </h2>
                )}
              </div>
              <div className="co-dialog-tools">
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
                <button type="button" className="co-iconbtn" onClick={closeExpanded} aria-label="Close" title="Close">
                  <X size={16} aria-hidden />
                </button>
              </div>
            </div>

            <div className="co-dialog-body">
              {editing ? (
                <>
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
            </div>

            <div className="co-dialog-foot">
              {editing && saveError && <div className="ui-notice ui-notice--danger" role="alert">{saveError}</div>}
              <span className="co-dialog-meta">
                Posted by {expanded.users?.name ?? 'Admin'}, {relativeTime(expanded.created_at)}
                {expanded.updated_at && <> · edited by {expanded.editor?.name ?? 'Admin'} {relativeTime(expanded.updated_at)}</>}
              </span>
              {editing ? (
                <div className="co-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setSaveError(null) }}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveEdit(expanded)} disabled={editSaving}>
                    {editSaving ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              ) : (
                <button type="button" className="btn btn-ghost btn-sm co-danger-text" onClick={() => void deleteNote(expanded.id)}>
                  <Trash size={14} aria-hidden />Delete note
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </Section>
  )
}

'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { PushPin, Trash, PencilSimple, X, MagnifyingGlass } from '@phosphor-icons/react'
import {
  NOTE_TEMPLATES,
  NOTE_TEMPLATE_LIST,
  isNoteCategory,
  noteSearchText,
  type NoteCategory,
} from '@/lib/note-templates'
import { NoteTemplateFields, NoteFieldsReadout, NoteCategoryChip } from './NoteTemplateFields'

interface NoteUser {
  name:       string
  avatar_url: string | null
}

interface Note {
  id:         string
  title:      string | null
  content:    string
  category:   string
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
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name ?? ''} style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  }
  return (
    <span style={{
      width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
      background: 'var(--blue)', color: '#fff',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '0.55rem', fontWeight: 700, lineHeight: 1,
    }}>
      {initials}
    </span>
  )
}

function sortNotes(arr: Note[]): Note[] {
  return [...arr].sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned ? 1 : -1
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
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
  const [saving,        setSaving]        = useState(false)

  // Expanded note popup
  const [expanded,     setExpanded]     = useState<Note | null>(null)
  const [editing,      setEditing]      = useState(false)
  const [editTitle,    setEditTitle]    = useState('')
  const [editContent,  setEditContent]  = useState('')
  const [editFields,   setEditFields]   = useState<Record<string, string>>({})
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
    setDraft(''); setDraftTitle(''); setDraftFields({}); setDraftCategory('general')
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
    const snapshot = { title: draftTitle, category: draftCategory, fields: draftFields }
    setDraft(''); setDraftTitle(''); setDraftFields({})

    try {
      const res = await fetch(`/api/admin/clients/${clientId}/notes`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          content,
          title:    snapshot.title.trim() || null,
          category: snapshot.category,
          fields:   cleanFields,
        }),
      })
      if (!res.ok) throw new Error()
      const { note, contactStampedAt } = await res.json() as { note: Note; contactStampedAt: string | null }
      setNotes(prev => sortNotes(prev.map(n => n.id === temp.id ? note : n)))
      if (contactStampedAt) onContactLogged?.(contactStampedAt)
      setAddingNote(false)
      setDraftCategory('general')
    } catch {
      setNotes(prev => prev.filter(n => n.id !== temp.id))
      setDraft(content)
      setDraftTitle(snapshot.title)
      setDraftFields(snapshot.fields)
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
        }),
      })
      if (!res.ok) throw new Error()
      const { note: updated } = await res.json() as { note: Note }
      setNotes(prev => sortNotes(prev.map(n => n.id === note.id ? updated : n)))
      setExpanded(updated)
      setEditing(false)
    } catch {
      // leave edit mode open on failure
    } finally {
      setEditSaving(false)
    }
  }

  function openNote(note: Note) {
    setExpanded(note)
    setEditing(false)
  }

  function startEdit() {
    if (!expanded) return
    setEditTitle(expanded.title ?? '')
    setEditContent(expanded.content)
    setEditFields({ ...(expanded.fields ?? {}) })
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return notes.filter(n => {
      if (catFilter !== 'all' && n.category !== catFilter) return false
      if (!q) return true
      return noteSearchText(n).includes(q)
    })
  }, [notes, search, catFilter])

  // ── Shared styles ────────────────────────────────────────────────────────
  const inp: React.CSSProperties = {
    width: '100%', padding: '0.4rem 0.6rem', boxSizing: 'border-box',
    background: 'var(--bg-subtle)', border: '1px solid var(--border)',
    borderRadius: 6, fontSize: '0.8rem', color: 'var(--text)', fontFamily: 'inherit',
  }

  const expandedTemplate = expanded ? templateFor(expanded.category) : null

  return (
    <div>
      {/* Title row + search + add button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.6rem' }}>
        <h2 className="section-title" style={{ flex: 1, margin: 0 }}>Notes</h2>
        <div style={{ position: 'relative' }}>
          <MagnifyingGlass size={12} style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', pointerEvents: 'none' }} aria-hidden />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            style={{ ...inp, paddingLeft: 24, width: 130, fontSize: '0.72rem' }}
          />
        </div>
        <button
          onClick={() => { setAddingNote(v => !v); resetDraft() }}
          className="btn btn-secondary"
          style={{ padding: '0.25rem 0.625rem', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
        >
          + Add Note
        </button>
      </div>

      {/* Category filter chips — only categories this client actually has */}
      {presentCategories.length > 1 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: '0.6rem' }}>
          <button
            onClick={() => setCatFilter('all')}
            style={{
              padding: '0.1rem 0.45rem', borderRadius: 999, cursor: 'pointer',
              fontSize: '0.63rem', fontWeight: 600, lineHeight: 1.5,
              background: catFilter === 'all' ? 'var(--text)' : 'transparent',
              color:      catFilter === 'all' ? 'var(--bg-surface)' : 'var(--text-muted)',
              border: '1px solid var(--border)',
            }}
          >
            All {notes.length}
          </button>
          {presentCategories.map(({ template: t, count }) => {
            const on = catFilter === t.key
            return (
              <button
                key={t.key}
                onClick={() => setCatFilter(on ? 'all' : t.key)}
                style={{
                  padding: '0.1rem 0.45rem', borderRadius: 999, cursor: 'pointer',
                  fontSize: '0.63rem', fontWeight: 600, lineHeight: 1.5,
                  background: on ? t.color : `${t.color}14`,
                  color:      on ? '#fff' : t.color,
                  border: `1px solid ${t.color}${on ? '' : '40'}`,
                }}
              >
                {t.label} {count}
              </button>
            )
          })}
        </div>
      )}

      {/* Add note form */}
      {addingNote && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: '0.75rem' }}>
          {/* Category picker */}
          <div>
            <select
              value={draftCategory}
              onChange={e => {
                const next = e.target.value as NoteCategory
                setDraftCategory(next)
                setDraftFields({})   // answers belong to the template that declared them
              }}
              style={{ ...inp, fontSize: '0.78rem', cursor: 'pointer' }}
            >
              {NOTE_TEMPLATE_LIST.map(t => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
            <p style={{ margin: '3px 0 0', fontSize: '0.63rem', color: 'var(--text-faint)' }}>
              {draftTemplate.hint}
            </p>
          </div>

          <NoteTemplateFields
            template={draftTemplate}
            values={draftFields}
            onChange={(k, v) => setDraftFields(prev => ({ ...prev, [k]: v }))}
          />

          <input
            value={draftTitle}
            onChange={e => setDraftTitle(e.target.value)}
            placeholder="Title (optional)"
            style={{ ...inp, fontSize: '0.78rem' }}
          />
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void addNote() }
            }}
            placeholder={`${draftTemplate.bodyLabel}...`}
            rows={2}
            autoFocus
            style={{ ...inp, resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
            {draftTemplate.stampsContact && (
              <span style={{ marginRight: 'auto', fontSize: '0.63rem', color: 'var(--text-faint)' }}>
                Updates Last contacted
              </span>
            )}
            <button
              onClick={() => { setAddingNote(false); resetDraft() }}
              style={{ padding: '0.25rem 0.6rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, fontSize: '0.75rem', cursor: 'pointer', color: 'var(--text-muted)' }}
            >
              Cancel
            </button>
            <button
              onClick={() => void addNote()}
              disabled={!canSaveDraft || saving}
              style={{
                padding: '0.25rem 0.75rem',
                background: 'var(--blue)', color: '#fff', border: 'none',
                borderRadius: 5, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
                opacity: !canSaveDraft || saving ? 0.5 : 1,
              }}
            >
              {saving ? 'Saving...' : 'Save Note'}
            </button>
          </div>
        </div>
      )}

      {/* Notes list */}
      {loading && <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>Loading...</p>}
      {!loading && filtered.length === 0 && (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>
          {search.trim() || catFilter !== 'all' ? 'No notes match this filter.' : 'No notes yet.'}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: '14.5rem', overflowY: 'auto', paddingRight: 2 }}>
        {filtered.map(note => {
          const t = templateFor(note.category)
          const fieldCount = Object.values(note.fields ?? {}).filter(v => String(v).trim() !== '').length
          return (
            <div
              key={note.id}
              onClick={() => openNote(note)}
              style={{
                padding: '0.5rem 0.625rem',
                background: note.pinned ? 'var(--yellow-subtle, rgba(234,179,8,0.08))' : 'var(--bg-subtle)',
                border: `1px solid ${note.pinned ? 'rgba(234,179,8,0.25)' : 'var(--border)'}`,
                borderLeft: note.category !== 'general' ? `2px solid ${t.color}` : undefined,
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              {/* Note header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4 }}>
                <Avatar name={note.users?.name ?? null} avatarUrl={note.users?.avatar_url ?? null} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  {note.title && (
                    <p style={{ margin: 0, fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {note.title}
                    </p>
                  )}
                  {note.content
                    ? (
                      <p style={{
                        margin: 0, fontSize: '0.78rem', color: 'var(--text)',
                        overflow: 'hidden',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        wordBreak: 'break-word',
                      }}>
                        {note.content}
                      </p>
                    )
                    : fieldCount > 0 && (
                      <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-faint)', fontStyle: 'italic' }}>
                        {fieldCount} field{fieldCount === 1 ? '' : 's'} filled in
                      </p>
                    )}
                </div>
                {/* Actions */}
                <div style={{ display: 'flex', gap: 1, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                  <button onClick={() => void togglePin(note)} title={note.pinned ? 'Unpin' : 'Pin'}
                    style={{ padding: 3, background: 'none', border: 'none', cursor: 'pointer', color: note.pinned ? 'var(--yellow, #ca8a04)' : 'var(--text-faint)', borderRadius: 4 }}>
                    <PushPin size={11} weight={note.pinned ? 'fill' : 'regular'} aria-hidden />
                  </button>
                  <button onClick={() => void deleteNote(note.id)} title="Delete"
                    style={{ padding: 3, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', borderRadius: 4 }}>
                    <Trash size={11} aria-hidden />
                  </button>
                </div>
              </div>

              {/* Meta line */}
              <div style={{ fontSize: '0.62rem', color: 'var(--text-faint)', display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                {note.category !== 'general' && <NoteCategoryChip template={t} />}
                <span>{note.users?.name ?? 'Admin'} · {relativeTime(note.created_at)}</span>
                {note.updated_at && (
                  <span>· Edited by {note.editor?.name ?? 'Admin'} {relativeTime(note.updated_at)}</span>
                )}
                {note.pinned && <span style={{ color: 'var(--yellow, #ca8a04)' }}>· pinned</span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Expanded note popup */}
      {expanded && expandedTemplate && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1100,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem',
          }}
          onClick={e => { if (e.target === e.currentTarget) { setExpanded(null); setEditing(false) } }}
        >
          <div style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10,
            width: '100%', maxWidth: 520, maxHeight: '80vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }}>
            {/* Popup header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '0.875rem 1rem', borderBottom: '1px solid var(--border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ marginBottom: 4 }}>
                  <NoteCategoryChip template={expandedTemplate} size="md" />
                </div>
                {editing ? (
                  <input
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    placeholder="Title (optional)"
                    style={{
                      width: '100%', background: 'var(--bg-subtle)', border: '1px solid var(--border)',
                      borderRadius: 5, padding: '0.3rem 0.5rem', fontSize: '0.9rem', fontWeight: 600,
                      color: 'var(--text)', fontFamily: 'inherit', boxSizing: 'border-box',
                    }}
                  />
                ) : (
                  <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)', wordBreak: 'break-word' }}>
                    {expanded.title ?? '(no title)'}
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                {!editing && (
                  <button onClick={startEdit} title="Edit note"
                    style={{ padding: 5, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', borderRadius: 5 }}>
                    <PencilSimple size={15} aria-hidden />
                  </button>
                )}
                <button onClick={() => void togglePin(expanded)} title={expanded.pinned ? 'Unpin' : 'Pin'}
                  style={{ padding: 5, background: 'none', border: 'none', cursor: 'pointer', color: expanded.pinned ? 'var(--yellow, #ca8a04)' : 'var(--text-muted)', borderRadius: 5 }}>
                  <PushPin size={15} weight={expanded.pinned ? 'fill' : 'regular'} aria-hidden />
                </button>
                <button onClick={() => { setExpanded(null); setEditing(false) }} title="Close"
                  style={{ padding: 5, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', borderRadius: 5 }}>
                  <X size={15} aria-hidden />
                </button>
              </div>
            </div>

            {/* Popup body */}
            <div style={{ flex: 1, overflow: 'auto', padding: '0.875rem 1rem' }}>
              {editing ? (
                <>
                  <div style={{ marginBottom: 8 }}>
                    <NoteTemplateFields
                      template={expandedTemplate}
                      values={editFields}
                      onChange={(k, v) => setEditFields(prev => ({ ...prev, [k]: v }))}
                    />
                  </div>
                  <textarea
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    rows={8}
                    style={{
                      width: '100%', resize: 'vertical', background: 'var(--bg-subtle)',
                      border: '1px solid var(--border)', borderRadius: 6,
                      padding: '0.5rem 0.625rem', fontSize: '0.85rem', color: 'var(--text)',
                      fontFamily: 'inherit', boxSizing: 'border-box', lineHeight: 1.6,
                    }}
                  />
                </>
              ) : (
                <>
                  <NoteFieldsReadout template={expandedTemplate} values={expanded.fields ?? {}} />
                  {expanded.content && (
                    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6 }}>
                      {expanded.content}
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Popup footer */}
            <div style={{ padding: '0.625rem 1rem', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontSize: '0.67rem', color: 'var(--text-faint)', minWidth: 0 }}>
                <span>Posted by {expanded.users?.name ?? 'Admin'} · {relativeTime(expanded.created_at)}</span>
                {expanded.updated_at && (
                  <span> · Edited by {expanded.editor?.name ?? 'Admin'} {relativeTime(expanded.updated_at)}</span>
                )}
              </div>
              {editing ? (
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => setEditing(false)}
                    style={{ padding: '0.3rem 0.7rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, fontSize: '0.75rem', cursor: 'pointer', color: 'var(--text-muted)' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void saveEdit(expanded)}
                    disabled={editSaving}
                    style={{ padding: '0.3rem 0.7rem', background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 5, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', opacity: editSaving ? 0.6 : 1 }}
                  >
                    {editSaving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => void deleteNote(expanded.id)}
                  style={{ padding: '0.3rem 0.6rem', background: 'none', border: '1px solid var(--border)', borderRadius: 5, fontSize: '0.72rem', cursor: 'pointer', color: 'var(--red)', flexShrink: 0 }}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

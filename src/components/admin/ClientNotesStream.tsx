'use client'

import { useState, useEffect, useRef } from 'react'
import { PushPin, Trash, PencilSimple, X, MagnifyingGlass } from '@phosphor-icons/react'

interface NoteUser {
  name:       string
  avatar_url: string | null
}

interface Note {
  id:         string
  title:      string | null
  content:    string
  pinned:     boolean
  created_at: string
  user_id:    string | null
  updated_at: string | null
  updated_by: string | null
  users:      NoteUser | null
  editor:     NoteUser | null
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

export default function ClientNotesStream({ clientId }: { clientId: string }) {
  const [notes,    setNotes]    = useState<Note[]>([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')

  // Add-note form
  const [addingNote,   setAddingNote]   = useState(false)
  const [draftTitle,   setDraftTitle]   = useState('')
  const [draft,        setDraft]        = useState('')
  const [saving,       setSaving]       = useState(false)

  // Expanded note popup
  const [expanded,     setExpanded]     = useState<Note | null>(null)
  const [editing,      setEditing]      = useState(false)
  const [editTitle,    setEditTitle]    = useState('')
  const [editContent,  setEditContent]  = useState('')
  const [editSaving,   setEditSaving]   = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fetch(`/api/admin/clients/${clientId}/notes`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((d: { notes: Note[] }) => setNotes(d.notes))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [clientId])

  async function addNote() {
    const content = draft.trim()
    if (!content || saving) return
    setSaving(true)

    const temp: Note = {
      id: `temp-${Date.now()}`,
      title:      draftTitle.trim() || null,
      content,
      pinned:     false,
      created_at: new Date().toISOString(),
      user_id:    null,
      updated_at: null,
      updated_by: null,
      users:      null,
      editor:     null,
    }
    setNotes(prev => sortNotes([temp, ...prev]))
    const savedTitle = draftTitle
    setDraft('')
    setDraftTitle('')

    try {
      const res = await fetch(`/api/admin/clients/${clientId}/notes`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ content, title: savedTitle.trim() || null }),
      })
      if (!res.ok) throw new Error()
      const { note } = await res.json() as { note: Note }
      setNotes(prev => sortNotes(prev.map(n => n.id === temp.id ? note : n)))
      setAddingNote(false)
    } catch {
      setNotes(prev => prev.filter(n => n.id !== temp.id))
      setDraft(content)
      setDraftTitle(savedTitle)
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
    if (!content || editSaving) return
    setEditSaving(true)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/notes/${note.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ content, title: editTitle.trim() || null }),
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
    setEditing(true)
  }

  const filtered = search.trim()
    ? notes.filter(n =>
        n.content.toLowerCase().includes(search.toLowerCase()) ||
        (n.title?.toLowerCase().includes(search.toLowerCase()) ?? false)
      )
    : notes

  // ── Shared styles ────────────────────────────────────────────────────────
  const inp: React.CSSProperties = {
    width: '100%', padding: '0.4rem 0.6rem', boxSizing: 'border-box',
    background: 'var(--bg-subtle)', border: '1px solid var(--border)',
    borderRadius: 6, fontSize: '0.8rem', color: 'var(--text)', fontFamily: 'inherit',
  }

  return (
    <div>
      {/* Title row + search + add button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.6rem' }}>
        <p style={{ flex: 1, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-faint)', margin: 0 }}>
          Notes
        </p>
        <div style={{ position: 'relative' }}>
          <MagnifyingGlass size={12} style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', pointerEvents: 'none' }} aria-hidden />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            style={{ ...inp, paddingLeft: 24, width: 130, fontSize: '0.72rem' }}
          />
        </div>
        <button
          onClick={() => { setAddingNote(v => !v); setDraft(''); setDraftTitle('') }}
          style={{
            padding: '0.25rem 0.625rem', background: 'var(--blue)', color: '#fff',
            border: 'none', borderRadius: 5, fontSize: '0.72rem', fontWeight: 600,
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          + Add Note
        </button>
      </div>

      {/* Add note form — only shown when addingNote */}
      {addingNote && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: '0.75rem' }}>
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
            placeholder="Add a note… (⌘↵ to save)"
            rows={2}
            autoFocus
            style={{ ...inp, resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button
              onClick={() => { setAddingNote(false); setDraft(''); setDraftTitle('') }}
              style={{ padding: '0.25rem 0.6rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, fontSize: '0.75rem', cursor: 'pointer', color: 'var(--text-muted)' }}
            >
              Cancel
            </button>
            <button
              onClick={() => void addNote()}
              disabled={!draft.trim() || saving}
              style={{
                padding: '0.25rem 0.75rem',
                background: 'var(--blue)', color: '#fff', border: 'none',
                borderRadius: 5, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
                opacity: !draft.trim() || saving ? 0.5 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Save Note'}
            </button>
          </div>
        </div>
      )}

      {/* Notes list */}
      {loading && <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>Loading…</p>}
      {!loading && filtered.length === 0 && (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>
          {search.trim() ? 'No notes match your search.' : 'No notes yet.'}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: '14.5rem', overflowY: 'auto', paddingRight: 2 }}>
        {filtered.map(note => (
          <div
            key={note.id}
            onClick={() => openNote(note)}
            style={{
              padding: '0.5rem 0.625rem',
              background: note.pinned ? 'var(--yellow-subtle, rgba(234,179,8,0.08))' : 'var(--bg-subtle)',
              border: `1px solid ${note.pinned ? 'rgba(234,179,8,0.25)' : 'var(--border)'}`,
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
                {/* Excerpt */}
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
            <div style={{ fontSize: '0.62rem', color: 'var(--text-faint)', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              <span>{note.users?.name ?? 'Admin'} · {relativeTime(note.created_at)}</span>
              {note.updated_at && (
                <span>· Edited by {note.editor?.name ?? 'Admin'} {relativeTime(note.updated_at)}</span>
              )}
              {note.pinned && <span style={{ color: 'var(--yellow, #ca8a04)' }}>· pinned</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Expanded note popup */}
      {expanded && (
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
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  rows={8}
                  autoFocus
                  style={{
                    width: '100%', resize: 'vertical', background: 'var(--bg-subtle)',
                    border: '1px solid var(--border)', borderRadius: 6,
                    padding: '0.5rem 0.625rem', fontSize: '0.85rem', color: 'var(--text)',
                    fontFamily: 'inherit', boxSizing: 'border-box', lineHeight: 1.6,
                  }}
                />
              ) : (
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6 }}>
                  {expanded.content}
                </p>
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
                    disabled={!editContent.trim() || editSaving}
                    style={{ padding: '0.3rem 0.7rem', background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 5, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', opacity: !editContent.trim() || editSaving ? 0.6 : 1 }}
                  >
                    {editSaving ? 'Saving…' : 'Save'}
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

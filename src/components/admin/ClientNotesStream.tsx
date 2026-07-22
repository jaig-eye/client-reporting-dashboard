'use client'

import { useState, useEffect, useRef } from 'react'
import { PushPin, X, Trash }           from '@phosphor-icons/react'

interface NoteUser {
  name: string
  avatar_url: string | null
}

interface Note {
  id: string
  content: string
  pinned: boolean
  created_at: string
  user_id: string | null
  users: NoteUser | null
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
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function Initials({ name, avatarUrl }: { name: string | null; avatarUrl: string | null }) {
  const initials = name
    ? name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : '?'

  if (avatarUrl) {
    return (
      <img src={avatarUrl} alt={name ?? ''} style={{
        width: 24, height: 24, borderRadius: '50%', objectFit: 'cover', flexShrink: 0,
      }} />
    )
  }

  return (
    <span style={{
      width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
      background: 'var(--blue)', color: '#fff',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '0.6rem', fontWeight: 700, lineHeight: 1,
    }}>
      {initials}
    </span>
  )
}

export default function ClientNotesStream({ clientId }: { clientId: string }) {
  const [notes,   setNotes]   = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [draft,   setDraft]   = useState('')
  const [saving,  setSaving]  = useState(false)
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

    // Optimistic add
    const temp: Note = {
      id: `temp-${Date.now()}`,
      content,
      pinned: false,
      created_at: new Date().toISOString(),
      user_id: null,
      users: null,
    }
    setNotes(prev => [temp, ...prev])
    setDraft('')

    try {
      const res = await fetch(`/api/admin/clients/${clientId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) throw new Error()
      const { note } = await res.json() as { note: Note }
      setNotes(prev => prev.map(n => n.id === temp.id ? note : n))
    } catch {
      // revert optimistic add
      setNotes(prev => prev.filter(n => n.id !== temp.id))
      setDraft(content)
    } finally {
      setSaving(false)
    }
  }

  async function deleteNote(id: string) {
    setNotes(prev => prev.filter(n => n.id !== id))
    await fetch(`/api/admin/clients/${clientId}/notes/${id}`, { method: 'DELETE' }).catch(() => {})
  }

  async function togglePin(note: Note) {
    const next = !note.pinned
    setNotes(prev => prev.map(n => n.id === note.id ? { ...n, pinned: next } : n)
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return b.pinned ? 1 : -1
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      }))
    await fetch(`/api/admin/clients/${clientId}/notes/${note.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: next }),
    }).catch(() => {})
  }

  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <p style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: '0.6rem' }}>
        Notes
      </p>

      {/* Add note */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: '0.75rem' }}>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void addNote() }
          }}
          placeholder="Add a note… (⌘↵ to save)"
          rows={2}
          style={{
            width: '100%', resize: 'vertical', padding: '0.5rem 0.625rem',
            background: 'var(--bg-subtle)', border: '1px solid var(--border)',
            borderRadius: 6, fontSize: '0.8rem', color: 'var(--text)',
            fontFamily: 'inherit', boxSizing: 'border-box',
          }}
        />
        <button
          onClick={() => void addNote()}
          disabled={!draft.trim() || saving}
          style={{
            alignSelf: 'flex-end', padding: '0.25rem 0.75rem',
            background: 'var(--blue)', color: '#fff', border: 'none',
            borderRadius: 5, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
            opacity: !draft.trim() || saving ? 0.5 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Add Note'}
        </button>
      </div>

      {/* Notes list */}
      {loading && (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>Loading…</p>
      )}
      {!loading && notes.length === 0 && (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>No notes yet.</p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {notes.map(note => (
          <div
            key={note.id}
            style={{
              padding: '0.5rem 0.625rem',
              background: note.pinned ? 'var(--yellow-subtle, rgba(234,179,8,0.08))' : 'var(--bg-subtle)',
              border: `1px solid ${note.pinned ? 'rgba(234,179,8,0.25)' : 'var(--border)'}`,
              borderRadius: 6,
              position: 'relative',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <Initials name={note.users?.name ?? null} avatarUrl={note.users?.avatar_url ?? null} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-faint)' }}>
                    {note.users?.name ?? 'Admin'} · {relativeTime(note.created_at)}
                    {note.pinned && <span style={{ marginLeft: 5, color: 'var(--yellow, #ca8a04)', fontSize: '0.6rem' }}>pinned</span>}
                  </span>
                  <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                    <button
                      onClick={() => void togglePin(note)}
                      title={note.pinned ? 'Unpin' : 'Pin'}
                      style={{ padding: 3, background: 'none', border: 'none', cursor: 'pointer', color: note.pinned ? 'var(--yellow, #ca8a04)' : 'var(--text-faint)', borderRadius: 4 }}
                    >
                      <PushPin size={12} weight={note.pinned ? 'fill' : 'regular'} aria-hidden />
                    </button>
                    <button
                      onClick={() => void deleteNote(note.id)}
                      title="Delete note"
                      style={{ padding: 3, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', borderRadius: 4 }}
                    >
                      <Trash size={12} aria-hidden />
                    </button>
                  </div>
                </div>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {note.content}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

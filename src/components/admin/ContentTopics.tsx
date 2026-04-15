'use client'

import { useState, useEffect, useCallback } from 'react'

interface ClientOption {
  id:   string
  name: string
}

interface Topic {
  id:                  string
  client_id:           string
  topic:               string
  rationale:           string | null
  target_keyword:      string | null
  status:              'pending' | 'approved' | 'rejected' | 'generating' | 'generated' | 'scheduled'
  target_publish_date: string | null
  generate_by_date:    string | null
  post_id:             string | null
  created_at:          string
  post?: {
    id:           string
    title:        string | null
    status:       string
    published_url: string | null
  } | null
}

const STATUS_COLORS: Record<string, string> = {
  pending:    'badge-amber',
  approved:   'badge-green',
  rejected:   'badge-red',
  generating: 'badge-blue',
  generated:  'badge-green',
  scheduled:  'badge-blue',
}

const STATUS_LABELS: Record<string, string> = {
  pending:    'Pending',
  approved:   'Approved',
  rejected:   'Rejected',
  generating: 'Generating…',
  generated:  'Ready',
  scheduled:  'Scheduled',
}

function formatDate(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ContentTopics({ clients }: { clients: ClientOption[] }) {
  const [clientId,    setClientId]    = useState<string>(clients[0]?.id ?? '')
  const [topics,      setTopics]      = useState<Topic[]>([])
  const [loading,     setLoading]     = useState(false)
  const [generating,  setGenerating]  = useState(false)
  const [generateCount, setGenerateCount] = useState(5)
  const [genError,    setGenError]    = useState('')
  const [expandedId,  setExpandedId]  = useState<string | null>(null)
  const [patchingId,  setPatchingId]  = useState<string | null>(null)
  const [dateValues,  setDateValues]  = useState<Record<string, string>>({})

  const loadTopics = useCallback(async (cid: string) => {
    if (!cid) return
    setLoading(true)
    try {
      const res  = await fetch(`/api/admin/content/topics?client_id=${cid}`)
      const data = await res.json() as Topic[]
      setTopics(Array.isArray(data) ? data : [])
    } catch {
      setTopics([])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadTopics(clientId)
  }, [clientId, loadTopics])

  async function handleGenerate() {
    if (!clientId) return
    setGenerating(true); setGenError('')
    try {
      const res  = await fetch('/api/admin/content/topics/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, count: generateCount }),
      })
      const data = await res.json()
      if (!res.ok) { setGenError(data.error || 'Generation failed'); return }
      await loadTopics(clientId)
    } catch (err) {
      setGenError(String(err))
    } finally {
      setGenerating(false)
    }
  }

  async function patch(id: string, fields: { status?: string; target_publish_date?: string | null }) {
    setPatchingId(id)
    const res = await fetch(`/api/admin/content/topics/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    })
    if (res.ok) {
      const updated = await res.json() as Topic
      setTopics(prev => prev.map(t => t.id === id ? { ...t, ...updated } : t))
    }
    setPatchingId(null)
  }

  async function deleteTopic(id: string) {
    if (!confirm('Delete this topic idea?')) return
    await fetch(`/api/admin/content/topics/${id}`, { method: 'DELETE' })
    setTopics(prev => prev.filter(t => t.id !== id))
  }

  const pending   = topics.filter(t => t.status === 'pending')
  const approved  = topics.filter(t => t.status === 'approved')
  const rest      = topics.filter(t => t.status !== 'pending' && t.status !== 'approved')

  const ordered   = [...pending, ...approved, ...rest]

  if (clients.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No clients yet.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 780 }}>

      {/* ── Header controls ── */}
      <div className="card p-5">
        <div className="flex items-center gap-3 flex-wrap">
          <div style={{ flex: 1, minWidth: 200 }}>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Client</label>
            <select
              className="input"
              value={clientId}
              onChange={e => setClientId(e.target.value)}
              style={{ width: '100%' }}
            >
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div style={{ width: 80 }}>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Count</label>
            <input
              className="input"
              type="number"
              min={1}
              max={10}
              value={generateCount}
              onChange={e => setGenerateCount(Number(e.target.value))}
            />
          </div>

          <div style={{ paddingTop: 20 }}>
            <button
              className="btn btn-primary"
              onClick={handleGenerate}
              disabled={generating || !clientId}
              style={{ whiteSpace: 'nowrap' }}
            >
              {generating ? 'Generating…' : '✦ Generate Topic Ideas'}
            </button>
          </div>

          <div style={{ paddingTop: 20 }}>
            <button
              className="btn btn-secondary"
              onClick={() => loadTopics(clientId)}
              disabled={loading}
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {genError && (
          <p className="text-xs mt-2" style={{ color: 'var(--red)' }}>{genError}</p>
        )}
        <p className="text-xs mt-2" style={{ color: 'var(--text-faint)' }}>
          Uses GSC data + client background to suggest targeted blog post ideas. Sends an email notification when done.
        </p>
      </div>

      {/* ── Topic list ── */}
      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading topics…</p>
      ) : ordered.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No topic ideas yet for this client.</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>Click "Generate Topic Ideas" to get started.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {ordered.map(topic => {
            const isExpanded = expandedId === topic.id
            const dateVal    = dateValues[topic.id] ?? topic.target_publish_date?.slice(0, 10) ?? ''

            return (
              <div
                key={topic.id}
                style={{
                  border:       '1px solid var(--border)',
                  borderRadius: 8,
                  overflow:     'hidden',
                  background:   topic.status === 'rejected' ? 'var(--bg-subtle)' : 'var(--bg-surface)',
                  opacity:      topic.status === 'rejected' ? 0.65 : 1,
                }}
              >
                {/* Row header */}
                <div
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                    padding: '0.75rem 1rem',
                    cursor: 'pointer',
                  }}
                  onClick={() => setExpandedId(isExpanded ? null : topic.id)}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 2 }}>
                      <span className={`badge ${STATUS_COLORS[topic.status] ?? 'badge-gray'}`} style={{ fontSize: '0.6875rem' }}>
                        {STATUS_LABELS[topic.status] ?? topic.status}
                      </span>
                      {topic.target_publish_date && (
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          Publishes {formatDate(topic.target_publish_date)}
                        </span>
                      )}
                      {topic.generate_by_date && topic.status === 'approved' && (
                        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                          · Generate by {formatDate(topic.generate_by_date)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)', lineHeight: 1.4 }}>{topic.topic}</p>
                    {topic.target_keyword && (
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Keyword: {topic.target_keyword}</p>
                    )}
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)', whiteSpace: 'nowrap', paddingTop: 2 }}>
                    {isExpanded ? '▲' : '▼'}
                  </span>
                </div>

                {/* Expanded panel */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>

                    {topic.rationale && (
                      <div>
                        <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rationale</p>
                        <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>{topic.rationale}</p>
                      </div>
                    )}

                    {/* Date picker (shown when approving or already approved) */}
                    {(topic.status === 'pending' || topic.status === 'approved') && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <div>
                          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Target Publish Date</label>
                          <input
                            type="date"
                            className="input"
                            value={dateVal}
                            onChange={e => setDateValues(p => ({ ...p, [topic.id]: e.target.value }))}
                            style={{ width: 160 }}
                          />
                        </div>
                        {dateVal && (
                          <div style={{ paddingTop: 20 }}>
                            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                              Post will auto-generate by {formatDate(
                                new Date(new Date(dateVal).getTime() - 7 * 86400000).toISOString()
                              )}
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Associated post */}
                    {topic.post && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Post:</span>
                        <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{topic.post.title ?? 'Untitled'}</span>
                        <span className={`badge ${topic.post.status === 'published' ? 'badge-green' : 'badge-amber'}`} style={{ fontSize: '0.625rem' }}>
                          {topic.post.status}
                        </span>
                        {topic.post.published_url && (
                          <a href={topic.post.published_url} target="_blank" rel="noopener noreferrer" className="text-xs" style={{ color: 'var(--blue)' }}>
                            View →
                          </a>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {topic.status === 'pending' && (
                        <>
                          <button
                            className="btn btn-primary"
                            style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
                            disabled={patchingId === topic.id}
                            onClick={() => patch(topic.id, {
                              status:              'approved',
                              target_publish_date: dateVal || null,
                            })}
                          >
                            Approve
                          </button>
                          <button
                            className="btn btn-secondary"
                            style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
                            disabled={patchingId === topic.id}
                            onClick={() => patch(topic.id, { status: 'rejected' })}
                          >
                            Reject
                          </button>
                        </>
                      )}

                      {topic.status === 'approved' && (
                        <>
                          <button
                            className="btn btn-secondary"
                            style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
                            disabled={patchingId === topic.id}
                            onClick={() => patch(topic.id, {
                              target_publish_date: dateVal || null,
                            })}
                          >
                            Update Date
                          </button>
                          <button
                            className="btn btn-secondary"
                            style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem', color: 'var(--text-muted)' }}
                            disabled={patchingId === topic.id}
                            onClick={() => patch(topic.id, { status: 'pending' })}
                          >
                            Un-approve
                          </button>
                        </>
                      )}

                      {topic.status === 'rejected' && (
                        <button
                          className="btn btn-secondary"
                          style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
                          disabled={patchingId === topic.id}
                          onClick={() => patch(topic.id, { status: 'pending' })}
                        >
                          Restore
                        </button>
                      )}

                      <button
                        style={{
                          marginLeft: 'auto',
                          background: 'none', border: 'none',
                          fontSize: '0.75rem', color: 'var(--text-faint)',
                          cursor: 'pointer', padding: '0.25rem 0.5rem',
                        }}
                        onClick={() => deleteTopic(topic.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

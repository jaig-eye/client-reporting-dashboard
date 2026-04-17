'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface TopicQueueItem {
  id:               string
  clientId:         string
  clientName:       string
  topic:            string
  targetKeyword:    string | null
  targetPublishDate: string | null
  status:           string
  rationale:        string | null
}

export default function TopicQueueTable({ topics }: { topics: TopicQueueItem[] }) {
  const router = useRouter()
  const [loadingId, setLoadingId] = useState<string | null>(null)

  async function updateStatus(id: string, status: 'approved' | 'rejected') {
    setLoadingId(id)
    try {
      await fetch(`/api/admin/content/topics/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      router.refresh()
    } finally {
      setLoadingId(null)
    }
  }

  if (topics.length === 0) return null

  return (
    <div className="card overflow-hidden">
      <table className="data-table">
        <thead>
          <tr>
            <th>Client</th>
            <th>Topic</th>
            <th>Keyword</th>
            <th>Publish Date</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {topics.map(t => (
            <tr key={t.id}>
              <td>
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {t.clientName}
                </span>
              </td>
              <td style={{ maxWidth: 260 }}>
                <span className="text-sm" style={{ color: 'var(--text-primary)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={t.rationale ?? t.topic}>
                  {t.topic}
                </span>
              </td>
              <td>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {t.targetKeyword ?? '—'}
                </span>
              </td>
              <td>
                {t.targetPublishDate ? (
                  <span className="badge badge-blue" style={{ fontSize: '0.6875rem' }}>
                    {new Date(t.targetPublishDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                ) : '—'}
              </td>
              <td>
                <span className={`badge ${t.status === 'approved' ? 'badge-green' : 'badge-amber'}`}
                      style={{ fontSize: '0.6875rem' }}>
                  {t.status}
                </span>
              </td>
              <td>
                <div style={{ display: 'flex', gap: '0.375rem' }}>
                  {t.status !== 'approved' && (
                    <button
                      onClick={() => updateStatus(t.id, 'approved')}
                      disabled={loadingId === t.id}
                      className="btn btn-primary"
                      style={{ padding: '0.25rem 0.625rem', fontSize: '0.75rem', opacity: loadingId === t.id ? 0.6 : 1 }}
                    >
                      Approve
                    </button>
                  )}
                  <button
                    onClick={() => updateStatus(t.id, 'rejected')}
                    disabled={loadingId === t.id}
                    className="btn btn-ghost"
                    style={{ padding: '0.25rem 0.625rem', fontSize: '0.75rem', opacity: loadingId === t.id ? 0.6 : 1 }}
                  >
                    Reject
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

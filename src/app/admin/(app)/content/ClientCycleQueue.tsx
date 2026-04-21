'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface CycleTopic {
  id:               string
  topic:            string
  targetKeyword:    string | null
  targetPublishDate: string | null
  status:           string
  rationale:        string | null
}

export interface ContentCycle {
  clientId:        string
  clientName:      string
  frequency:       string | null
  postsNeeded:     number
  topicsGenerated: number
  topicsApproved:  number
  nextPublishDate: string
  topicDeadline:   string
  topics:          CycleTopic[]
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function daysUntil(iso: string): number {
  return Math.round((new Date(iso + 'T00:00:00Z').getTime() - Date.now()) / 86_400_000)
}

function freqLabel(freq: string | null): string {
  const map: Record<string, string> = {
    daily:         'Daily',
    weekly:        'Weekly',
    biweekly:      'Biweekly',
    monthly:       'Monthly',
    monthly_first: 'Monthly (1st)',
    monthly_mid:   'Monthly (15th)',
    monthly_end:   'Monthly (28th)',
  }
  return freq ? (map[freq] ?? freq) : 'Global default'
}

const STATUS_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  pending:    { label: 'Pending',    bg: 'var(--bg-muted, #f3f4f6)', color: 'var(--text-muted)' },
  approved:   { label: 'Approved',   bg: '#dcfce7',                   color: '#166534'            },
  generating: { label: 'Generating', bg: '#dbeafe',                   color: '#1e40af'            },
  generated:  { label: 'Generated',  bg: '#dbeafe',                   color: '#1e40af'            },
  scheduled:  { label: 'Scheduled',  bg: '#ede9fe',                   color: '#5b21b6'            },
  rejected:   { label: 'Rejected',   bg: '#fee2e2',                   color: '#991b1b'            },
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_BADGE[status] ?? STATUS_BADGE.pending
  return (
    <span style={{
      display:      'inline-block',
      padding:      '2px 8px',
      borderRadius: 999,
      fontSize:     '0.6875rem',
      fontWeight:   600,
      background:   s.bg,
      color:        s.color,
    }}>
      {s.label}
    </span>
  )
}

function TopicRow({
  topic,
  onApprove,
  onReject,
  loading,
}: {
  topic:     CycleTopic
  onApprove: (id: string) => void
  onReject:  (id: string) => void
  loading:   boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const isPending = topic.status === 'pending'
  const isActionable = isPending

  return (
    <div style={{
      borderRadius: 8,
      border:       '1px solid var(--border, #e5e7eb)',
      background:   'var(--bg-base, #fff)',
      overflow:     'hidden',
    }}>
      <div style={{
        display:        'flex',
        alignItems:     'flex-start',
        gap:            '0.75rem',
        padding:        '0.625rem 0.875rem',
      }}>
        {/* Topic text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8375rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {topic.topic}
            </span>
            {topic.targetKeyword && (
              <span style={{
                fontSize: '0.6875rem', color: 'var(--text-faint)',
                padding: '1px 6px', borderRadius: 999,
                background: 'var(--bg-muted, #f3f4f6)',
              }}>
                {topic.targetKeyword}
              </span>
            )}
          </div>
          {topic.rationale && (
            <button
              onClick={() => setExpanded(e => !e)}
              style={{ fontSize: '0.7rem', color: 'var(--blue)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', marginTop: '0.2rem' }}
            >
              {expanded ? '▲ hide rationale' : '▼ rationale'}
            </button>
          )}
          {expanded && topic.rationale && (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.375rem', lineHeight: 1.5 }}>
              {topic.rationale}
            </p>
          )}
        </div>

        {/* Status + actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
          <StatusBadge status={topic.status} />
          {isActionable && (
            <>
              <button
                onClick={() => onApprove(topic.id)}
                disabled={loading}
                className="btn btn-primary"
                style={{ padding: '0.2rem 0.625rem', fontSize: '0.75rem' }}
              >
                Approve
              </button>
              <button
                onClick={() => onReject(topic.id)}
                disabled={loading}
                style={{
                  padding: '0.2rem 0.5rem', fontSize: '0.75rem',
                  background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function CycleCard({ cycle }: { cycle: ContentCycle }) {
  const router    = useRouter()
  const [loadingId,  setLoadingId]  = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genResult,  setGenResult]  = useState('')

  const daysToPublish  = daysUntil(cycle.nextPublishDate)
  const daysToDeadline = daysUntil(cycle.topicDeadline)
  const pastDeadline   = daysToDeadline < 0
  const closeDeadline  = daysToDeadline >= 0 && daysToDeadline <= 3

  const progressPct = cycle.postsNeeded > 0
    ? Math.min(100, Math.round((cycle.topicsApproved / cycle.postsNeeded) * 100))
    : 0
  const progressFilled = cycle.postsNeeded > 0
  const needsMoreApprovals = cycle.topicsApproved < cycle.postsNeeded

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

  async function generateTopics() {
    setGenerating(true); setGenResult('')
    try {
      const res  = await fetch('/api/admin/content/topics/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id:           cycle.clientId,
          target_publish_date: cycle.nextPublishDate,
        }),
      })
      const data = await res.json()
      setGenResult(res.ok
        ? `${data.count ?? 0} topic${data.count === 1 ? '' : 's'} generated`
        : data.error || 'Failed')
      if (res.ok) router.refresh()
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: '1rem', overflow: 'hidden' }}>
      {/* Card header */}
      <div style={{
        display:        'flex',
        alignItems:     'flex-start',
        justifyContent: 'space-between',
        gap:            '1rem',
        padding:        '0.875rem 1.25rem',
        background:     'var(--bg-subtle, #f8f9fa)',
        borderBottom:   '1px solid var(--border, #e5e7eb)',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {cycle.clientName}
            </span>
            <span style={{
              fontSize: '0.6875rem', fontWeight: 500, padding: '1px 7px', borderRadius: 999,
              background: 'var(--bg-muted, #f3f4f6)', color: 'var(--text-faint)',
            }}>
              {freqLabel(cycle.frequency)}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.3rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Publish: <strong style={{ color: 'var(--text-primary)' }}>{fmtDate(cycle.nextPublishDate)}</strong>
              {daysToPublish > 0 && <span style={{ color: 'var(--text-faint)' }}> ({daysToPublish}d)</span>}
            </span>
            <span style={{ fontSize: '0.75rem', color: pastDeadline ? '#dc2626' : closeDeadline ? '#d97706' : 'var(--text-muted)' }}>
              Topic deadline: <strong>{fmtDate(cycle.topicDeadline)}</strong>
              {pastDeadline
                ? <span style={{ color: '#dc2626' }}> (past deadline — approvals trigger immediate generation)</span>
                : daysToDeadline === 0
                  ? <span style={{ color: '#d97706' }}> (today)</span>
                  : closeDeadline
                    ? <span style={{ color: '#d97706' }}> ({daysToDeadline}d left)</span>
                    : <span style={{ color: 'var(--text-faint)' }}> ({daysToDeadline}d)</span>
              }
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexShrink: 0 }}>
          <button
            onClick={generateTopics}
            disabled={generating}
            className="btn btn-secondary"
            style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
          >
            {generating ? 'Generating…' : '▶ Generate Topics'}
          </button>
          {genResult && (
            <span style={{ fontSize: '0.75rem', color: genResult.includes('fail') || genResult.includes('error') ? 'var(--red)' : 'var(--green)' }}>
              {genResult}
            </span>
          )}
        </div>
      </div>

      {/* Progress bar + topic rows */}
      <div style={{ padding: '0.875rem 1.25rem' }}>
        {/* Approval progress */}
        {progressFilled && cycle.topicsGenerated > 0 && (
          <div style={{ marginBottom: '0.875rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.375rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {cycle.topicsApproved} of {cycle.postsNeeded} topic{cycle.postsNeeded !== 1 ? 's' : ''} approved
              </span>
              {needsMoreApprovals && (
                <span style={{ fontSize: '0.7rem', color: '#d97706' }}>
                  {cycle.postsNeeded - cycle.topicsApproved} more needed
                </span>
              )}
            </div>
            <div style={{ height: 6, borderRadius: 999, background: 'var(--bg-muted, #f3f4f6)', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width:  `${progressPct}%`,
                background: progressPct >= 100 ? '#16a34a' : '#2563eb',
                borderRadius: 999,
                transition: 'width 0.3s',
              }} />
            </div>
          </div>
        )}

        {/* Topics */}
        {cycle.topics.length === 0 ? (
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-faint)', textAlign: 'center', padding: '1rem 0' }}>
            No topics yet — click "Generate Topics" to start this cycle.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {cycle.topics.map(t => (
              <TopicRow
                key={t.id}
                topic={t}
                onApprove={id => updateStatus(id, 'approved')}
                onReject={id => updateStatus(id, 'rejected')}
                loading={loadingId === t.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function ClientCycleQueue({ cycles }: { cycles: ContentCycle[] }) {
  if (cycles.length === 0) return null
  return (
    <div>
      {cycles.map(c => <CycleCard key={c.clientId} cycle={c} />)}
    </div>
  )
}

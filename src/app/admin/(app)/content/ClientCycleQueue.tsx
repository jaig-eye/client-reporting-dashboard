'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface CycleTopic {
  id:                 string
  topic:              string
  targetKeyword:      string | null
  targetPublishDate:  string | null
  status:             string
  rationale:          string | null
  keywordOpportunity: string | null
  rankingStrategy:    string | null
  audienceIntent:     string | null
  whyNow:             string | null
  competitionLevel:   string | null
  generationError:    string | null
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
  queuedTopics:    CycleTopic[]
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

function RationaleFields({ topic }: { topic: CycleTopic }) {
  const hasStructured = topic.keywordOpportunity || topic.rankingStrategy || topic.audienceIntent || topic.whyNow || topic.competitionLevel
  if (!hasStructured && !topic.rationale) return null

  const fields: { label: string; value: string | null }[] = [
    { label: 'Keyword',     value: topic.keywordOpportunity },
    { label: 'Strategy',    value: topic.rankingStrategy    },
    { label: 'Audience',    value: topic.audienceIntent     },
    { label: 'Why now',     value: topic.whyNow             },
    { label: 'Competition', value: topic.competitionLevel   },
  ].filter(f => f.value)

  if (hasStructured && fields.length > 0) {
    return (
      <div style={{ marginTop: '0.375rem', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.15rem 0.625rem', fontSize: '0.7125rem' }}>
        {fields.map(f => (
          <>
            <span key={`${f.label}-k`} style={{ color: 'var(--text-faint)', fontWeight: 600, whiteSpace: 'nowrap' }}>{f.label}:</span>
            <span key={`${f.label}-v`} style={{ color: 'var(--text-muted)', lineHeight: 1.4 }}>{f.value}</span>
          </>
        ))}
      </div>
    )
  }

  return (
    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.375rem', lineHeight: 1.5 }}>
      {topic.rationale}
    </p>
  )
}

function TopicRow({
  topic,
  onApprove,
  onReject,
  loading,
  showActions = true,
}: {
  topic:       CycleTopic
  onApprove:   (id: string) => void
  onReject:    (id: string) => void
  loading:     boolean
  showActions?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const hasRationale = topic.keywordOpportunity || topic.rankingStrategy || topic.audienceIntent || topic.whyNow || topic.competitionLevel || topic.rationale
  const isGenerating = topic.status === 'generating'

  return (
    <div style={{
      borderRadius: 8,
      border:       '1px solid var(--border, #e5e7eb)',
      background:   'var(--bg-base, #fff)',
      overflow:     'hidden',
    }}>
      <div style={{
        display:    'flex',
        alignItems: 'flex-start',
        gap:        '0.75rem',
        padding:    '0.625rem 0.875rem',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8375rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {isGenerating && <span style={{ marginRight: 4 }}>⏳</span>}
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
            {topic.targetPublishDate && (
              <span style={{ fontSize: '0.6875rem', color: 'var(--text-faint)' }}>
                → {fmtDate(topic.targetPublishDate)}
              </span>
            )}
          </div>

          {hasRationale && (
            <button
              onClick={() => setExpanded(e => !e)}
              style={{ fontSize: '0.7rem', color: 'var(--blue)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', marginTop: '0.2rem' }}
            >
              {expanded ? '▲ hide rationale' : '▼ rationale'}
            </button>
          )}
          {expanded && <RationaleFields topic={topic} />}

          {topic.generationError && (
            <p style={{ fontSize: '0.7rem', color: 'var(--red)', marginTop: '0.25rem' }}>
              ⚠ {topic.generationError}
            </p>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
          <StatusBadge status={topic.status} />
          {showActions && topic.status === 'pending' && (
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
  const [queueOpen,  setQueueOpen]  = useState(false)

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

  const queueCount = cycle.queuedTopics.length

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

      {/* Progress bar + pending topic rows */}
      <div style={{ padding: '0.875rem 1.25rem' }}>
        {/* Approval progress */}
        {progressFilled && queueCount > 0 && (
          <div style={{ marginBottom: '0.875rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.375rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {cycle.topicsApproved} of {cycle.postsNeeded} topic{cycle.postsNeeded !== 1 ? 's' : ''} queued for generation
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

        {/* Pending topics for this cycle */}
        {cycle.topics.length === 0 ? (
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-faint)', textAlign: 'center', padding: '1rem 0' }}>
            No topics pending — click "Generate Topics" to start this cycle.
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

        {/* Back-queue: approved/generating topics */}
        {queueCount > 0 && (
          <div style={{ marginTop: cycle.topics.length > 0 ? '0.875rem' : 0, borderTop: cycle.topics.length > 0 ? '1px solid var(--border, #e5e7eb)' : undefined, paddingTop: cycle.topics.length > 0 ? '0.75rem' : 0 }}>
            <button
              onClick={() => setQueueOpen(o => !o)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.375rem',
                fontSize: '0.775rem', fontWeight: 600, color: 'var(--text-muted)',
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: '0.6rem' }}>{queueOpen ? '▼' : '▶'}</span>
              {queueCount} topic{queueCount !== 1 ? 's' : ''} queued for generation
            </button>
            {queueOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', marginTop: '0.5rem' }}>
                {cycle.queuedTopics.map(t => (
                  <TopicRow
                    key={t.id}
                    topic={t}
                    onApprove={id => updateStatus(id, 'approved')}
                    onReject={id => updateStatus(id, 'rejected')}
                    loading={loadingId === t.id}
                    showActions={false}
                  />
                ))}
              </div>
            )}
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

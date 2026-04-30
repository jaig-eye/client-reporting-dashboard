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
      padding:      '1px 7px',
      borderRadius: 999,
      fontSize:     '0.6875rem',
      fontWeight:   600,
      background:   s.bg,
      color:        s.color,
      flexShrink:   0,
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
      <div style={{ marginTop: '0.25rem', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.1rem 0.5rem', fontSize: '0.7rem' }}>
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
    <p style={{ fontSize: '0.7125rem', color: 'var(--text-muted)', marginTop: '0.25rem', lineHeight: 1.4 }}>
      {topic.rationale}
    </p>
  )
}

function TopicRow({
  topic,
  onApprove,
  onReject,
  onGeneratePost,
  loading,
  showActions = true,
  showGeneratePost = false,
  postGenResult,
}: {
  topic:             CycleTopic
  onApprove:         (id: string) => void
  onReject:          (id: string) => void
  onGeneratePost?:   (id: string) => void
  loading:           boolean
  showActions?:      boolean
  showGeneratePost?: boolean
  postGenResult?:    string
}) {
  const [expanded, setExpanded] = useState(false)
  const hasRationale = topic.keywordOpportunity || topic.rankingStrategy || topic.audienceIntent || topic.whyNow || topic.competitionLevel || topic.rationale
  const isGenerating = topic.status === 'generating'

  return (
    <div style={{
      borderRadius: 6,
      border:       '1px solid var(--border, #e5e7eb)',
      background:   'var(--bg-base, #fff)',
    }}>
      <div style={{
        display:    'flex',
        alignItems: 'center',
        gap:        '0.5rem',
        padding:    '0.35rem 0.75rem',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {isGenerating && <span style={{ marginRight: 3 }}>⏳</span>}
              {topic.topic}
            </span>
            {topic.targetKeyword && (
              <span style={{
                fontSize: '0.6875rem', color: 'var(--text-faint)',
                padding: '1px 5px', borderRadius: 999,
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
            {hasRationale && (
              <button
                onClick={() => setExpanded(e => !e)}
                style={{ fontSize: '0.65rem', color: 'var(--blue)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                {expanded ? '▲' : '▼ rationale'}
              </button>
            )}
          </div>

          {expanded && <RationaleFields topic={topic} />}

          {topic.generationError && (
            <p style={{ fontSize: '0.6875rem', color: 'var(--red)', margin: '0.15rem 0 0' }}>
              ⚠ {topic.generationError}
            </p>
          )}
          {postGenResult && (
            <p style={{ fontSize: '0.6875rem', color: postGenResult === 'Post generated!' ? 'var(--green)' : 'var(--red)', margin: '0.15rem 0 0' }}>
              {postGenResult}
            </p>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
          <StatusBadge status={topic.status} />
          {showActions && topic.status === 'pending' && (
            <>
              <button
                onClick={() => onApprove(topic.id)}
                disabled={loading}
                className="btn btn-primary"
                style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem' }}
              >
                Schedule
              </button>
              <button
                onClick={() => onReject(topic.id)}
                disabled={loading}
                style={{
                  padding: '0.15rem 0.4rem', fontSize: '0.75rem',
                  background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </>
          )}
          {showGeneratePost && (topic.status === 'approved' || topic.generationError) && onGeneratePost && !isGenerating && (
            <button
              onClick={() => onGeneratePost(topic.id)}
              disabled={loading}
              className="btn btn-primary"
              style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem' }}
            >
              {loading ? '…' : 'Generate Post'}
            </button>
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

  const [cardOpen, setCardOpen] = useState(cycle.topics.length > 0)

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
    <div className="card" style={{ marginBottom: '0.5rem', overflow: 'hidden' }}>
      {/* Card header */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        gap:            '0.75rem',
        padding:        '0.5rem 1rem',
        background:     'var(--bg-subtle, #f8f9fa)',
        borderBottom:   cardOpen ? '1px solid var(--border, #e5e7eb)' : 'none',
      }}>
        {/* Left: client info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
            {cycle.clientName}
          </span>
          <a
            href={`/admin/clients/${cycle.clientId}?tab=content`}
            style={{ fontSize: '0.6875rem', color: 'var(--text-faint)', textDecoration: 'none', whiteSpace: 'nowrap', padding: '1px 6px', borderRadius: 4, border: '1px solid var(--border, #e5e7eb)' }}
          >
            Settings
          </a>
          <span style={{
            fontSize: '0.6875rem', fontWeight: 500, padding: '1px 6px', borderRadius: 999,
            background: 'var(--bg-muted, #f3f4f6)', color: 'var(--text-faint)', flexShrink: 0,
          }}>
            {freqLabel(cycle.frequency)}
          </span>
        </div>

        {/* Right: actions + toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
          <button
            onClick={generateTopics}
            disabled={generating}
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem' }}
          >
            {generating ? 'Generating…' : '▶ Generate Topics'}
          </button>
          {genResult && (
            <span style={{ fontSize: '0.7rem', color: genResult.includes('fail') || genResult.includes('error') ? 'var(--red)' : 'var(--green)' }}>
              {genResult}
            </span>
          )}
          <button
            onClick={() => setCardOpen(o => !o)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-faint)', fontSize: '0.75rem', padding: '0.25rem',
            }}
            title={cardOpen ? 'Collapse' : 'Expand'}
          >
            {cardOpen ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* Expanded body */}
      {cardOpen && (
        <div style={{ padding: '0.625rem 1rem' }}>
          {/* Pending topics for this cycle */}
          {cycle.topics.length === 0 ? (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-faint)', textAlign: 'center', padding: '0.75rem 0' }}>
              No topics pending — click "Generate Topics" to start this cycle.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
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
      )}
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

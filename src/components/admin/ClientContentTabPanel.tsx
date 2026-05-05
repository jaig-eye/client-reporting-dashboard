'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter }                 from 'next/navigation'
import ClientContentSettingsForm from './ClientContentSettingsForm'
import ClientSitemapTab          from './ClientSitemapTab'

// ─── Shared types ────────────────────────────────────────────────────────────

interface SiteOption {
  connectionId: string
  siteUrl:      string
  siteName:     string
  clientId:     string
  clientName:   string
}

type ContentSettings = Record<string, unknown> | null

export interface GscRow {
  page:              string | null
  query:             string | null
  impressions:       number | null
  clicks:            number | null
  ctr:               number | null
  position:          number | null
  recentlyTargeted?: boolean
}

interface QueueItem {
  type:               'post' | 'topic'
  id:                 string
  clientId:           string
  clientName:         string
  status:             string
  targetKeyword:      string | null
  title:              string | null
  topicText:          string | null
  wordCount:          number | null
  headingCount:       number | null
  internalLinks:      number | null
  generatedAt:        string
  generatedBy:        string
  publishedUrl:       string | null
  generateByDate:     string | null
  targetPublishDate:  string | null
  rationale:          string | null
  wpPostId:           number | null
  wpSiteUrl:          string | null
  keywordOpportunity?: string | null
  rankingStrategy?:   string | null
  audienceIntent?:    string | null
  whyNow?:            string | null
  competitionLevel?:  string | null
  generationError?:   string | null
  suggestedTitle?:    string | null
  searchVolume?:      number | null
  keywordDifficulty?: number | null
}

export interface GscData {
  quickWins:   GscRow[]
  growth:      GscRow[]
  lowCtr:      GscRow[]
  highVolume:  GscRow[]
}

interface Props {
  clientId:        string
  clientName:      string
  isEcom:          boolean
  sites:           SiteOption[]
  contentSettings: ContentSettings
  overviewStats: {
    upcomingTopicsCount: number
    nextPublishDate:     string | null
    recentPostsCount:    number
  }
  gscData:     GscData
  posts:       QueueItem[]
  postsPerRun: number
}

type SubTab = 'overview' | 'brand-dna' | 'sitemap' | 'priority' | 'gsc' | 'queue'

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'overview',  label: 'Overview'        },
  { id: 'brand-dna', label: 'Brand DNA'       },
  { id: 'sitemap',   label: 'Sitemap'         },
  { id: 'priority',  label: 'Priority Pages'  },
  { id: 'gsc',       label: 'GSC Insights'    },
  { id: 'queue',     label: 'Queue'           },
]

// ─── Main component ───────────────────────────────────────────────────────────

export default function ClientContentTabPanel({
  clientId, clientName, isEcom, sites, contentSettings, overviewStats, gscData, posts, postsPerRun,
}: Props) {
  const [activeTab, setActiveTab] = useState<SubTab>('overview')

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '0.375rem 0.875rem',
    fontSize: '0.8125rem',
    fontWeight: active ? 600 : 400,
    color: active ? 'var(--text-primary)' : 'var(--text-muted)',
    borderBottom: active ? '2px solid var(--accent, var(--blue))' : '2px solid transparent',
    textDecoration: 'none',
    background: 'none',
    border: 'none',
    borderBottomStyle: 'solid',
    borderBottomWidth: 2,
    borderBottomColor: active ? 'var(--accent, var(--blue))' : 'transparent',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    marginBottom: -1,
  })

  return (
    <div>
      {/* Sub-tab nav */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border)', marginBottom: '1.5rem', overflowX: 'auto' }}>
        {SUB_TABS.map(tab => (
          <button key={tab.id} style={tabStyle(activeTab === tab.id)} onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview'  && <OverviewTab clientId={clientId} settings={contentSettings} stats={overviewStats} />}
      {activeTab === 'brand-dna' && <ClientContentSettingsForm clientId={clientId} sites={sites} />}
      {activeTab === 'sitemap'   && <ClientSitemapTab clientId={clientId} />}
      {activeTab === 'priority'  && <PriorityTab clientId={clientId} />}
      {activeTab === 'gsc'       && <GscTab data={gscData} isEcom={isEcom} />}
      {activeTab === 'queue'     && (
        <QueueTab
          clientId={clientId}
          posts={posts.filter(p => p.clientId === clientId)}
          postsPerRun={postsPerRun}
        />
      )}
    </div>
  )
}

// ─── Overview sub-tab ─────────────────────────────────────────────────────────

const FREQ_LABELS: Record<string, string> = {
  daily:         'Daily',
  weekly:        'Weekly',
  biweekly:      'Every 2 weeks',
  monthly:       'Monthly (28-day)',
  monthly_first: 'Monthly — 1st',
  monthly_mid:   'Monthly — 15th',
  monthly_end:   'Monthly — 28th',
}
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

function OverviewTab({ clientId, settings, stats }: {
  clientId: string
  settings: ContentSettings
  stats:    Props['overviewStats']
}) {
  const [generating, setGenerating] = useState(false)
  const [genMsg,     setGenMsg]     = useState('')

  const s = settings as Record<string, unknown> | null

  async function generateTopics() {
    setGenerating(true)
    setGenMsg('')
    try {
      const res = await fetch('/api/admin/content/topics/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, count: s?.topics_per_run ?? 5 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error((data as { error?: string }).error || 'Failed to generate topics')
      setGenMsg(`Generated ${(data as { topics?: unknown[] }).topics?.length ?? 0} topics successfully.`)
    } catch (err) {
      setGenMsg(err instanceof Error ? err.message : 'Failed')
    } finally {
      setGenerating(false)
    }
  }

  const freq    = s?.schedule_frequency as string | null | undefined
  const dayNum  = s?.schedule_day_of_week as number | null | undefined
  const freqLabel = freq ? (FREQ_LABELS[freq] ?? freq) : 'Not configured'
  const dayLabel  = dayNum != null ? DAY_NAMES[dayNum] ?? String(dayNum) : null

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        <StatCard label="Upcoming Topics" value={String(stats.upcomingTopicsCount)} />
        <StatCard label="Posts This Month"  value={String(stats.recentPostsCount)} />
        <StatCard
          label="Next Publish"
          value={stats.nextPublishDate
            ? new Date(stats.nextPublishDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : '—'}
        />
      </div>

      <div className="card p-5 mb-4">
        <h3 style={{ margin: '0 0 12px', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Schedule
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px' }}>
          <InfoRow label="Frequency"     value={freqLabel} />
          {dayLabel && <InfoRow label="Day"        value={dayLabel} />}
          {!!s?.publish_time   && <InfoRow label="Publish Time" value={String(s.publish_time)} />}
          <InfoRow label="Posts / Run"   value={String(s?.posts_per_run ?? 1)} />
          <InfoRow label="Topics / Run"  value={String(s?.topics_per_run ?? 5)} />
          <InfoRow label="Weeks Ahead"   value={String(s?.weeks_ahead ?? 4)} />
          {s?.generate_lead_days != null && (
            <InfoRow label="Lead Days" value={String(s.generate_lead_days)} />
          )}
          <InfoRow label="Auto-generate" value={s?.auto_generate ? 'On' : 'Off'} />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={generateTopics}
          disabled={generating}
          className="btn btn-primary"
          style={{ fontSize: '0.8125rem' }}
        >
          {generating ? 'Generating…' : '✦ Generate Topics Now'}
        </button>
        {genMsg && (
          <span style={{ fontSize: '0.8125rem', color: genMsg.includes('success') ? 'var(--green)' : 'var(--red)' }}>
            {genMsg}
          </span>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
        {value}
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
        {label}
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', fontSize: '0.8125rem' }}>
      <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{label}:</span>
      <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{value}</span>
    </div>
  )
}

// ─── Queue sub-tab ────────────────────────────────────────────────────────────

function QueueTab({ clientId: _clientId, posts: initialPosts, postsPerRun }: {
  clientId:    string
  posts:       QueueItem[]
  postsPerRun: number
}) {
  const router = useRouter()
  const [items,        setItems]        = useState(initialPosts)
  const [generatingIds,setGeneratingIds]= useState<Set<string>>(new Set())
  const [errors,       setErrors]       = useState<Record<string, string>>({})
  const [deletingIds,  setDeletingIds]  = useState<Set<string>>(new Set())
  const [rationaleFor, setRationaleFor] = useState<QueueItem | null>(null)

  useEffect(() => { setItems(initialPosts) }, [initialPosts])

  const topics   = items.filter(i => i.type === 'topic')
  const postItems= items.filter(i => i.type === 'post')

  // Cycle window = topics with a targetPublishDate within next 35 days
  const cycleWindowDate = new Date(Date.now() + 35 * 86_400_000).toISOString().slice(0, 10)
  const approvedInCycle = topics.filter(t =>
    ['approved', 'generating', 'generated'].includes(t.status) &&
    t.targetPublishDate != null && t.targetPublishDate <= cycleWindowDate
  ).length
  const remaining = Math.max(0, postsPerRun - approvedInCycle)

  const pendingTopics   = topics.filter(t => ['pending', 'scheduled'].includes(t.status))
  const inProgressTopics= topics.filter(t => ['approved', 'generating'].includes(t.status))
  const generatedTopics = topics.filter(t => t.status === 'generated')

  const approveTopic = useCallback(async (topic: QueueItem) => {
    if (generatingIds.has(topic.id)) return
    setGeneratingIds(prev => new Set(prev).add(topic.id))
    setErrors(prev => { const n = { ...prev }; delete n[topic.id]; return n })
    setItems(prev => prev.map(i => i.id === topic.id ? { ...i, status: 'generating' } : i))

    try {
      const patchRes = await fetch(`/api/admin/content/topics/${topic.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      })
      if (!patchRes.ok) throw new Error(((await patchRes.json()) as { error?: string }).error || 'Failed')
      fetch('/api/admin/content/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic_id: topic.id }),
        keepalive: true,
      }).then(() => router.refresh()).catch(() => router.refresh())
    } catch (err) {
      setErrors(prev => ({ ...prev, [topic.id]: err instanceof Error ? err.message : 'Failed' }))
      setItems(prev => prev.map(i => i.id === topic.id ? { ...i, status: topic.status } : i))
    } finally {
      setGeneratingIds(prev => { const n = new Set(prev); n.delete(topic.id); return n })
    }
  }, [generatingIds, router])

  const deleteTopic = useCallback(async (id: string) => {
    if (deletingIds.has(id)) return
    setDeletingIds(prev => new Set(prev).add(id))
    try {
      await fetch(`/api/admin/content/topics/${id}`, { method: 'DELETE' })
      setItems(prev => prev.filter(i => i.id !== id))
    } finally {
      setDeletingIds(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }, [deletingIds])

  const thStyle: React.CSSProperties = {
    padding: '6px 10px', textAlign: 'left', fontSize: '0.6875rem', fontWeight: 600,
    color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em',
    borderBottom: '1px solid var(--border)', background: 'var(--bg-muted)',
  }
  const tdStyle: React.CSSProperties = {
    padding: '8px 10px', fontSize: '0.8125rem', color: 'var(--text-primary)',
    borderBottom: '1px solid var(--border)',
  }

  return (
    <div>
      {/* ── Cycle context ─────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20,
        padding: '10px 14px', borderRadius: 8,
        background: remaining > 0 ? 'rgba(245,158,11,0.08)' : 'rgba(16,185,129,0.08)',
        border: `1px solid ${remaining > 0 ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.3)'}`,
        fontSize: '0.8125rem',
      }}>
        <span style={{ color: 'var(--text-muted)' }}>
          This cycle needs <strong style={{ color: 'var(--text-primary)' }}>{postsPerRun}</strong> post{postsPerRun !== 1 ? 's' : ''}
        </span>
        <span style={{ color: 'var(--text-faint)' }}>·</span>
        <span style={{ color: 'var(--text-muted)' }}>
          <strong style={{ color: '#16a34a' }}>{approvedInCycle}</strong> approved
        </span>
        {remaining > 0 && (
          <>
            <span style={{ color: 'var(--text-faint)' }}>·</span>
            <span style={{ color: '#d97706', fontWeight: 600 }}>approve {remaining} more</span>
          </>
        )}
        {remaining === 0 && approvedInCycle > 0 && (
          <>
            <span style={{ color: 'var(--text-faint)' }}>·</span>
            <span style={{ color: '#16a34a', fontWeight: 600 }}>cycle complete ✓</span>
          </>
        )}
      </div>

      {/* ── Topics section ────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 32 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Topics
        </h3>

        {topics.length === 0 ? (
          <div className="card p-5" style={{ textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              No topics yet. Use the Overview tab to generate topics for this client.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Topic</th>
                  <th style={thStyle}>Keyword</th>
                  <th style={{ ...thStyle, width: 100 }}>Publish Date</th>
                  <th style={{ ...thStyle, width: 80 }}>Competition</th>
                  <th style={{ ...thStyle, width: 110 }}>Status</th>
                  <th style={{ ...thStyle, width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {[...pendingTopics, ...inProgressTopics, ...generatedTopics].map(topic => {
                  const isGen   = generatingIds.has(topic.id) || topic.status === 'generating'
                  const isDel   = deletingIds.has(topic.id)
                  const comp    = topic.competitionLevel?.split(/[\s,]/)[0]?.toLowerCase()
                  const compBadge = comp === 'low' ? { bg: '#dcfce7', color: '#166534' }
                    : comp === 'high' ? { bg: '#fee2e2', color: '#991b1b' }
                    : { bg: 'var(--bg-muted)', color: 'var(--text-muted)' }

                  return (
                    <tr key={topic.id} style={{ opacity: isDel ? 0.4 : 1, transition: 'opacity 0.2s' }}>
                      <td style={{ ...tdStyle, maxWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span
                            onClick={() => setRationaleFor(topic)}
                            style={{
                              display: 'block', overflow: 'hidden', textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap', fontStyle: 'italic', maxWidth: 300,
                              color: 'var(--text-primary)', cursor: 'pointer',
                            }}
                            title="Click to view rationale"
                          >
                            {topic.topicText}
                          </span>
                          {(topic.keywordOpportunity || topic.rankingStrategy || topic.rationale) && (
                            <button
                              onClick={() => setRationaleFor(topic)}
                              title="View rationale"
                              style={{
                                flexShrink: 0, background: 'none', border: '1px solid var(--border)',
                                borderRadius: '50%', width: 16, height: 16, fontSize: '0.5625rem',
                                cursor: 'pointer', color: 'var(--text-faint)', lineHeight: 1,
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              }}
                            >
                              ⓘ
                            </button>
                          )}
                        </div>
                        {errors[topic.id] && (
                          <span style={{ display: 'block', fontSize: '0.6875rem', color: '#ef4444', marginTop: 2 }}>
                            {errors[topic.id]}
                          </span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        {topic.targetKeyword && (
                          <span style={{
                            display: 'inline-block', padding: '2px 8px', borderRadius: 999,
                            background: 'var(--bg-muted)', color: 'var(--text-muted)',
                            fontSize: '0.6875rem', maxWidth: 140,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {topic.targetKeyword}
                          </span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        {topic.targetPublishDate
                          ? new Date(topic.targetPublishDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          : '—'}
                      </td>
                      <td style={tdStyle}>
                        {comp && (
                          <span style={{
                            display: 'inline-block', padding: '2px 8px', borderRadius: 999,
                            background: compBadge.bg, color: compBadge.color,
                            fontSize: '0.6875rem', fontWeight: 600, textTransform: 'capitalize',
                          }}>
                            {comp}
                          </span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        {isGen ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#3b82f6', fontSize: '0.75rem' }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6', animation: 'pulse 1.5s ease-in-out infinite' }} />
                            Generating…
                          </span>
                        ) : topic.status === 'generated' ? (
                          <span style={{ color: '#16a34a', fontSize: '0.75rem', fontWeight: 600 }}>Generated ✓</span>
                        ) : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <span style={{
                              width: 6, height: 6, borderRadius: '50%',
                              background: topic.status === 'pending' ? '#f59e0b' : '#6366f1',
                            }} />
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                              {topic.status}
                            </span>
                          </span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {!isGen && topic.status !== 'generated' && (
                          <div style={{ display: 'inline-flex', gap: 4 }}>
                            <button
                              onClick={() => approveTopic(topic)}
                              disabled={isGen}
                              className="btn btn-primary"
                              style={{ fontSize: '0.6875rem', padding: '3px 10px' }}
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => deleteTopic(topic.id)}
                              disabled={isDel}
                              style={{
                                fontSize: '0.6875rem', padding: '3px 7px', border: 'none',
                                background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer',
                              }}
                              title="Delete topic"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                        {topic.status === 'generated' && (
                          <button
                            onClick={() => deleteTopic(topic.id)}
                            disabled={isDel}
                            style={{
                              fontSize: '0.6875rem', padding: '3px 7px', border: 'none',
                              background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer',
                            }}
                            title="Delete topic"
                          >
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Posts section ─────────────────────────────────────────────────────── */}
      <div>
        <h3 style={{ margin: '0 0 12px', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Posts on WordPress
        </h3>

        {postItems.length === 0 ? (
          <div className="card p-5" style={{ textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              No posts generated yet. Approve a topic above to start generating.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Title</th>
                  <th style={{ ...thStyle, width: 90 }}>Status</th>
                  <th style={{ ...thStyle, width: 80, textAlign: 'right' }}>Words</th>
                  <th style={{ ...thStyle, width: 100 }}>Publish Date</th>
                  <th style={{ ...thStyle, width: 120 }}></th>
                </tr>
              </thead>
              <tbody>
                {postItems.map(post => {
                  const statusCfg: Record<string, { bg: string; color: string; label: string }> = {
                    draft_saved: { bg: '#dcfce7', color: '#166534', label: 'On WP'      },
                    published:   { bg: '#bbf7d0', color: '#14532d', label: 'Published'  },
                    pending:     { bg: '#fef3c7', color: '#92400e', label: 'Pending'    },
                    rejected:    { bg: '#fee2e2', color: '#991b1b', label: 'Rejected'   },
                  }
                  const sc = statusCfg[post.status] ?? { bg: 'var(--bg-muted)', color: 'var(--text-muted)', label: post.status }

                  return (
                    <tr key={post.id}>
                      <td style={{ ...tdStyle, maxWidth: 0 }}>
                        <span style={{
                          display: 'block', overflow: 'hidden', textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap', fontWeight: 500, maxWidth: 360,
                        }}>
                          {post.title ?? post.targetKeyword ?? '—'}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 999,
                          background: sc.bg, color: sc.color,
                          fontSize: '0.6875rem', fontWeight: 600,
                        }}>
                          {sc.label}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                        {post.wordCount?.toLocaleString() ?? '—'}
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        {post.targetPublishDate
                          ? new Date(post.targetPublishDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          : '—'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                          {post.wpPostId && post.wpSiteUrl && (
                            <a
                              href={`${post.wpSiteUrl}/wp-admin/post.php?post=${post.wpPostId}&action=edit`}
                              target="_blank" rel="noopener noreferrer"
                              style={{ fontSize: '0.6875rem', color: 'var(--blue)', textDecoration: 'none', fontWeight: 500 }}
                            >
                              Edit in WP ↗
                            </a>
                          )}
                          {post.publishedUrl && (
                            <a
                              href={post.publishedUrl}
                              target="_blank" rel="noopener noreferrer"
                              style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textDecoration: 'none' }}
                            >
                              View ↗
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Rationale modal ───────────────────────────────────────────────────── */}
      {rationaleFor && (
        <div
          onClick={() => setRationaleFor(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-surface)', borderRadius: 12, padding: 24,
              maxWidth: 520, width: '100%', maxHeight: '80vh', overflowY: 'auto',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <p style={{ margin: '0 0 4px', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)', fontWeight: 600 }}>
                  Topic Rationale
                </p>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', fontStyle: 'italic' }}>
                  {rationaleFor.topicText}
                </h3>
              </div>
              <button
                onClick={() => setRationaleFor(null)}
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: 'var(--text-faint)', lineHeight: 1, marginLeft: 12, flexShrink: 0 }}
              >
                ✕
              </button>
            </div>

            {/* SEO stats */}
            {(rationaleFor.searchVolume != null || rationaleFor.keywordDifficulty != null || rationaleFor.competitionLevel) && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                {rationaleFor.targetKeyword && (
                  <span style={{ padding: '3px 10px', borderRadius: 999, background: 'var(--bg-muted)', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                    {rationaleFor.targetKeyword}
                  </span>
                )}
                {rationaleFor.searchVolume != null && (
                  <span style={{ padding: '3px 10px', borderRadius: 999, background: '#ede9fe', color: '#5b21b6', fontSize: '0.75rem' }}>
                    {rationaleFor.searchVolume.toLocaleString()} searches/mo
                  </span>
                )}
                {rationaleFor.keywordDifficulty != null && (
                  <span style={{ padding: '3px 10px', borderRadius: 999, background: '#fef3c7', color: '#92400e', fontSize: '0.75rem' }}>
                    KD {rationaleFor.keywordDifficulty}
                  </span>
                )}
              </div>
            )}

            {/* Rationale sections */}
            {[
              { key: 'keywordOpportunity', label: 'Keyword Opportunity', color: '#2563eb', bg: '#eff6ff' },
              { key: 'rankingStrategy',    label: 'Ranking Strategy',    color: '#7c3aed', bg: '#f5f3ff' },
              { key: 'audienceIntent',     label: 'Audience Intent',     color: '#059669', bg: '#f0fdf4' },
              { key: 'whyNow',             label: 'Why Now',             color: '#d97706', bg: '#fffbeb' },
              { key: 'competitionLevel',   label: 'Competition',         color: '#dc2626', bg: '#fef2f2' },
            ].map(({ key, label, color, bg }) => {
              const val = rationaleFor[key as keyof QueueItem] as string | null | undefined
              if (!val) return null
              return (
                <div key={key} style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: bg, borderLeft: `3px solid ${color}` }}>
                  <p style={{ margin: '0 0 4px', fontSize: '0.6875rem', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {label}
                  </p>
                  <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                    {val}
                  </p>
                </div>
              )
            })}

            {/* Fallback: raw rationale */}
            {!rationaleFor.keywordOpportunity && !rationaleFor.rankingStrategy && rationaleFor.rationale && (
              <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--bg-muted)' }}>
                <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                  {rationaleFor.rationale}
                </p>
              </div>
            )}

            {rationaleFor.generationError && (
              <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: '#fef2f2' }}>
                <p style={{ margin: '0 0 4px', fontSize: '0.6875rem', fontWeight: 700, color: '#dc2626', textTransform: 'uppercase' }}>Generation Error</p>
                <p style={{ margin: 0, fontSize: '0.8125rem', color: '#dc2626' }}>{rationaleFor.generationError}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Priority Pages sub-tab ───────────────────────────────────────────────────

type PriorityPage = { url: string; title: string | null }

function PriorityTab({ clientId }: { clientId: string }) {
  const [pages,   setPages]   = useState<PriorityPage[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    fetch(`/api/admin/content/sitemap-pages?client_id=${clientId}`)
      .then(r => r.json())
      .then((data: { url: string; title: string | null; isPriority: boolean }[]) => {
        setPages(data.filter(p => p.isPriority))
        setLoading(false)
      })
      .catch(() => { setError('Failed to load pages'); setLoading(false) })
  }, [clientId])

  if (loading) return <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Loading…</p>
  if (error)   return <p style={{ fontSize: '0.8125rem', color: 'var(--red)' }}>{error}</p>

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Priority Pages
        </h3>
        <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          These pages are preferred when generating internal links — not always included, but chosen first when contextually relevant.
          Star pages in the Sitemap tab to add them here.
        </p>
      </div>

      {pages.length === 0 ? (
        <div className="card p-6" style={{ textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            No priority pages yet. Open the Sitemap tab and star pages to prioritize them.
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>URL</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', width: 220 }}>Title</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((page, i) => (
                <tr key={page.url} style={{ borderBottom: i < pages.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <td style={{ padding: '7px 10px', maxWidth: 0 }}>
                    <a href={page.url} target="_blank" rel="noopener noreferrer"
                      style={{ color: 'var(--blue)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                      {page.url}
                    </a>
                  </td>
                  <td style={{ padding: '7px 10px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
                    {page.title ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── GSC sub-tab ─────────────────────────────────────────────────────────────

function fmtImpr(n: number | null | undefined): string {
  if (!n) return '—'
  if (n >= 10000) return `${Math.round(n / 1000)}k`
  if (n >= 1000)  return `${(n / 1000).toFixed(1)}k`
  return n.toLocaleString()
}
function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—'
  return `${(n * 100).toFixed(1)}%`
}
function fmtPos(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toFixed(1)
}
function posColor(pos: number | null): string {
  if (!pos) return 'var(--text-muted)'
  if (pos <= 3)  return '#16a34a'
  if (pos <= 10) return '#d97706'
  return '#9ca3af'
}
function posBg(pos: number | null): string {
  if (!pos) return 'var(--bg-muted)'
  if (pos <= 3)  return '#dcfce7'
  if (pos <= 10) return '#fef3c7'
  return 'var(--bg-muted)'
}
function truncatePage(url: string, max = 44): string {
  try {
    const u    = new URL(url)
    const path = u.pathname
    return path.length > max ? '…' + path.slice(-(max - 1)) : path
  } catch {
    return url.length > max ? url.slice(0, max) + '…' : url
  }
}

function GscSection({
  badge, badgeColor, badgeBg, rows, search,
}: {
  badge: string; badgeColor: string; badgeBg: string
  rows:  GscRow[]; search: string
}) {
  const filtered = rows.filter(r => {
    if (!search) return true
    const q = search.toLowerCase()
    return (r.query ?? '').toLowerCase().includes(q) || (r.page ?? '').toLowerCase().includes(q)
  })
  if (filtered.length === 0) return null

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ marginBottom: 8 }}>
        <span style={{
          display: 'inline-block', padding: '2px 10px', borderRadius: 999,
          fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
          background: badgeBg, color: badgeColor, marginBottom: 4,
        }}>
          {badge}
        </span>
        <span style={{ marginLeft: 8, fontSize: '0.75rem', color: 'var(--text-faint)' }}>
          {filtered.length} keyword{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {(['Query','Page','Impr','Clicks','CTR','Position'] as const).map(h => (
                <th key={h} style={{
                  padding: '5px 8px', textAlign: h === 'Query' || h === 'Page' ? 'left' : 'right',
                  fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-faint)',
                  textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={i} style={{ borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <td style={{ padding: '6px 8px', color: 'var(--text-primary)', fontWeight: 500, maxWidth: 200 }}>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.query ?? ''}>
                    {r.query || '—'}
                  </span>
                  {r.recentlyTargeted && (
                    <span style={{ fontSize: '0.6rem', color: 'var(--text-faint)', background: 'var(--bg-muted)', padding: '1px 4px', borderRadius: 3 }}>↩ used</span>
                  )}
                </td>
                <td style={{ padding: '6px 8px', color: 'var(--blue)', maxWidth: 180 }}>
                  {r.page ? (
                    <a href={r.page} target="_blank" rel="noopener noreferrer"
                      title={r.page}
                      style={{ color: 'var(--blue)', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {truncatePage(r.page)}
                    </a>
                  ) : '—'}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>{fmtImpr(r.impressions)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>{r.clicks ?? '—'}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>{fmtPct(r.ctr)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                  <span style={{
                    display: 'inline-block', padding: '1px 6px', borderRadius: 4,
                    fontWeight: 600, fontSize: '0.75rem',
                    background: posBg(r.position), color: posColor(r.position),
                  }}>
                    {fmtPos(r.position)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function GscTab({ data, isEcom: _isEcom }: { data: GscData; isEcom: boolean }) {
  const [search, setSearch] = useState('')

  const isEmpty = data.quickWins.length === 0 && data.growth.length === 0
    && data.lowCtr.length === 0 && data.highVolume.length === 0

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>GSC Insights</h3>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            28-day data. Keywords ranked below position 20 are the strongest candidates for new articles.
          </p>
        </div>
        {!isEmpty && (
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter keywords or pages…"
            className="input"
            style={{ marginLeft: 'auto', maxWidth: 260, fontSize: '0.8125rem', padding: '0.375rem 0.625rem' }}
          />
        )}
      </div>

      {isEmpty ? (
        <div className="card p-6" style={{ textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            No GSC data yet. Connect Google Search Console and run a sync.
          </p>
        </div>
      ) : (
        <div className="card p-5">
          <GscSection badge="Growth Opportunities" badgeColor="#92400e" badgeBg="#fef3c7" rows={data.growth}     search={search} />
          <GscSection badge="Quick Wins"           badgeColor="#166534" badgeBg="#dcfce7" rows={data.quickWins}  search={search} />
          <GscSection badge="Low CTR"              badgeColor="#1e3a8a" badgeBg="#dbeafe" rows={data.lowCtr}     search={search} />
          <GscSection badge="High Volume Low Rank" badgeColor="#6b21a8" badgeBg="#f3e8ff" rows={data.highVolume} search={search} />
        </div>
      )}
    </div>
  )
}

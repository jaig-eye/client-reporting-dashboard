'use client'

// The components on this page are the production ones, unmodified. Only the data is invented.
// Every handler is a no-op: this page is for looking, not for doing.

import { useState } from 'react'
import ThemeProvider from '@/components/ThemeProvider'
import Sidebar from '@/components/admin/Sidebar'
import IntegrationCard from '@/components/admin/IntegrationCard'
import MonthlyReviewPostCard, { type MonthlyReviewPost } from '@/components/admin/MonthlyReviewPostCard'
import PipelineCard, { type Topic, type Post, type RowItem } from '@/components/admin/PipelineCard'
import QualityFindings from '@/components/admin/QualityFindings'
import CollapsibleSection from '@/components/admin/CollapsibleSection'
import type { QualityReport } from '@/lib/content/qualityGate'
import type { SeoScore } from '@/lib/content/types'

const noop = () => {}

// ── Dummy data ──────────────────────────────────────────────────────────────────

const qualityReport: QualityReport = {
  findings: [
    { code: 'kw_titlecase', severity: 'warning', message: 'The keyword is title-cased in 4 headings, which reads as stuffing.', evidence: ['What Does A Downpipe Do', 'Downpipe Cost Guide'] },
    { code: 'no_faq',       severity: 'info',    message: 'No FAQ section. Question-led posts usually earn one.' },
  ],
  score: 82,
  blocksAutoPush: false,
  wordCount: 1480,
}

const criticalReport: QualityReport = {
  findings: [
    { code: 'broken_phone', severity: 'critical', message: 'A phone number in the article does not parse as dialable.', evidence: ['(555) 12-3456'] },
    { code: 'kw_titlecase', severity: 'warning',  message: 'The keyword is title-cased in 2 headings.' },
  ],
  score: 54,
  blocksAutoPush: true,
  wordCount: 960,
}

const longContent = '<p>' + 'The stock downpipe on a Ford EcoBoost is one of the most effective chokepoints in the exhaust. '.repeat(55) + '</p>'

const reviewPost: MonthlyReviewPost = {
  id: 'p1', client_id: 'c1', clientName: 'Ridgeline Auto Performance',
  title: 'Downpipe vs Stock Pipe: What Changes, What It Costs, and What It Does on an EcoBoost',
  content: longContent,
  seo_title: 'Downpipe vs Stock Pipe on an EcoBoost',
  meta_description: 'What an aftermarket downpipe changes on a Ford EcoBoost, what it costs, and when it is worth it.',
  featured_image_url: null,
  target_keyword: 'what does a downpipe do on an EcoBoost engine',
  target_publish_date: '2026-09-22',
  status: 'for_review', content_type: 'blog', connection_id: null,
  admin_approved_at: null,
  wp_post_id: null, wp_site_url: null, published_url: null,
  bc_post_id: null, bc_store_hash: null, isBc: false,
  quality_report: qualityReport,
}

const livePost: MonthlyReviewPost = {
  ...reviewPost,
  id: 'p2',
  title: 'Cold Air Intake vs Short Ram: Which Suits a Daily Driver?',
  target_keyword: 'cold air intake vs short ram',
  target_publish_date: '2026-09-15',
  status: 'published',
  admin_approved_at: '2026-09-12T15:04:00Z',
  wp_post_id: 1234,
  wp_site_url: 'https://ridgelineauto.example',
  published_url: 'https://ridgelineauto.example/blog/cold-air-intake-vs-short-ram',
  quality_report: null,
}

const failedPost: MonthlyReviewPost = {
  ...reviewPost,
  id: 'p3',
  title: 'Signs Your Turbo Wastegate Is Sticking (and What It Costs to Fix)',
  target_keyword: 'turbo wastegate sticking symptoms',
  target_publish_date: '2026-09-29',
  admin_approved_at: '2026-09-12T15:06:00Z',
  quality_report: criticalReport,
}

const rejectedPost: MonthlyReviewPost = {
  ...reviewPost,
  id: 'p4',
  title: 'The 10 Best Exhaust Tips of the Year',
  target_keyword: 'best exhaust tips',
  target_publish_date: '2026-10-06',
  status: 'rejected',
  quality_report: null,
}

const seoScore: SeoScore = {
  overall: 84,
  keyword_in_title: true, keyword_in_intro: true, keyword_in_headings: true,
  intent_match: true, heading_structure: true, internal_links_count: 3,
  local_relevance: true, cta_present: true, faq_present: false, meta_present: true,
  eat_signals: true, word_count_on_target: true, over_optimised: false, duplicate_warning: false,
  issues: [], warnings: ['No FAQ section'],
}

const topic: Topic = {
  id: 't1',
  topic: 'How often should you replace brake pads on a lifted truck?',
  target_keyword: 'brake pad replacement lifted truck',
  status: 'pending',
  target_publish_date: '2026-10-13',
  rationale: 'Local search interest has risen steadily, and no competitor answers it for lifted trucks specifically.',
  competition_level: 'low',
  search_intent: 'informational',
  keyword_opportunity: 'high',
  ranking_strategy: null,
  audience_intent: null,
  why_now: null,
  search_volume: 320,
  keyword_difficulty: 18,
  seo_brief: null,
}

const pipelinePost: Post = {
  id: 'pp1',
  topic_id: null,
  title: 'Cold Air Intake vs Short Ram: Which Suits a Daily Driver?',
  seo_title: null,
  target_keyword: 'cold air intake vs short ram',
  status: 'for_review',
  target_publish_date: '2026-10-20',
  word_count: 1320,
  featured_image_url: null,
  wp_post_id: null, wp_site_url: null, bc_post_id: null, bc_store_hash: null, published_url: null,
  seo_score: seoScore,
  keyword_rank: { current_position: 7, previous_position: 11, position_delta: 4 },
  generated_at: '2026-09-12T10:00:00Z',
}

const pipelineHandlers = {
  onToggleExpand: noop, onReview: noop, onGenerate: noop, onApprove: noop, onReject: noop,
  onRegenerateTopic: noop, onRetry: noop, onOpenEdit: noop, onEditTitleChange: noop,
  onEditNotesChange: noop, onSaveEdit: noop, onCancelEdit: noop, onPurge: noop,
}

const reviewHandlers = {
  onApprove: noop, onReject: noop, onOpenEditor: noop, onRestore: noop, onRegenerate: noop,
}

const users = [
  { name: 'Alex Rivera',  email: 'alex@agency.example',  role: 'admin',  active: true,  last: 'Sep 12, 2026' },
  { name: 'Jordan Blake', email: 'jordan@agency.example', role: 'admin',  active: true,  last: 'Never', pending: true },
  { name: 'Sam Okafor',   email: 'sam@agency.example',   role: 'viewer', active: false, last: 'Aug 30, 2026' },
]

// ── Page ────────────────────────────────────────────────────────────────────────

function Section({ id, title, desc, children }: { id: string; title: string; desc: string; children: React.ReactNode }) {
  return (
    <section data-section={id} style={{ marginBottom: 40, padding: 4 }}>
      <h2 className="section-title">{title}</h2>
      <p className="section-desc" style={{ marginBottom: 14 }}>{desc}</p>
      {children}
    </section>
  )
}

export default function DesignGallery() {
  const [openA, setOpenA] = useState(true)
  const [openB, setOpenB] = useState(false)

  const rows: RowItem[] = [
    { kind: 'topic', data: topic },
    { kind: 'post',  data: pipelinePost },
  ]

  return (
    <ThemeProvider initialMode="light" initialAccent="#2563eb">
      <div className="flex min-h-screen" style={{ background: 'var(--bg-base)' }}>
        <Sidebar
          agencyName="Launch Local"
          appVersion="5.4.0"
          userName="Alex Rivera"
          userEmail="alex@agency.example"
          isSuperAdmin={false}
          unreadAlertCount={3}
        />
        <div className="flex-1 min-w-0">
          <main className="p-8">
            <div className="page-header" data-section="header">
              <div>
                <h1 className="page-title">Design sandbox</h1>
                <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Real components and styles, made-up data. Local only — not served in production.
                </p>
              </div>
              <button className="btn btn-primary" type="button">+ Add User</button>
            </div>

            <Section id="controls" title="Controls" desc="Buttons, badges and form fields from the global stylesheet.">
              <div className="card p-6" style={{ display: 'grid', gap: 18 }}>
                <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
                  <button className="btn btn-primary" type="button">Save changes</button>
                  <button className="btn btn-secondary" type="button">Cancel</button>
                  <button className="btn btn-danger" type="button">Delete user</button>
                  <button className="btn btn-primary" type="button" disabled>Saving…</button>
                </div>
                <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                  <span className="badge badge-blue">admin</span>
                  <span className="badge badge-gray">viewer</span>
                  <span className="badge badge-green">Active</span>
                  <span className="badge badge-gray">Reset pending</span>
                </div>
                <div style={{ maxWidth: 360 }}>
                  <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Email address</label>
                  <input className="input" placeholder="jane@agency.com" defaultValue="" />
                </div>
              </div>
            </Section>

            <Section id="integrations" title="Integration cards" desc="Agency settings — connected and not connected.">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
                <IntegrationCard icon="🤖" name="AI Configuration" description="Provider, model, and API key used for content generation and topic suggestions." isConnected connectedLabel="anthropic / claude-sonnet-5" onConfigure={noop} />
                <IntegrationCard icon="📧" name="Email delivery" description="SMTP used for password reset codes and notification digests." isConnected={false} onConfigure={noop} />
                <IntegrationCard icon="💬" name="Discord" description="Alerts for failed pushes, budget runway and new leads." isConnected connectedLabel="ch: 1182…" onConfigure={noop} />
              </div>
            </Section>

            <Section id="review-cards" title="Monthly review cards" desc="For review, live on site, a failed push, and rejected.">
              <div style={{ display: 'grid', gap: 10 }}>
                <MonthlyReviewPostCard post={reviewPost}   isApproved={false} isRejected={false} isDiscarded={false} isRegenerating={false} isLoading={false} isCollapsed={false} brokenLinkCount={0} {...reviewHandlers} />
                <MonthlyReviewPostCard post={livePost}     isApproved isRejected={false} isDiscarded={false} isRegenerating={false} isLoading={false} isCollapsed={false} pushState="live" pushedUrl={livePost.published_url} {...reviewHandlers} />
                <MonthlyReviewPostCard post={failedPost}   isApproved isRejected={false} isDiscarded={false} isRegenerating={false} isLoading={false} isCollapsed={false} brokenLinkCount={2} pushState="failed" pushError="WordPress responded 401: the application password was rejected." onRetryPush={noop} {...reviewHandlers} />
                <MonthlyReviewPostCard post={rejectedPost} isApproved={false} isRejected isDiscarded={false} isRegenerating={false} isLoading={false} isCollapsed={false} {...reviewHandlers} />
              </div>
            </Section>

            <Section id="calendar-cards" title="Content calendar cards" desc="A pending topic slot and a generated post with its SEO score and rank.">
              <div style={{ display: 'grid', gap: 10 }}>
                {rows.map(item => (
                  <PipelineCard
                    key={`${item.kind}-${item.data.id}`}
                    item={item}
                    linkedPost={null}
                    expanded={item.kind === 'topic'}
                    editing={false}
                    editTitle=""
                    editNotes=""
                    loading={false}
                    purging={false}
                    {...pipelineHandlers}
                  />
                ))}
              </div>
            </Section>

            <Section id="quality" title="Quality findings" desc="The pre-publish quality gate, as a reviewer sees it.">
              <div className="card p-6" style={{ display: 'grid', gap: 12 }}>
                <QualityFindings report={qualityReport} />
                <QualityFindings report={criticalReport} />
                <QualityFindings report={{ findings: [], score: 96, blocksAutoPush: false, wordCount: 1600 }} />
              </div>
            </Section>

            <Section id="sections" title="Collapsible sections" desc="The review drawer's accordion.">
              <div style={{ maxWidth: 620 }}>
                <CollapsibleSection title="Content" open={openA} onToggle={() => setOpenA(o => !o)}>
                  <div style={{ padding: '4px 14px 14px', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    The stock downpipe on a Ford EcoBoost is one of the most effective chokepoints Ford’s engineers ever built into a performance engine.
                  </div>
                </CollapsibleSection>
                <CollapsibleSection title="SEO & meta" open={openB} onToggle={() => setOpenB(o => !o)} badge={<span className="badge badge-gray">16/18</span>}>
                  <div style={{ padding: '4px 14px 14px' }}>Hidden until opened.</div>
                </CollapsibleSection>
              </div>
            </Section>

            <Section id="table" title="Data table" desc="The users list.">
              <div className="card overflow-hidden">
                <table className="data-table">
                  <thead>
                    <tr><th>User</th><th>Role</th><th>Status</th><th>Last login</th><th></th></tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.email}>
                        <td>
                          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{u.name}</p>
                          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{u.email}</p>
                        </td>
                        <td><span className={`badge ${u.role === 'admin' ? 'badge-blue' : 'badge-gray'}`}>{u.role}</span></td>
                        <td>
                          <span className={`badge ${u.active ? 'badge-green' : 'badge-gray'}`}>{u.active ? 'Active' : 'Inactive'}</span>
                          {u.pending && <span className="badge badge-gray ml-1.5">Reset pending</span>}
                        </td>
                        <td><span className="text-xs" style={{ color: 'var(--text-muted)' }}>{u.last}</span></td>
                        <td><div className="flex justify-end"><button className="btn btn-secondary" type="button" style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}>Edit</button></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          </main>
        </div>
      </div>
    </ThemeProvider>
  )
}

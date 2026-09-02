'use client'

import LivePostActionModal, { type LiveMode } from '@/components/admin/LivePostActionModal'
import type { CmsAction } from '@/lib/content/cmsLifecycle'
import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import MonthlyReviewProgress   from './MonthlyReviewProgress'
import MonthlyReviewClientSection from './MonthlyReviewClientSection'
import MonthlyReviewComplete   from './MonthlyReviewComplete'
import ContentPostEditor       from './ContentPostEditor'
import { useMonthlyReviewSounds } from '@/lib/useMonthlyReviewSounds'
import type { MonthlyReviewPost } from './MonthlyReviewPostCard'

interface Site {
  connectionId:   string
  siteUrl:        string
  siteName:       string
  clientId:       string
  clientName:     string
  connectorType?: string
}

interface Props {
  posts:     MonthlyReviewPost[]
  allSites:  Site[]
  month:     string
  prevUrl?:  string | null
  nextUrl?:  string | null
  embedded?: boolean   // rendered inside the content page (softer chrome, no takeover)
}

function getMonth(): string {
  return new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export default function MonthlyReviewSession({ posts: initialPosts, allSites, month, prevUrl, nextUrl, embedded }: Props) {
  const [regeneratingIds, setRegeneratingIds] = useState<Set<string>>(() => {
    const pre = new Set<string>()
    for (const p of initialPosts) {
      if (p.status === 'generating') pre.add(p.id)
    }
    return pre
  })
  const [approvedIds,    setApprovedIds]    = useState<Set<string>>(() => {
    // Pre-populate only from posts actually pushed to a CMS (draft_saved).
    // approve_only posts (status='approved') have admin_approved_at but no platform ID —
    // they should remain actionable so the reviewer can trigger the push.
    const pre = new Set<string>()
    for (const p of initialPosts) {
      if (p.status === 'draft_saved') pre.add(p.id)
    }
    return pre
  })
  const [rejectedIds,    setRejectedIds]    = useState<Set<string>>(new Set())
  const [discardedIds,   setDiscardedIds]   = useState<Set<string>>(new Set())
  // Deleted posts are filtered out of the list entirely rather than badged, because
  // unlike reject/discard there is nothing left to act on or restore.
  const [deletedIds,     setDeletedIds]     = useState<Set<string>>(new Set())
  const [loadingId,      setLoadingId]      = useState<string | null>(null)
  const [editorPostId, setEditorPostId] = useState<string | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [toastError, setToastError] = useState(false)
  const router = useRouter()
  const [liveRegenModal,  setLiveRegenModal]  = useState<{ postId: string } | null>(null)
  const [removeModal,     setRemoveModal]     = useState<{ postId: string; discard: boolean } | null>(null)
  const [regenModal,      setRegenModal]      = useState<{ postId: string } | null>(null)
  const [regenModalNotes, setRegenModalNotes] = useState('')
  const [soundEnabled] = useState(() => typeof window !== 'undefined' && localStorage.getItem('payment-sound-armed') === 'true')
  const { playApprove, playClientDone, playMonthDone } = useMonthlyReviewSounds(soundEnabled)

  // Group posts by client
  const clientIds   = Array.from(new Set(initialPosts.map(p => p.client_id)))
  const postsByClient = new Map<string, MonthlyReviewPost[]>()
  for (const p of initialPosts) {
    const arr = postsByClient.get(p.client_id) ?? []
    arr.push(p)
    postsByClient.set(p.client_id, arr)
  }

  const totalPosts    = initialPosts.length
  const approvedCount = approvedIds.size
  // A session is complete when every post has been approved, rejected, or discarded.
  const actionedCount = approvedIds.size + rejectedIds.size + discardedIds.size
  const isComplete    = totalPosts > 0 && actionedCount >= totalPosts

  // Count clients done
  const clientsDone = clientIds.filter(cid => {
    const ps = postsByClient.get(cid) ?? []
    return ps.length > 0 && ps.every(p => approvedIds.has(p.id) || rejectedIds.has(p.id) || discardedIds.has(p.id))
  }).length

  const handleApprove = useCallback(async (postId: string) => {
    // Optimistic — show approved immediately, push to site in background
    const post = initialPosts.find(p => p.id === postId)
    const nextApproved = new Set(approvedIds)
    nextApproved.add(postId)
    if (post) {
      const clientPosts = postsByClient.get(post.client_id) ?? []
      const allDone    = clientPosts.every(p => nextApproved.has(p.id) || rejectedIds.has(p.id))
      const wasAllDone = clientPosts.every(p => approvedIds.has(p.id)  || rejectedIds.has(p.id))
      if (nextApproved.size + rejectedIds.size >= totalPosts) playMonthDone()
      else if (allDone && !wasAllDone) playClientDone()
      else playApprove()
    } else {
      playApprove()
    }
    setApprovedIds(prev => { const next = new Set(prev); next.add(postId); return next })
    setLoadingId(postId)
    try {
      const res = await fetch(`/api/admin/content/posts/${postId}/approve`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'approve_and_push', source: 'monthly_review' }),
      })
      if (!res.ok) throw new Error(await res.text())
    } catch (e) {
      console.error('Approve failed:', e)
      // Revert optimistic update on failure
      setApprovedIds(prev => { const next = new Set(prev); next.delete(postId); return next })
      alert('Failed to approve post. Please try again.')
    } finally {
      setLoadingId(null)
    }
  }, [initialPosts, postsByClient, approvedIds, rejectedIds, totalPosts, playApprove, playClientDone, playMonthDone])

  const doReject = useCallback(async (postId: string, discard?: boolean, cms: CmsAction = 'leave') => {
    setLoadingId(postId)
    try {
      const url = `/api/admin/content/posts/${postId}/dismiss?cms=${cms}${discard ? '&discard=true' : ''}`
      const res = await fetch(url, { method: 'POST' })
      if (!res.ok) throw new Error(await res.text())
      const body = await res.json().catch(() => ({})) as { cms?: { message?: string } }
      if (discard) {
        setDiscardedIds(prev => { const next = new Set(prev); next.add(postId); return next })
      } else {
        setRejectedIds(prev => { const next = new Set(prev); next.add(postId); return next })
      }
      // Say what happened to the live article, since that is the surprising part.
      if (cms !== 'leave' && body.cms?.message) {
        setToastError(false)
        setToastMsg(body.cms.message)
      }
    } catch (e) {
      console.error('Reject failed:', e)
      setToastError(true)
      setToastMsg('Failed to reject post. Please try again.')
    } finally {
      setLoadingId(null)
    }
  }, [])

  // Delete — permanently removes the post AND its topic, which frees the subject to
  // be generated again. Deliberately different from reject/discard, which keep the
  // row as an editorial signal so the topic is never suggested again. The card asks
  // for confirmation before calling this.
  const handleDelete = useCallback(async (postId: string) => {
    setLoadingId(postId)
    try {
      const res = await fetch(`/api/admin/content/posts/${postId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      // Hide immediately, then resync from the server so counts and the month's
      // grouping reflect the deletion without a manual reload.
      setDeletedIds(prev => { const next = new Set(prev); next.add(postId); return next })
      router.refresh()
    } catch (e) {
      console.error('Delete failed:', e)
      alert('Failed to delete post. Please try again.')
    } finally {
      setLoadingId(null)
    }
  }, [router])
  /**
   * Rejecting a post that is LIVE has to ask first: removing it from the
   * dashboard has never taken it off the client's site, which is how rejected
   * articles ended up still published. Posts that were never pushed skip the
   * dialog entirely — there is nothing to decide.
   */
  const handleReject = useCallback((postId: string, discard?: boolean) => {
    const post = initialPosts.find(p => p.id === postId)
    if (post && (post.wp_post_id || post.bc_post_id)) {
      setRemoveModal({ postId, discard: !!discard })
      return
    }
    void doReject(postId, discard, 'leave')
  }, [initialPosts, doReject])

  const handleRestore = useCallback(async (postId: string) => {
    setLoadingId(postId)
    try {
      const res = await fetch(`/api/admin/content/posts/${postId}/restore`, { method: 'POST' })
      if (!res.ok) throw new Error(await res.text())
      setDiscardedIds(prev => { const next = new Set(prev); next.delete(postId); return next })
    } catch (e) {
      console.error('Restore failed:', e)
      alert('Failed to restore post. Please try again.')
    } finally {
      setLoadingId(null)
    }
  }, [])

  const handleOpenEditor = useCallback((postId: string) => {
    setEditorPostId(postId)
  }, [])

  const handleRegenerateStart = useCallback(() => {
    if (editorPostId) {
      setRegeneratingIds(prev => { const next = new Set(prev); next.add(editorPostId); return next })
    }
  }, [editorPostId])

  const handleRegenerateDone = useCallback((updatedPost?: { title?: string | null }) => {
    if (editorPostId) {
      setRegeneratingIds(prev => { const next = new Set(prev); next.delete(editorPostId); return next })
    }
    setToastError(false)
    setToastMsg(`Post regenerated: ${updatedPost?.title ?? 'Done'} — ready for review`)
    setEditorPostId(null)
  }, [editorPostId])

  const handleRegenerateError = useCallback(() => {
    if (editorPostId) {
      setRegeneratingIds(prev => { const next = new Set(prev); next.delete(editorPostId); return next })
    }
    // Keep the editor open so the user can see the error message
  }, [editorPostId])

  // Direct-from-card full-regenerate — opens confirm modal first
  const handleCardRegenerate = useCallback((postId: string) => {
    const post = initialPosts.find(p => p.id === postId)
    // A live post needs the replace-or-publish-new decision; an unpublished one
    // has nothing to decide, so it keeps the lighter notes-only prompt.
    if (post && (post.wp_post_id || post.bc_post_id)) setLiveRegenModal({ postId })
    else setRegenModal({ postId })
  }, [initialPosts])

  // Editor-initiated actions (monthly review mode)
  const handleEditorApprove = useCallback(() => {
    if (editorPostId) handleApprove(editorPostId)
    // editor calls onClose() itself after this
  }, [editorPostId, handleApprove])

  const handleEditorDiscard = useCallback(() => {
    if (editorPostId) handleReject(editorPostId, true)
    // editor calls onClose() itself after this
  }, [editorPostId, handleReject])

  const handleEditorRegenerate = useCallback(() => {
    if (editorPostId) {
      const postId = editorPostId
      setEditorPostId(null)
      setRegenModal({ postId })
    }
  }, [editorPostId])

  const startRegenerate = useCallback(async (
    postId: string,
    opts: { notes?: string; liveMode?: LiveMode; cms?: CmsAction } = {},
  ) => {
    setRegenModal(null)
    setLiveRegenModal(null)
    setRegenModalNotes('')
    setRegeneratingIds(prev => { const next = new Set(prev); next.add(postId); return next })
    try {
      const res = await fetch(`/api/admin/content/posts/${postId}/full-regenerate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          edit_notes: opts.notes?.trim() || undefined,
          live_mode:  opts.liveMode,
          cms:        opts.cms,
        }),
      })
      if (!res.ok) {
        setRegeneratingIds(prev => { const next = new Set(prev); next.delete(postId); return next })
        setToastError(true)
        const msg = await res.json().catch(() => ({})) as { error?: string }
        setToastMsg(msg.error ?? 'Failed to start regeneration — please try again')
      } else {
        // What happens to the live article is the surprising part of this action,
        // so the toast states it explicitly rather than saying "done".
        const { wasLive, liveMode } = await res.json().catch(() => ({})) as { wasLive?: boolean; liveMode?: LiveMode }
        if (wasLive) {
          setToastError(false)
          setToastMsg(
            liveMode === 'new_keep'
              ? 'Regenerating as a separate post. The current article stays live.'
              : liveMode === 'new_remove'
                ? 'Regenerating as a separate post. The old article has been taken down.'
                : 'Regenerating. The live post keeps serving until you publish the replacement, which then overwrites it.',
          )
        }
      }
      // Session-level polling picks up completion
    } catch {
      setRegeneratingIds(prev => { const next = new Set(prev); next.delete(postId); return next })
      setToastError(true)
      setToastMsg('Failed to start regeneration — please try again')
    }
  }, [])

  const handleRegenModalConfirm = useCallback(async () => {
    if (!regenModal) return
    await startRegenerate(regenModal.postId, { notes: regenModalNotes })
  }, [regenModal, regenModalNotes, startRegenerate])

  // Toast auto-clear
  useEffect(() => {
    if (!toastMsg) return
    const t = setTimeout(() => setToastMsg(null), 5000)
    return () => clearTimeout(t)
  }, [toastMsg])

  // Session-level polling for posts regenerating without an open editor
  useEffect(() => {
    const orphaned = Array.from(regeneratingIds).filter(id => id !== editorPostId)
    if (orphaned.length === 0) return
    const timer = setInterval(async () => {
      for (const postId of orphaned) {
        try {
          const res = await fetch(`/api/admin/content/post?id=${postId}`)
          if (!res.ok) continue
          const updated = await res.json()
          if (updated.status !== 'generating') {
            setRegeneratingIds(prev => { const next = new Set(prev); next.delete(postId); return next })
            setToastError(false)
            setToastMsg(`Post regenerated: ${updated.title ?? 'Done'} — ready for review`)
            router.refresh()
          }
        } catch { /* retry next tick */ }
      }
    }, 10_000)
    return () => clearInterval(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regeneratingIds.size, editorPostId])

  const displayMonth = month || getMonth()
  const editorPost = editorPostId ? initialPosts.find(p => p.id === editorPostId) : null

  return (
    <>
    <div style={embedded ? undefined : { minHeight: '100vh', background: 'var(--bg-base)' }}>
      <MonthlyReviewProgress
        approvedCount={approvedCount}
        totalPosts={totalPosts}
        clientsTotal={clientIds.length}
        clientsDone={clientsDone}
        onExit={() => window.location.href = '/admin/content'}
        month={displayMonth}
        embedded={embedded}
      />

      {isComplete ? (
        <MonthlyReviewComplete
          totalPosts={approvedCount}
          clientsTotal={clientIds.length}
          month={displayMonth}
          onExit={() => { window.location.href = '/admin/content' }}
        />
      ) : (
        <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 20px 60px' }}>
          {/* Month navigation */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 24 }}>
            {prevUrl ? (
              <a href={prevUrl} className="btn btn-secondary btn-sm" style={{ fontSize: '0.8125rem' }}>← Prev Month</a>
            ) : (
              <span style={{ display: 'inline-block', width: 100 }} />
            )}
            <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--text-primary)' }}>{displayMonth}</span>
            {nextUrl ? (
              <a href={nextUrl} className="btn btn-secondary btn-sm" style={{ fontSize: '0.8125rem' }}>Next Month →</a>
            ) : (
              <span style={{ display: 'inline-block', width: 100 }} />
            )}
          </div>

          {totalPosts === 0 ? (
            <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>🎉</div>
              <p style={{ fontSize: 16 }}>No posts need review for {displayMonth}.</p>
              <p style={{ fontSize: 14, marginTop: 8 }}>
                Posts will appear here once topics auto-approve (~35 days ahead).
              </p>
              <a href="/admin/content" className="btn btn-secondary" style={{ display: 'inline-flex', marginTop: 20 }}>
                Back to Content
              </a>
            </div>
          ) : (
            clientIds.map(clientId => {
              const posts = (postsByClient.get(clientId) ?? []).filter(p => !deletedIds.has(p.id))
              if (posts.length === 0) return null
              return (
                <MonthlyReviewClientSection
                  key={clientId}
                  clientId={clientId}
                  clientName={posts[0]?.clientName ?? clientId}
                  posts={posts}
                  approvedIds={approvedIds}
                  rejectedIds={rejectedIds}
                  discardedIds={discardedIds}
                  regeneratingIds={regeneratingIds}
                  loadingId={loadingId}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onOpenEditor={handleOpenEditor}
                  onRestore={handleRestore}
                  onRegenerate={handleCardRegenerate}
                  onDelete={handleDelete}
                />
              )
            })
          )}
        </div>
      )}
    </div>
    {editorPostId && editorPost && (
      <ContentPostEditor
        postId={editorPostId}
        defaultConnectionId={editorPost.connection_id ?? null}
        sites={allSites}
        onClose={() => setEditorPostId(null)}
        onUpdate={() => setEditorPostId(null)}
        onRegenerateStart={handleRegenerateStart}
        onRegenerateDone={handleRegenerateDone}
        onRegenerateError={handleRegenerateError}
        onMonthlyApprove={handleEditorApprove}
        onMonthlyDiscard={handleEditorDiscard}
        onMonthlyRegenerate={handleEditorRegenerate}
        autoScanLinks
      />
    )}
    {toastMsg && (
      <div style={{ position: 'fixed', bottom: 24, right: 24, background: toastError ? '#dc2626' : '#15803d', color: '#fff', padding: '12px 20px', borderRadius: 8, zIndex: 9999, fontSize: '0.875rem', fontWeight: 500, boxShadow: '0 4px 16px rgba(0,0,0,0.18)', display: 'flex', alignItems: 'center', gap: 12 }}>
        {toastError ? '✗' : '✓'} {toastMsg}
        <button onClick={() => { setToastMsg(null); setToastError(false) }} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}>×</button>
      </div>
    )}
    {/* Rejecting a LIVE post — asks what happens to the article on the site. */}
    {removeModal && (() => {
      const p = initialPosts.find(x => x.id === removeModal.postId)
      if (!p) return null
      return (
        <LivePostActionModal
          mode="remove"
          platform={p.wp_post_id && p.bc_post_id ? 'both' : p.bc_post_id ? 'bigcommerce' : 'wordpress'}
          postTitle={p.title}
          busy={loadingId === removeModal.postId}
          onCancel={() => setRemoveModal(null)}
          onConfirm={({ cms }) => {
            const { postId, discard } = removeModal
            setRemoveModal(null)
            void doReject(postId, discard, cms)
          }}
        />
      )
    })()}

    {/* Regenerating a LIVE post — replace in place, or publish separately. */}
    {liveRegenModal && (() => {
      const p = initialPosts.find(x => x.id === liveRegenModal.postId)
      if (!p) return null
      return (
        <LivePostActionModal
          mode="regenerate"
          platform={p.wp_post_id && p.bc_post_id ? 'both' : p.bc_post_id ? 'bigcommerce' : 'wordpress'}
          postTitle={p.title}
          busy={regeneratingIds.has(liveRegenModal.postId)}
          onCancel={() => setLiveRegenModal(null)}
          onConfirm={({ cms, liveMode, notes }) =>
            void startRegenerate(liveRegenModal.postId, { notes, liveMode, cms })}
        />
      )
    })()}

    {regenModal && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        onClick={e => { if (e.target === e.currentTarget) { setRegenModal(null); setRegenModalNotes('') } }}>
        <div className="card" style={{ maxWidth: 420, width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700 }}>Regenerate Post</h3>
            <button onClick={() => { setRegenModal(null); setRegenModalNotes('') }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.125rem', padding: 4 }}>×</button>
          </div>
          <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Picks a new topic and rewrites the post completely — the previous content will be replaced.
            </p>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                Direction (optional)
              </label>
              <textarea
                rows={3}
                value={regenModalNotes}
                onChange={e => setRegenModalNotes(e.target.value)}
                placeholder="e.g. Focus on residential services, avoid commercial content…"
                style={{ width: '100%', fontSize: '0.875rem', padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', resize: 'vertical', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => { setRegenModal(null); setRegenModalNotes('') }}>Cancel</button>
              <button className="btn btn-primary" onClick={handleRegenModalConfirm}>Regenerate →</button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

'use client'

import { useState, useCallback, useEffect } from 'react'
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
  posts:    MonthlyReviewPost[]
  allSites: Site[]
  month:    string
}

function getMonth(): string {
  return new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export default function MonthlyReviewSession({ posts: initialPosts, allSites, month }: Props) {
  const [approvedIds,    setApprovedIds]    = useState<Set<string>>(() => {
    // Pre-populate from admin_approved_at so page survives a refresh
    const pre = new Set<string>()
    for (const p of initialPosts) {
      if (p.admin_approved_at) pre.add(p.id)
    }
    return pre
  })
  const [rejectedIds,    setRejectedIds]    = useState<Set<string>>(new Set())
  const [loadingId,      setLoadingId]      = useState<string | null>(null)
  const [editorPostId, setEditorPostId] = useState<string | null>(null)
  const [soundEnabled,   setSoundEnabled]   = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('payment-sound-armed') === 'true'
  })

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
  // A session is complete when every post has been approved OR rejected — not only approved.
  // Without this, rejecting even one post locks the completion screen behind an impossible condition.
  const actionedCount = approvedIds.size + rejectedIds.size
  const isComplete    = totalPosts > 0 && actionedCount >= totalPosts

  // Count clients done
  const clientsDone = clientIds.filter(cid => {
    const ps = postsByClient.get(cid) ?? []
    return ps.length > 0 && ps.every(p => approvedIds.has(p.id) || rejectedIds.has(p.id))
  }).length

  const handleApprove = useCallback(async (postId: string) => {
    setLoadingId(postId)
    try {
      const res = await fetch(`/api/admin/content/posts/${postId}/approve`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'approve_and_push', source: 'monthly_review' }),
      })
      if (!res.ok) throw new Error(await res.text())

      // Compute sound cue using current render values — must run outside the state setter
      // to avoid double-invocation in React Strict Mode and stale-closure issues.
      const post = initialPosts.find(p => p.id === postId)
      if (post) {
        const clientPosts  = postsByClient.get(post.client_id) ?? []
        const nextApproved = new Set(approvedIds)
        nextApproved.add(postId)
        const allDone    = clientPosts.every(p => nextApproved.has(p.id) || rejectedIds.has(p.id))
        const wasAllDone = clientPosts.every(p => approvedIds.has(p.id)  || rejectedIds.has(p.id))

        if (nextApproved.size + rejectedIds.size >= totalPosts) {
          playMonthDone()
        } else if (allDone && !wasAllDone) {
          playClientDone()
        } else {
          playApprove()
        }
      } else {
        playApprove()
      }

      setApprovedIds(prev => { const next = new Set(prev); next.add(postId); return next })
    } catch (e) {
      console.error('Approve failed:', e)
      alert('Failed to approve post. Please try again.')
    } finally {
      setLoadingId(null)
    }
  }, [initialPosts, postsByClient, approvedIds, rejectedIds, totalPosts, playApprove, playClientDone, playMonthDone])

  const handleReject = useCallback(async (postId: string) => {
    setLoadingId(postId)
    try {
      const res = await fetch(`/api/admin/content/posts/${postId}/dismiss`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error(await res.text())
      setRejectedIds(prev => { const next = new Set(prev); next.add(postId); return next })
    } catch (e) {
      console.error('Reject failed:', e)
      alert('Failed to reject post. Please try again.')
    } finally {
      setLoadingId(null)
    }
  }, [])

  const handleOpenEditor = useCallback((postId: string) => {
    setEditorPostId(postId)
  }, [])

  const handleToggleSound = useCallback(() => {
    setSoundEnabled(prev => {
      const next = !prev
      if (typeof window !== 'undefined') {
        localStorage.setItem('payment-sound-armed', next ? 'true' : 'false')
      }
      return next
    })
  }, [])

  if (editorPostId) {
    const editorPost = initialPosts.find(p => p.id === editorPostId)
    return (
      <ContentPostEditor
        postId={editorPostId}
        defaultConnectionId={editorPost?.connection_id ?? null}
        sites={allSites}
        onClose={() => setEditorPostId(null)}
        onUpdate={() => setEditorPostId(null)}
      />
    )
  }

  const displayMonth = month || getMonth()

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <MonthlyReviewProgress
        approvedCount={approvedCount}
        totalPosts={totalPosts}
        clientsTotal={clientIds.length}
        clientsDone={clientsDone}
        soundEnabled={soundEnabled}
        onToggleSound={handleToggleSound}
        onExit={() => window.location.href = '/admin/content'}
        month={displayMonth}
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
          {totalPosts === 0 ? (
            <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>🎉</div>
              <p style={{ fontSize: 16 }}>No posts need review right now.</p>
              <p style={{ fontSize: 14, marginTop: 8 }}>
                Posts will appear here once topics auto-approve (~35 days ahead).
              </p>
              <a href="/admin/content" className="btn btn-secondary" style={{ display: 'inline-flex', marginTop: 20 }}>
                Back to Content
              </a>
            </div>
          ) : (
            clientIds.map(clientId => {
              const posts = postsByClient.get(clientId) ?? []
              return (
                <MonthlyReviewClientSection
                  key={clientId}
                  clientName={posts[0]?.clientName ?? clientId}
                  posts={posts}
                  approvedIds={approvedIds}
                  rejectedIds={rejectedIds}
                  loadingId={loadingId}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onOpenEditor={handleOpenEditor}
                />
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

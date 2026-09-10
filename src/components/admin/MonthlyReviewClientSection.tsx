'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowSquareOut } from '@phosphor-icons/react'
import MonthlyReviewPostCard, { type MonthlyReviewPost } from './MonthlyReviewPostCard'

interface Props {
  clientId:        string
  clientName:      string
  posts:           MonthlyReviewPost[]
  approvedIds:     Set<string>
  rejectedIds:     Set<string>
  discardedIds:    Set<string>
  regeneratingIds: Set<string>
  loadingId:       string | null
  onApprove:       (id: string) => void
  onReject:        (id: string, discard?: boolean) => void
  onOpenEditor:    (id: string) => void
  onRestore:       (id: string) => void
  onRegenerate:    (id: string) => void
  /** Permanently delete the post and its topic, freeing the subject for regeneration. */
  onDelete?:       (id: string) => void
  /** Push progress per post id — see MonthlyReviewSession. Passed straight through. */
  pushStates?:     Record<string, { state: 'pushing' | 'live' | 'failed'; url?: string | null; error?: string }>
  onRetryPush?:    (id: string) => void
}

type ScanState = 'idle' | 'scanning' | { ok: number; total: number; broken: number; perPost: Record<string, number> }

/**
 * One queue for the whole page, not one per section.
 *
 * The link scan runs automatically now, and every client section renders expanded, so a page
 * with two dozen clients fired a request per post across every section at once — around
 * ninety simultaneous requests spread over two dozen different client web servers, none of
 * which agreed to that. Capping per section would not have helped: twenty sections each
 * politely limiting themselves is still twenty times the traffic.
 *
 * Four at a time is enough to finish a page quickly and low enough that no single client site
 * sees a burst.
 */
const SCAN_CONCURRENCY = 4
let scanActive = 0
const scanQueue: (() => void)[] = []

function acquireScanSlot(): Promise<void> {
  if (scanActive < SCAN_CONCURRENCY) { scanActive++; return Promise.resolve() }
  return new Promise<void>(resolve => scanQueue.push(() => { scanActive++; resolve() }))
}

function releaseScanSlot(): void {
  scanActive--
  const next = scanQueue.shift()
  if (next) next()
}

export default function MonthlyReviewClientSection({
  clientId, clientName, posts, approvedIds, rejectedIds, discardedIds, regeneratingIds, loadingId, onApprove, onReject, onOpenEditor, onRestore, onRegenerate, onDelete,
  pushStates, onRetryPush,
}: Props) {
  const approvedCount = posts.filter(p => approvedIds.has(p.id)).length
  const isComplete    = posts.length > 0 && posts.every(p => approvedIds.has(p.id) || rejectedIds.has(p.id) || discardedIds.has(p.id))

  // null = auto-driven by isComplete; true/false = user explicitly set
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(null)

  // Auto-collapse on completion but let users override by clicking the header
  const effectivelyCollapsed = userCollapsed !== null ? userCollapsed : (isComplete && approvedCount > 0)

  const [scanState, setScanState] = useState<ScanState>('idle')
  const autoScannedRef = useRef(false)

  // Scans once per section, when it is open and has posts. A ref rather than scanState so a
  // scan that returns 'idle' on failure cannot retry in a loop against the client's site.
  useEffect(() => {
    if (autoScannedRef.current || effectivelyCollapsed || posts.length === 0) return
    autoScannedRef.current = true
    void runScan()
  }, [effectivelyCollapsed, posts.length])

  async function handleScanLinks(e: React.MouseEvent) {
    e.stopPropagation()
    await runScan()
  }

  async function runScan() {
    setScanState('scanning')
    try {
      const results = await Promise.allSettled(
        posts.map(async p => {
          await acquireScanSlot()
          try {
            const r = await fetch(`/api/admin/content/posts/${p.id}/scan-links`, { method: 'POST' })
            if (!r.ok) throw new Error(`scan failed (${r.status})`)
            return await r.json() as { links: { ok: boolean }[] }
          } finally {
            releaseScanSlot()
          }
        })
      )
      let ok = 0, total = 0, broken = 0
      let scanned = 0
      const perPost: Record<string, number> = {}
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          scanned++
          const links = r.value.links ?? []
          const postBroken = links.filter((l: { ok: boolean }) => !l.ok).length
          total  += links.length
          ok     += links.filter((l: { ok: boolean }) => l.ok).length
          broken += postBroken
          if (postBroken > 0) perPost[posts[i].id] = postBroken
        }
      })
      // Nothing came back. Report nothing rather than "OK".
      if (scanned === 0) { setScanState('idle'); return }
      setScanState({ ok, total, broken, perPost })
    } catch {
      setScanState('idle')
    }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Client header (accordion toggle) */}
      <button
        onClick={() => setUserCollapsed(!effectivelyCollapsed)}
        style={{
          width:        '100%',
          display:      'flex',
          alignItems:   'center',
          gap:          8,
          padding:      '10px 14px',
          background:   isComplete ? '#f0fdf4' : 'var(--bg-subtle)',
          border:       `1px solid ${isComplete ? '#bbf7d0' : 'var(--border)'}`,
          borderRadius: 8,
          cursor:       'pointer',
          textAlign:    'left',
          marginBottom: effectivelyCollapsed ? 0 : 8,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, fontSize: 13, fontWeight: 600, color: isComplete ? '#15803d' : 'var(--text-primary)' }}>
          {isComplete ? '✓ ' : ''}{clientName}
          <span
            role="link"
            tabIndex={0}
            title={`Open ${clientName} content settings`}
            aria-label={`Open ${clientName} content settings`}
            onClick={e => { e.stopPropagation(); window.open(`/admin/clients/${clientId}?tab=content&subtab=settings`, '_blank', 'noopener') }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); window.open(`/admin/clients/${clientId}?tab=content&subtab=settings`, '_blank', 'noopener') } }}
            style={{ display: 'inline-flex', color: 'var(--text-faint)', cursor: 'pointer' }}
          >
            <ArrowSquareOut size={13} weight="bold" aria-hidden />
          </span>
        </span>
        {/* No idle "Scan links" affordance.
            Opening a post for review scans its links automatically, and review is the only
            way to approve one — so this offered work the reviewer cannot avoid doing anyway,
            from a chip sitting beside the approval counter as though it were part of the
            progress readout. The section scans itself once when it opens instead, so the
            result is still reported without a control nobody needed to press. */}
        {scanState === 'scanning' && (
          <span style={{ fontSize: 11, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>⟳ Scanning…</span>
        )}
        {scanState !== 'idle' && scanState !== 'scanning' && (
          <span
            onClick={handleScanLinks}
            style={{ fontSize: 11, color: scanState.broken > 0 ? 'var(--red)' : 'var(--green)', background: 'var(--bg)', border: `1px solid ${scanState.broken > 0 ? 'var(--red)' : 'var(--green)'}`, borderRadius: 4, padding: '1px 6px', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            🔗 {scanState.broken > 0 ? `${scanState.broken} broken` : 'Links OK'}
          </span>
        )}
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {approvedCount}/{posts.length} approved
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 4 }}>
          {effectivelyCollapsed ? '▶' : '▼'}
        </span>
      </button>

      {/* Posts list */}
      {!effectivelyCollapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {posts.map(post => (
            <MonthlyReviewPostCard
              key={post.id}
              post={post}
              isApproved={approvedIds.has(post.id)}
              isRejected={rejectedIds.has(post.id)}
              isDiscarded={discardedIds.has(post.id)}
              isRegenerating={regeneratingIds.has(post.id)}
              isLoading={loadingId === post.id}
              isCollapsed={false}
              brokenLinkCount={typeof scanState === 'object' ? (scanState.perPost[post.id] ?? 0) : undefined}
              onApprove={onApprove}
              onReject={onReject}
              onOpenEditor={onOpenEditor}
              onRestore={onRestore}
              onRegenerate={onRegenerate}
              onDelete={onDelete}
              pushState={pushStates?.[post.id]?.state}
              pushedUrl={pushStates?.[post.id]?.url ?? null}
              pushError={pushStates?.[post.id]?.error ?? null}
              onRetryPush={onRetryPush}
            />
          ))}
        </div>
      )}
    </div>
  )
}

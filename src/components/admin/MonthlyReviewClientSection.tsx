'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { CaretDown, GearSix } from '@phosphor-icons/react'
import StatusBadge from '@/components/ui/StatusBadge'
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
    // runScan is deliberately not a dependency. It is redeclared every render, so listing it would
    // re-run this effect on every render — the ref above would still stop a second scan, which is
    // the point: one scan per section, never a retry loop against the client's site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivelyCollapsed, posts.length])

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

  const listId = useId()
  return (
    <section className="mr-client" aria-label={clientName}>
      {/* The toggle and the settings link are siblings: a link inside the toggle button was a
          control inside a control, which a keyboard or screen reader can't reach properly. */}
      <div className="mr-client-head">
        <button
          type="button"
          className="mr-client-toggle"
          aria-expanded={!effectivelyCollapsed}
          aria-controls={listId}
          onClick={() => setUserCollapsed(!effectivelyCollapsed)}
        >
          <CaretDown size={14} weight="bold" aria-hidden />
          <span className="mr-client-name">{clientName}</span>
          {isComplete && <StatusBadge tone="success">Done</StatusBadge>}
          {/* No link-health chip on the client header.
              A per-CLIENT roll-up answers a question nobody asks — "are these four posts'
              links collectively fine" — while sitting beside the approval counter as though it
              were part of the progress readout, and a green "Links OK" there is the least
              useful place to say it. The scan still runs, because its per-post counts feed the
              broken-link badge on the individual cards, and the review drawer does its own
              scan with the detail. That is where a link problem is actionable. */}
          <span className="mr-client-count">{approvedCount} of {posts.length} approved</span>
        </button>
        <Link
          href={`/admin/clients/${clientId}?tab=content&subtab=settings`}
          target="_blank"
          className="mr-client-link"
          title={`${clientName}’s content settings (opens in a new tab)`}
          aria-label={`${clientName}’s content settings, opens in a new tab`}
        >
          <GearSix size={16} aria-hidden />
        </Link>
      </div>

      {/* Posts list */}
      {!effectivelyCollapsed && (
        <div className="mr-posts" id={listId}>
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
    </section>
  )
}

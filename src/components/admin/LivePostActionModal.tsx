'use client'

import { useState } from 'react'
import type { CmsAction } from '@/lib/content/cmsLifecycle'

export type LiveMode = 'replace' | 'new_keep' | 'new_remove'

/**
 * Asked whenever an action in the dashboard would leave the client's live site
 * out of step with it.
 *
 * Only ever shown when the post actually has a platform id — there is nothing to
 * decide for a post that was never pushed, and an extra click on the common path
 * is exactly how people learn to dismiss dialogs without reading them.
 */
export default function LivePostActionModal({
  mode,
  platform,
  postTitle,
  busy,
  onCancel,
  onConfirm,
}: {
  /** 'remove' = rejecting/discarding. 'regenerate' = rewriting. */
  mode:      'remove' | 'regenerate'
  platform:  'wordpress' | 'bigcommerce'
  postTitle: string | null
  busy?:     boolean
  onCancel:  () => void
  onConfirm: (choice: { cms: CmsAction; liveMode?: LiveMode; notes?: string }) => void
}) {
  const [cms, setCms]           = useState<CmsAction>('leave')
  const [liveMode, setLiveMode] = useState<LiveMode>('replace')
  const [notes, setNotes]       = useState('')

  const isWp = platform === 'wordpress'
  const platformName = isWp ? 'WordPress' : 'BigCommerce'

  // WordPress trashes (recoverable). BigCommerce has no trash at all.
  const deleteCopy = isWp
    ? 'Move it to the WordPress trash. Recoverable from wp-admin.'
    : 'Delete it from BigCommerce. Permanent — BigCommerce has no trash.'

  const optionStyle = (on: boolean): React.CSSProperties => ({
    display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
    padding: '9px 11px', borderRadius: 7, marginBottom: 6,
    background: on ? 'var(--blue-subtle, rgba(37,99,235,0.08))' : 'var(--bg-subtle)',
    border: `1px solid ${on ? 'var(--blue)' : 'var(--border)'}`,
    fontFamily: 'inherit',
  })
  const titleStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }
  const descStyle: React.CSSProperties  = { fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.45 }

  const destructive = mode === 'remove'
    ? cms === 'delete'
    : liveMode === 'new_remove' && cms === 'delete'

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget && !busy) onCancel() }}
    >
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10,
        width: '100%', maxWidth: 520, maxHeight: '86vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
            {mode === 'remove' ? 'This article is live' : 'This post is already published'}
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            &ldquo;{postTitle ?? 'Untitled'}&rdquo; is on {platformName} right now.
            {mode === 'remove'
              ? ' Removing it here does not take it off the site unless you say so.'
              : ' Choose what the rewrite should do with it.'}
          </p>
        </div>

        <div style={{ padding: '14px 16px' }}>
          {mode === 'regenerate' && (
            <>
              <button style={optionStyle(liveMode === 'replace')} onClick={() => setLiveMode('replace')}>
                <div style={titleStyle}>Replace the live article</div>
                <div style={descStyle}>
                  The rewrite overwrites the existing {platformName} post when you publish it. Same URL, so
                  existing links and any rankings it has built stay with it. This is almost always what you want.
                </div>
              </button>

              <button style={optionStyle(liveMode === 'new_keep')} onClick={() => setLiveMode('new_keep')}>
                <div style={titleStyle}>Publish as a new post, leave this one up</div>
                <div style={descStyle}>
                  The rewrite becomes a separate article. The current one stays live and untouched.
                  Two pages on a similar topic can compete with each other in search, so use this
                  when the new post is genuinely about something different.
                </div>
              </button>

              <button style={optionStyle(liveMode === 'new_remove')} onClick={() => setLiveMode('new_remove')}>
                <div style={titleStyle}>Publish as a new post, and take this one down</div>
                <div style={descStyle}>
                  The rewrite becomes a separate article and the current one is removed from the site.
                </div>
              </button>
            </>
          )}

          {(mode === 'remove' || liveMode === 'new_remove') && (
            <div style={{ marginTop: mode === 'regenerate' ? 12 : 0 }}>
              {mode === 'regenerate' && (
                <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-faint)' }}>
                  How to take it down
                </p>
              )}

              {mode === 'remove' && (
                <button style={optionStyle(cms === 'leave')} onClick={() => setCms('leave')}>
                  <div style={titleStyle}>Leave it published</div>
                  <div style={descStyle}>
                    Removes it from the dashboard only. The article stays live on the client&rsquo;s site.
                  </div>
                </button>
              )}

              <button style={optionStyle(cms === 'unpublish')} onClick={() => setCms('unpublish')}>
                <div style={titleStyle}>{isWp ? 'Revert to draft' : 'Hide from the storefront'}</div>
                <div style={descStyle}>
                  {isWp
                    ? 'The post stays in WordPress but is no longer visible to visitors. Reversible.'
                    : 'The post stays in BigCommerce but is unpublished. Reversible.'}
                </div>
              </button>

              <button style={optionStyle(cms === 'delete')} onClick={() => setCms('delete')}>
                <div style={titleStyle}>Delete from {platformName}</div>
                <div style={descStyle}>{deleteCopy}</div>
              </button>
            </div>
          )}

          {mode === 'regenerate' && (
            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-faint)', marginBottom: 4 }}>
                Direction for the rewrite (optional)
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                placeholder="What was wrong with this one? e.g. too generic, wrong angle, missed the local search intent"
                style={{
                  width: '100%', boxSizing: 'border-box', resize: 'vertical',
                  background: 'var(--bg-subtle)', border: '1px solid var(--border)',
                  borderRadius: 6, padding: '7px 9px', fontSize: 12.5,
                  color: 'var(--text)', fontFamily: 'inherit', lineHeight: 1.5,
                }}
              />
            </div>
          )}

          {destructive && (
            <div style={{
              marginTop: 12, padding: '8px 10px', borderRadius: 6,
              background: '#fee2e2', border: '1px solid #fca5a5',
              fontSize: 11.5, color: '#b91c1c', lineHeight: 1.5,
            }}>
              {isWp
                ? 'This removes the article from the live site. It goes to the WordPress trash, so it can be restored from wp-admin if this was a mistake.'
                : 'This permanently deletes the article from BigCommerce. There is no trash and no undo.'}
            </div>
          )}
        </div>

        <div style={{ padding: '11px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onCancel}
            disabled={busy}
            className="btn btn-secondary btn-sm"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm({
              cms: mode === 'remove' ? cms : (liveMode === 'new_remove' ? cms : 'leave'),
              ...(mode === 'regenerate' ? { liveMode, notes: notes.trim() || undefined } : {}),
            })}
            disabled={busy}
            className="btn btn-sm"
            style={{
              background: destructive ? 'var(--red, #dc2626)' : 'var(--blue)',
              color: '#fff', border: 'none', fontWeight: 600,
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy
              ? 'Working...'
              : mode === 'remove'
                ? (cms === 'leave' ? 'Remove from dashboard' : cms === 'unpublish' ? 'Unpublish and remove' : 'Delete and remove')
                : 'Start regenerating'}
          </button>
        </div>
      </div>
    </div>
  )
}

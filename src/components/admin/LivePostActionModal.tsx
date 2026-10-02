'use client'

import { useRef, useState } from 'react'
import type { CmsAction } from '@/lib/content/cmsLifecycle'
import Dialog from '@/components/ui/Dialog'
import Field from '@/components/ui/Field'

export type LiveMode = 'replace' | 'new_keep' | 'new_remove'

/**
 * Asked whenever an action in the dashboard would leave the client's live site
 * out of step with it.
 *
 * Only ever shown when the post actually has a platform id — there is nothing to
 * decide for a post that was never pushed, and an extra click on the common path
 * is exactly how people learn to dismiss dialogs without reading them.
 *
 * It is the only human gate on taking down or replacing an article that is LIVE on a client's
 * site, so it gets full dialog semantics (the shared Dialog: focus kept inside, Escape, the
 * phone sheet) and every option says whether it's the selected one.
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
  /**
   * 'both' is real: a row can carry wp_post_id AND bc_post_id, and the action
   * is applied to every copy. Naming only one of them would tell the human the
   * wrong thing about what is about to happen — and specifically would hide the
   * irreversible half.
   */
  platform:  'wordpress' | 'bigcommerce' | 'both'
  postTitle: string | null
  busy?:     boolean
  onCancel:  () => void
  onConfirm: (choice: {
    cms: CmsAction; liveMode?: LiveMode; notes?: string
    /** 'rewrite' keeps the subject; 'new_topic' picks a different one. */
    scope?: 'rewrite' | 'new_topic'
    /** Steers topic SELECTION. Only meaningful for 'new_topic'. */
    steerKeyword?: string
  }) => void
}) {
  const [cms, setCms]           = useState<CmsAction>('leave')
  const [liveMode, setLiveMode] = useState<LiveMode>('replace')
  const [notes, setNotes]       = useState('')
  // Defaults to 'rewrite' -- the thing every label in this modal already promises. It used to
  // send no scope at all, which meant full-regenerate: the live URL was overwritten by an
  // article on a DIFFERENT subject, and the original topic and its silo keyword were retired
  // before the reviewer saw anything. This is the highest-stakes regenerate path, so it now
  // asks the same question RegenerateDialog does.
  const [scope, setScope]       = useState<'rewrite' | 'new_topic'>('rewrite')
  const [steerKeyword, setSteerKeyword] = useState('')

  const isWp   = platform === 'wordpress'
  const isBoth = platform === 'both'
  const platformName = isBoth ? 'WordPress and BigCommerce' : isWp ? 'WordPress' : 'BigCommerce'

  // WordPress trashes (recoverable). BigCommerce has no trash at all. When the
  // post is on both, lead with the irreversible half.
  const deleteCopy = isBoth
    ? 'Trashes the WordPress copy (recoverable from wp-admin) and deletes the BigCommerce copy. The BigCommerce half is permanent.'
    : isWp
      ? 'Move it to the WordPress trash. Recoverable from wp-admin.'
      : 'Delete it from BigCommerce. Permanent: BigCommerce has no trash.'

  const destructive = mode === 'remove'
    ? cms === 'delete'
    : liveMode === 'new_remove' && cms === 'delete'

  const firstRef = useRef<HTMLButtonElement>(null)

  const option = (on: boolean, onClick: () => void, title: React.ReactNode, text: React.ReactNode, first = false) => (
    <button ref={first ? firstRef : undefined} type="button" className="ui-choice" aria-pressed={on} onClick={onClick}>
      <span className="ui-choice-title">{title}</span>
      <span className="ui-choice-text">{text}</span>
    </button>
  )

  return (
    <Dialog
      open
      onClose={onCancel}
      title={mode === 'remove' ? 'This article is live' : 'This post is already published'}
      description={<>
        “{postTitle ?? 'Untitled'}” is on {platformName} right now.
        {mode === 'remove' ? ' Removing it here doesn’t take it off the site unless you say so.' : ' Choose what the rewrite should do with it.'}
      </>}
      role={destructive ? 'alertdialog' : 'dialog'}
      busy={busy}
      initialFocus={firstRef}
      bodyClassName="ui-stack-sm"
      footer={<>
        <button type="button" onClick={onCancel} disabled={busy} className="btn btn-secondary">Cancel</button>
        <button
          type="button"
          onClick={() => onConfirm({
            cms: mode === 'remove' ? cms : (liveMode === 'new_remove' ? cms : 'leave'),
            ...(mode === 'regenerate'
              ? {
                  liveMode,
                  notes: notes.trim() || undefined,
                  scope,
                  steerKeyword: scope === 'new_topic' ? steerKeyword.trim() || undefined : undefined,
                }
              : {}),
          })}
          disabled={busy}
          className={`btn ${destructive ? 'btn-danger-solid' : 'btn-primary'}`}
        >
          {busy
            ? 'Working…'
            : mode === 'remove'
              ? (cms === 'leave' ? 'Remove from the dashboard' : cms === 'unpublish' ? 'Unpublish and remove' : 'Delete and remove')
              : 'Start regenerating'}
        </button>
      </>}
    >
      {mode === 'regenerate' && (
        <div>
          <p className="ui-label">What should change</p>
          <div className="ui-choices ui-choices--list">
            {option(scope === 'rewrite', () => { setScope('rewrite'); setLiveMode('replace') }, 'Rewrite this article',
              'Keeps the same subject and target keyword, and writes it again. The URL and the topic it ranks for stay as they are.', true)}
            {option(scope === 'new_topic', () => setScope('new_topic'), 'Pick a new topic',
              'Retires this subject and its keyword, then writes about something else. With “Replace the live article”, the published URL ends up covering a different subject.')}
          </div>
        </div>
      )}

      {/* Only a NEW topic raises the replace-or-publish-separately question. A rewrite keeps the
          same post, so it necessarily replaces the live article on publish. */}
      {mode === 'regenerate' && scope === 'new_topic' && (
        <div>
          <p className="ui-label">Where the new article goes</p>
          <div className="ui-choices ui-choices--list">
            {option(liveMode === 'replace', () => setLiveMode('replace'), 'Replace the live article',
              `The rewrite overwrites the existing ${platformName} post when you publish it. Same URL, so existing links and any rankings it has built stay with it. This is almost always what you want.`)}
            {option(liveMode === 'new_keep', () => setLiveMode('new_keep'), 'Publish as a new post, leave this one up',
              'The rewrite becomes a separate article. The current one stays live and untouched. Two pages on a similar topic can compete in search, so use this when the new post is about something different.')}
            {option(liveMode === 'new_remove', () => setLiveMode('new_remove'), 'Publish as a new post, and take this one down',
              'The rewrite becomes a separate article and the current one is removed from the site.')}
          </div>
        </div>
      )}

      {(mode === 'remove' || liveMode === 'new_remove') && (
        <div>
          {mode === 'regenerate' && <p className="ui-label">How to take it down</p>}
          <div className="ui-choices ui-choices--list">
            {mode === 'remove' && option(cms === 'leave', () => setCms('leave'), 'Leave it published',
              'Removes it from the dashboard only. The article stays live on the client’s site.', true)}
            {option(cms === 'unpublish', () => setCms('unpublish'),
              isBoth ? 'Take it out of view' : isWp ? 'Revert to draft' : 'Hide from the storefront',
              isBoth
                ? 'Reverts the WordPress copy to a draft and unpublishes the BigCommerce copy. Both reversible.'
                : isWp
                  ? 'The post stays in WordPress but visitors can’t see it. Reversible.'
                  : 'The post stays in BigCommerce but is unpublished. Reversible.')}
            {option(cms === 'delete', () => setCms('delete'), `Delete from ${platformName}`, deleteCopy)}
          </div>
        </div>
      )}

      {mode === 'regenerate' && scope === 'new_topic' && (
        <Field label="Steer the new topic (optional)" id="live-steer-kw" hint="A short phrase. This reaches topic selection, unlike the direction below.">
          <input
            id="live-steer-kw"
            className="input"
            value={steerKeyword}
            onChange={e => setSteerKeyword(e.target.value)}
            placeholder="e.g. commercial roofing, emergency repair"
            aria-describedby="live-steer-kw-hint"
          />
        </Field>
      )}

      {mode === 'regenerate' && (
        <Field label="Direction for the rewrite (optional)" id="live-notes">
          <textarea
            id="live-notes"
            className="input"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="What was wrong with this one? e.g. too generic, wrong angle, missed the local search intent"
            style={{ resize: 'vertical' }}
          />
        </Field>
      )}

      {destructive && (
        <div className="ui-notice ui-notice--danger" role="alert" style={{ margin: 0 }}>
          {isBoth
            ? 'This removes the article from both live sites. The WordPress copy goes to the trash and can be restored from wp-admin; the BigCommerce copy is deleted permanently, with no trash and no undo.'
            : isWp
              ? 'This removes the article from the live site. It goes to the WordPress trash, so it can be restored from wp-admin if this was a mistake.'
              : 'This permanently deletes the article from BigCommerce. There is no trash and no undo.'}
        </div>
      )}
    </Dialog>
  )
}

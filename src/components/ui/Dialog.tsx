'use client'

// The admin's one dialog. Centred by default, or a side sheet (variant="side") for details that
// want height; both become a bottom sheet on a phone. It portals to <body> so no table or card can
// clip it, and while open it:
//   - traps Tab inside itself and focuses the first field, else the main action (or `initialFocus`),
//   - closes on Escape and on a click outside (not while `busy`),
//   - stops the page behind from scrolling (counted, so a dialog over a dialog unlocks correctly),
//   - gives focus back to whatever had it when it opened.
// ConfirmDialog is the common case: a question, what will happen, and one action.

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

let locks = 0
function lockScroll() {
  if (locks++ === 0) {
    const gap = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    if (gap > 0) document.body.style.paddingRight = `${gap}px`
  }
}
function unlockScroll() {
  if (--locks === 0) { document.body.style.overflow = ''; document.body.style.paddingRight = '' }
}

export default function Dialog({
  open, onClose, title, description, children, footer, size = 'md', variant = 'center', busy = false,
  initialFocus, role = 'dialog', leading, bodyClassName,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  /** One line under the title. */
  description?: ReactNode
  children?: ReactNode
  /** Actions, right-aligned under the body (they stack full-width on a phone). */
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  variant?: 'center' | 'side'
  /** While true the dialog can't be dismissed (a save is running). */
  busy?: boolean
  /** What to focus on open; otherwise the first field, otherwise the first button. */
  initialFocus?: RefObject<HTMLElement | null>
  /** alertdialog for a question that needs an answer (a destructive confirm). */
  role?: 'dialog' | 'alertdialog'
  /** A logo or icon tile before the title. */
  leading?: ReactNode
  bodyClassName?: string
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Latest values for the listeners, so the effect below runs once per opening.
  const closeRef = useRef(onClose); closeRef.current = onClose
  const busyRef = useRef(busy); busyRef.current = busy

  useEffect(() => {
    if (!open) return
    const returnTo = document.activeElement as HTMLElement | null
    lockScroll()
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel) return
      // A field first; otherwise the footer's main action (its last button); otherwise anything.
      const footer = Array.from(panel.querySelectorAll<HTMLElement>(`.ui-dialog-foot :is(${FOCUSABLE})`))
      const target = initialFocus?.current
        ?? panel.querySelector<HTMLElement>('.ui-dialog-body :is(input, select, textarea):not([disabled])')
        ?? footer[footer.length - 1]
        ?? panel.querySelector<HTMLElement>(FOCUSABLE)
        ?? panel
      target.focus()
    })
    function onKey(e: KeyboardEvent) {
      const panel = panelRef.current
      if (!panel) return
      if (e.key === 'Escape') {
        // A dialog stacked on top handles its own Escape.
        if (!panel.contains(document.activeElement) && document.activeElement !== document.body) return
        e.stopPropagation()
        if (!busyRef.current) closeRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null || el === document.activeElement)
      if (items.length === 0) { e.preventDefault(); panel.focus(); return }
      const first = items[0], last = items[items.length - 1]
      if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKey)
      unlockScroll()
      // Back to where the person was, if it is still on the page.
      if (returnTo && document.contains(returnTo)) returnTo.focus()
    }
  }, [open, initialFocus])

  if (!open || !mounted) return null

  return createPortal(
    <div
      className={`ui-dialog-scrim${variant === 'side' ? ' ui-dialog-scrim--side' : ''}`}
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div
        ref={panelRef}
        className={`ui-dialog ui-dialog--${size}${variant === 'side' ? ' ui-dialog--side' : ''}`}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        aria-busy={busy || undefined}
        tabIndex={-1}
      >
        <header className="ui-dialog-head">
          {leading}
          <div className="ui-dialog-heading">
            <h2 className="ui-dialog-title" id={titleId}>{title}</h2>
            {description && <p className="ui-dialog-desc" id={descId}>{description}</p>}
          </div>
          <button type="button" className="ui-dialog-x" onClick={onClose} disabled={busy} aria-label="Close">
            <X size={16} weight="bold" aria-hidden />
          </button>
        </header>
        {children != null && <div className={`ui-dialog-body${bodyClassName ? ` ${bodyClassName}` : ''}`}>{children}</div>}
        {footer && <footer className="ui-dialog-foot">{footer}</footer>}
      </div>
    </div>,
    document.querySelector('.adm') ?? document.body,
  )
}

/** A yes/no question. `onConfirm` may be async; a thrown error shows in the dialog and keeps it open. */
export function ConfirmDialog({
  open, onClose, title, children, confirmLabel, busyLabel, tone = 'primary', onConfirm, cancelLabel = 'Cancel',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  /** What will happen, in a sentence or two. Say the consequence, not "are you sure". */
  children: ReactNode
  confirmLabel: string
  /** Shown on the button while it runs ("Deleting…"). */
  busyLabel?: string
  tone?: 'primary' | 'danger'
  onConfirm: () => Promise<void> | void
  cancelLabel?: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (open) { setError(''); setBusy(false) } }, [open])

  async function run() {
    setBusy(true)
    setError('')
    try {
      await onConfirm()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      role="alertdialog"
      busy={busy}
      // A destructive question starts on the safe answer.
      initialFocus={tone === 'danger' ? cancelRef : undefined}
      footer={<>
        <button ref={cancelRef} type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>{cancelLabel}</button>
        <button type="button" className={`btn ${tone === 'danger' ? 'btn-danger-solid' : 'btn-primary'}`} onClick={run} disabled={busy}>
          {busy ? (busyLabel ?? `${confirmLabel}…`) : confirmLabel}
        </button>
      </>}
    >
      <div className="ui-dialog-text">{children}</div>
      {error && <div className="ui-notice ui-notice--danger" role="alert" style={{ margin: '14px 0 0' }}>{error}</div>}
    </Dialog>
  )
}

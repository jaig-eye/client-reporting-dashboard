'use client'

// The dialog for connecting or managing an integration: its fields, an optional "how to find these"
// guide, and Connect / Save changes / Disconnect. After a save the page refreshes in place, so
// every status that depends on it — the badge here, a client's Integrations tab, panels that only
// show once something is connected — updates without a reload.

import { useState, useEffect, useRef, useId } from 'react'
import { useRouter } from 'next/navigation'
import { X, CaretRight, CheckCircle } from '@phosphor-icons/react'
import BrandLogo from '@/components/ui/BrandLogo'

interface IntegrationModalProps {
  open:          boolean
  onClose:       () => void
  onSaved?:      () => void        // called after the success state ends
  title:         string
  /** Legacy icon (emoji or element). Ignored when `brand` is set. */
  icon?:         React.ReactNode
  brand?:        string
  howTo?:        React.ReactNode   // collapsible guide
  children:      React.ReactNode   // the fields
  onSave:        () => Promise<void>
  saveLabel?:    string            // default "Connect"
  isConnected?:  boolean           // true → button says "Save changes"
  canDelete?:    boolean
  onDelete?:     () => Promise<void>
}

export default function IntegrationModal({
  open, onClose, onSaved, title, icon, brand, howTo, children,
  onSave, saveLabel, isConnected, canDelete, onDelete,
}: IntegrationModalProps) {
  const router = useRouter()
  const [saving,    setSaving]    = useState(false)
  const [deleting,  setDeleting]  = useState(false)
  const [error,     setError]     = useState('')
  const [success,   setSuccess]   = useState(false)
  const [showHowTo, setShowHowTo] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const panelRef   = useRef<HTMLDivElement>(null)
  const titleId    = useId()

  useEffect(() => {
    if (!open) {
      setSaving(false); setError(''); setSuccess(false); setShowHowTo(false)
      if (closeTimer.current) clearTimeout(closeTimer.current)
      return
    }
    // Focus the first field; Escape closes (unless a save is running); the page behind stays put.
    const prevFocus = document.activeElement as HTMLElement | null
    requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.int-modal-x)')?.focus())
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      prevFocus?.focus?.()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      await onSave()
      setSuccess(true)
      router.refresh()
      closeTimer.current = setTimeout(() => {
        setSuccess(false)
        onClose()
        onSaved?.()
      }, 1200)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saving failed. Try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!onDelete) return
    setDeleting(true)
    setError('')
    try {
      await onDelete()
      router.refresh()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnecting failed. Try again.')
    } finally {
      setDeleting(false)
    }
  }

  if (!open) return null

  return (
    <div className="int-modal-scrim" onMouseDown={e => { if (e.target === e.currentTarget && !saving) onClose() }}>
      <div ref={panelRef} className="int-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        {success && (
          <div className="int-modal-success" role="status">
            <CheckCircle size={52} weight="fill" aria-hidden />
            <span>{isConnected ? 'Changes saved' : `${title} connected`}</span>
          </div>
        )}

        <header className="int-modal-head">
          {brand ? <BrandLogo type={brand} size={20} tile tileSize="lg" /> : <span className="ui-tile ui-tile--lg" aria-hidden>{icon}</span>}
          <div className="int-modal-heading">
            <h2 id={titleId}>{title}</h2>
            <p>{isConnected ? 'Connected. Change the details below, or disconnect.' : 'Enter the details below to connect.'}</p>
          </div>
          <button type="button" className="int-modal-x" onClick={onClose} disabled={saving} aria-label="Close">
            <X size={16} aria-hidden />
          </button>
        </header>

        {howTo && (
          <div className="int-modal-howto">
            <button type="button" onClick={() => setShowHowTo(v => !v)} aria-expanded={showHowTo}>
              <CaretRight size={12} weight="bold" aria-hidden className="int-modal-caret" />
              Where to find these
            </button>
            {showHowTo && <div className="int-modal-howto-body">{howTo}</div>}
          </div>
        )}

        <div className="int-modal-body">
          {children}
          {error && <p className="int-modal-error" role="alert">{error}</p>}
        </div>

        <footer className="int-modal-foot">
          <div>
            {canDelete && isConnected && (
              <button type="button" onClick={handleDelete} disabled={deleting || saving} className="btn btn-danger btn-sm">
                {deleting ? 'Disconnecting…' : 'Disconnect'}
              </button>
            )}
          </div>
          <div className="int-modal-actions">
            <button type="button" onClick={onClose} disabled={saving} className="btn btn-secondary">Cancel</button>
            <button type="button" onClick={handleSave} disabled={saving || success} className="btn btn-primary">
              {saving ? 'Saving…' : saveLabel ?? (isConnected ? 'Save changes' : 'Connect')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

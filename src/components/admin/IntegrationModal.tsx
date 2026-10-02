'use client'

// The dialog for connecting or managing an integration: its fields, an optional "where to find
// these" guide, and Connect / Save changes / Disconnect. After a save the page refreshes in place,
// so every status that depends on it (the badge here, a client's Integrations tab, panels that only
// show once something is connected) updates without a reload. Built on the shared Dialog.

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { CaretRight, CheckCircle } from '@phosphor-icons/react'
import Dialog from '@/components/ui/Dialog'
import BrandLogo from '@/components/ui/BrandLogo'

interface IntegrationModalProps {
  open:          boolean
  onClose:       () => void
  onSaved?:      () => void        // called after the success state ends
  title:         string
  /** An icon element, when there's no brand logo. Ignored when `brand` is set. */
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

  // Closing resets it, so the next opening starts clean.
  useEffect(() => {
    if (open) return
    setSaving(false); setError(''); setSuccess(false); setShowHowTo(false)
    if (closeTimer.current) clearTimeout(closeTimer.current)
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

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={isConnected ? 'Connected. Change the details below, or disconnect.' : 'Enter the details below to connect.'}
      leading={brand ? <BrandLogo type={brand} size={20} tile tileSize="lg" /> : <span className="ui-tile ui-tile--lg" aria-hidden>{icon}</span>}
      busy={saving || deleting}
      bodyClassName="int-dialog-body"
      footer={<>
        {canDelete && isConnected && (
          <button type="button" onClick={handleDelete} disabled={deleting || saving} className="btn btn-danger int-disconnect">
            {deleting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        )}
        <button type="button" onClick={onClose} disabled={saving} className="btn btn-secondary">Cancel</button>
        <button type="button" onClick={handleSave} disabled={saving || success} className="btn btn-primary">
          {saving ? 'Saving…' : saveLabel ?? (isConnected ? 'Save changes' : 'Connect')}
        </button>
      </>}
    >
      {success && (
        <div className="int-modal-success" role="status">
          <CheckCircle size={52} weight="fill" aria-hidden />
          <span>{isConnected ? 'Changes saved' : `${title} connected`}</span>
        </div>
      )}

      {howTo && (
        <div className="int-modal-howto">
          <button type="button" onClick={() => setShowHowTo(v => !v)} aria-expanded={showHowTo}>
            <CaretRight size={12} weight="bold" aria-hidden className="int-modal-caret" />
            Where to find these
          </button>
          {showHowTo && <div className="int-modal-howto-body">{howTo}</div>}
        </div>
      )}

      {children}
      {error && <p className="int-modal-error" role="alert">{error}</p>}
    </Dialog>
  )
}

'use client'

// The overflow menu in the inbox header ("⋮"): the rarely-used, view-wide actions live here so the
// header stays calm.

import { useEffect, useRef, useState } from 'react'
import { DotsThreeVertical } from '@phosphor-icons/react'

export interface InboxMenuItem {
  id:        string
  label:     string
  disabled?: boolean
  danger?:   boolean
}

export default function InboxMenu({ items, onChoose }: { items: InboxMenuItem[]; onChoose: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef  = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false) }
    const onKey  = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus()
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div className="inbox-menu" ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        className="inbox-icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More alert actions"
        onClick={() => setOpen(v => !v)}
      >
        <DotsThreeVertical size={18} weight="bold" aria-hidden />
      </button>
      {open && (
        <div className="inbox-menu__list" role="menu">
          {items.map(item => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="inbox-menu__item"
              data-danger={item.danger || undefined}
              disabled={item.disabled}
              onClick={() => { setOpen(false); onChoose(item.id) }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

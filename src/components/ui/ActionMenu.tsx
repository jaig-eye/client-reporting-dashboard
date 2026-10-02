'use client'

// The ⋯ menu. Each item is a row — an icon tile, a bold label over a muted line — that opens a page
// or runs an action, with an optional second button on its right (copy the link, open elsewhere).
// It started as the Clients table's links menu; anything in the admin with more than one or two
// row actions uses it now.
//
// position: fixed from the trigger's box, because tables scroll sideways and clip anything
// absolutely positioned inside them.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DotsThree, Copy, Check, ArrowSquareOut } from '@phosphor-icons/react'
import Tile from './Tile'

export interface ActionMenuItem {
  key:      string
  label:    string
  sub?:     string
  icon?:    ReactNode
  /** A link. Internal paths open in place; newTab opens a new tab. */
  href?:    string
  newTab?:  boolean
  /** Or an action. The menu closes after it runs. */
  onSelect?: () => void
  /** A value the trailing copy button puts on the clipboard. */
  copy?:    string | null
  danger?:  boolean
  disabled?: boolean
  /** A divider above this item. */
  separated?: boolean
}

/** Clipboard write that also works inside the CRM's iframe, where the Clipboard API is refused. */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch { /* fall through */ }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'; ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try { ok = document.execCommand('copy') } catch { ok = false }
  ta.remove()
  return ok
}

export default function ActionMenu({ items, label, width = 252, trigger, align = 'end' }: {
  items: ActionMenuItem[]
  /** Names the menu for screen readers ("Links for Altec"). */
  label: string
  width?: number
  /** A custom trigger's content (the ⋯ icon by default). */
  trigger?: ReactNode
  align?: 'start' | 'end'
}) {
  const [open, setOpen]     = useState(false)
  const [pos, setPos]       = useState<{ top: number; left: number } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef    = useRef<HTMLDivElement>(null)

  function place() {
    const r = triggerRef.current?.getBoundingClientRect()
    if (!r) return
    const height = menuRef.current?.offsetHeight ?? (8 + items.length * 50)
    const below  = r.bottom + 6 + height <= window.innerHeight - 8
    const left   = align === 'end' ? r.right - width : r.left
    setPos({
      top:  below ? r.bottom + 6 : Math.max(8, r.top - 6 - height),
      left: Math.min(window.innerWidth - width - 8, Math.max(8, left)),
    })
  }

  function close(refocus = false) {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    place()
    // Measure again once the real height is known, then focus the first item.
    requestAnimationFrame(() => { place(); menuRef.current?.querySelector<HTMLElement>('a, button:not([disabled])')?.focus() })
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(true); return }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      const focusables = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('.ui-menu-main:not([disabled])') ?? [])
      if (!focusables.length) return
      e.preventDefault()
      const i = focusables.indexOf(document.activeElement as HTMLElement)
      const next = e.key === 'ArrowDown' ? (i + 1) % focusables.length : (i - 1 + focusables.length) % focusables.length
      focusables[next].focus()
    }
    // A fixed menu would drift from its row as the page scrolls, so it closes instead.
    const onMove = (e: Event) => { if (!menuRef.current?.contains(e.target as Node)) close() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function copy(item: ActionMenuItem) {
    if (!item.copy) return
    if (!(await copyText(item.copy))) return
    setCopied(item.key)
    setTimeout(() => setCopied(c => (c === item.key ? null : c)), 1600)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="ui-menu-trigger"
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        {trigger ?? <DotsThree size={18} weight="bold" aria-hidden />}
      </button>

      {open && (
        <div
          ref={menuRef}
          className="ui-menu"
          role="group"
          aria-label={label}
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}
        >
          {items.map(item => {
            const inner = (
              <>
                {item.icon && <Tile size="sm">{item.icon}</Tile>}
                <span className="ui-menu-text">
                  <span className="ui-menu-label">
                    {item.label}
                    {item.newTab && <ArrowSquareOut size={12} className="ui-menu-ext" aria-label="opens in a new tab" />}
                  </span>
                  {item.sub && <span className="ui-menu-sub">{item.sub}</span>}
                </span>
              </>
            )
            return (
              <div key={item.key}>
                {item.separated && <div className="ui-menu-sep" role="separator" />}
                <div className={`ui-menu-item${item.danger ? ' ui-menu-item--danger' : ''}`}>
                  {item.href && !item.disabled ? (
                    <a
                      className="ui-menu-main"
                      href={item.href}
                      {...(item.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                      onClick={() => close()}
                    >{inner}</a>
                  ) : (
                    <button
                      type="button"
                      className="ui-menu-main"
                      disabled={item.disabled}
                      // Focus goes back to the ⋯ button first, so whatever the action opens (a dialog)
                      // returns focus there when it closes, instead of to the page's top.
                      onClick={() => { close(true); item.onSelect?.() }}
                    >{inner}</button>
                  )}
                  {item.copy && (
                    <button
                      type="button"
                      className={`ui-menu-aux${copied === item.key ? ' ui-menu-aux--done' : ''}`}
                      onClick={() => copy(item)}
                      aria-label={copied === item.key ? `${item.label} link copied` : `Copy ${item.label.toLowerCase()} link`}
                      title={copied === item.key ? 'Copied' : 'Copy link'}
                    >
                      {copied === item.key ? <Check size={15} weight="bold" aria-hidden /> : <Copy size={15} aria-hidden />}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
          <span className="sr-only" aria-live="polite">{copied ? 'Link copied' : ''}</span>
        </div>
      )}
    </>
  )
}

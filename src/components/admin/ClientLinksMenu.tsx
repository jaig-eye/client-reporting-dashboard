'use client'

// The ⋯ button at the end of a client row on the Clients dashboard: where to go for this client,
// named, with a copy button beside each link that can be shared. Replaces two bare icons (a book
// that copied the ad library link without saying so, and a chart that opened the dashboard).
//
// The popover is position: fixed from the trigger's box, because the table scrolls sideways and
// clips anything absolutely positioned inside it — the last rows' menus would be cut off.

import { useEffect, useRef, useState } from 'react'
import { DotsThree, PresentationChart, BookOpen, Copy, Check, ArrowSquareOut } from '@phosphor-icons/react'

interface Item {
  key:     string
  label:   string
  sub:     string
  icon:    React.ReactNode
  /** Where clicking the item goes. */
  href:    string
  newTab?: boolean
  /** The link the copy button copies; none means no copy button. */
  share?:  string | null
}

const MENU_W = 248

export default function ClientLinksMenu({ clientId, clientName, dashboardToken }: {
  clientId: string
  clientName: string
  dashboardToken: string | null | undefined
}) {
  const [open, setOpen]     = useState(false)
  const [pos, setPos]       = useState<{ top: number; left: number } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef    = useRef<HTMLDivElement>(null)

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const items: Item[] = [
    {
      key: 'dashboard', label: 'Client dashboard', sub: 'What the client sees',
      icon: <PresentationChart size={16} aria-hidden />,
      href: `/api/admin/preview/${clientId}`,
      share: dashboardToken ? `${origin}/api/auth/access?token=${dashboardToken}` : null,
    },
    ...(dashboardToken ? [{
      key: 'ads', label: 'Ad library', sub: 'Every ad, shareable', newTab: true,
      icon: <BookOpen size={16} aria-hidden />,
      href: `/share/ads?token=${dashboardToken}`,
      share: `${origin}/share/ads?token=${dashboardToken}`,
    }] : []),
  ]

  function place() {
    const r = triggerRef.current?.getBoundingClientRect()
    if (!r) return
    const height = 8 + items.length * 52
    const below  = r.bottom + 6 + height <= window.innerHeight
    setPos({
      top:  below ? r.bottom + 6 : Math.max(8, r.top - 6 - height),
      left: Math.min(window.innerWidth - MENU_W - 8, Math.max(8, r.right - MENU_W)),
    })
  }

  function close(refocus = false) {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    place()
    // The first item takes focus, so the keyboard lands in the menu.
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('a, button')?.focus())
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) close()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(true) }
    // A fixed menu would drift from its row as the page or table scrolls, so it closes instead.
    const onMove = () => close()
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

  async function copy(item: Item) {
    if (!item.share) return
    let ok = false
    try {
      await navigator.clipboard.writeText(item.share)
      ok = true
    } catch {
      // The Clipboard API is refused inside the CRM's iframe unless it grants clipboard-write;
      // the older copy command still works there.
      const ta = document.createElement('textarea')
      ta.value = item.share
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { ok = document.execCommand('copy') } catch { ok = false }
      ta.remove()
    }
    if (!ok) return
    setCopied(item.key)
    setTimeout(() => setCopied(c => (c === item.key ? null : c)), 1600)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="clm-trigger"
        aria-label={`Links for ${clientName}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <DotsThree size={18} weight="bold" aria-hidden />
      </button>

      {open && pos && (
        <div ref={menuRef} className="clm-menu" style={{ top: pos.top, left: pos.left, width: MENU_W }} aria-label={`Links for ${clientName}`} role="group">
          {items.map(item => (
            <div key={item.key} className="clm-item">
              <a
                className="clm-link"
                href={item.href}
                {...(item.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                onClick={() => close()}
              >
                <span className="clm-icon">{item.icon}</span>
                <span className="clm-text">
                  <span className="clm-label">
                    {item.label}
                    {item.newTab && <ArrowSquareOut size={12} aria-label="opens in a new tab" className="clm-ext" />}
                  </span>
                  <span className="clm-sub">{item.sub}</span>
                </span>
              </a>
              {item.share && (
                <button
                  type="button"
                  className={`clm-copy${copied === item.key ? ' clm-copy--done' : ''}`}
                  onClick={() => copy(item)}
                  aria-label={copied === item.key ? `${item.label} link copied` : `Copy ${item.label.toLowerCase()} link`}
                  title={copied === item.key ? 'Copied' : 'Copy link'}
                >
                  {copied === item.key ? <Check size={15} weight="bold" aria-hidden /> : <Copy size={15} aria-hidden />}
                </button>
              )}
            </div>
          ))}
          <span className="sr-only" aria-live="polite">{copied ? 'Link copied' : ''}</span>
        </div>
      )}
    </>
  )
}

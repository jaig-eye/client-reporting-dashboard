'use client'

// Ad Fuel balance as part of the sidebar: it sits directly under the page tabs, spans the
// sidebar's full width and uses the sidebar's own surfaces, so it reads as navigation-adjacent
// status rather than a card dropped into the column.
//
// The colour follows the same rule as the admin (lib/adFuelColor): it says only how low the
// balance is. The gauge fill is relative to about a month of spend and is decoration only.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, ClockCounterClockwise } from '@phosphor-icons/react'
import { balanceLevel } from '@/lib/adFuelColor'
import { fmt$ } from '@/lib/metrics'
import { FORM_URL } from './AdFuelBadge'
import AdFuelModal from './AdFuelModal'

export default function AdFuelSidebar({
  balance, clientName, monthlyReference, pendingAmount,
}: {
  balance:           number | null
  clientName:        string
  monthlyReference?: number
  pendingAmount?:    number
}) {
  const [open, setOpen] = useState(false)

  const level     = balance == null ? 'unknown' : balanceLevel(balance)
  const reference = monthlyReference && monthlyReference > 0 ? monthlyReference : 1500
  const fill      = balance == null || balance <= 0 ? 0 : Math.min(100, Math.max(4, (balance / reference) * 100))
  const amount    = balance == null
    ? '—'
    : `${balance < 0 ? '-' : ''}$${Math.abs(balance).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  const refillUrl = `${FORM_URL}?organization=${encodeURIComponent(clientName)}`

  return (
    <section className={`adfuel-side adfuel-side--${level}`} aria-label="Ad Fuel balance">
      <div className="adfuel-side__head">
        <span className="adfuel-side__label">Ad Fuel</span>
        <button type="button" className="adfuel-side__activity focus-ring" onClick={() => setOpen(true)}>
          <ClockCounterClockwise size={12} weight="bold" aria-hidden />
          Activity
        </button>
      </div>

      <div className="adfuel-side__row">
        <span className="adfuel-side__amount">{amount}</span>
        <a
          className="adfuel-side__refill focus-ring"
          href={refillUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Refill Ad Fuel"
          title="Refill Ad Fuel"
        >
          <Plus size={13} weight="bold" aria-hidden />
        </a>
      </div>

      <div className="adfuel-side__meter" aria-hidden>
        <span className="adfuel-side__fill" style={{ width: `${fill}%` }} />
      </div>

      {(level === 'low' || level === 'negative' || (pendingAmount ?? 0) > 0) && (
        <p className="adfuel-side__note">
          {level === 'negative' ? 'Balance is below zero' : level === 'low' ? 'Running low' : null}
          {(level === 'low' || level === 'negative') && (pendingAmount ?? 0) > 0 && <span aria-hidden> · </span>}
          {(pendingAmount ?? 0) > 0 && <span className="adfuel-side__pending">+{fmt$(pendingAmount!)} pending</span>}
        </p>
      )}

      {/* Rendered into <body>, not inside the sidebar. The sidebar is sticky on desktop and sits in
          the fixed nav drawer on phones; both create their own stacking context, which capped the
          modal's z-index there and let the page's charts paint straight through it. Open state only
          ever turns on after a click, so document always exists here. */}
      {open && createPortal(<AdFuelModal balance={balance} onClose={() => setOpen(false)} />, document.body)}
    </section>
  )
}

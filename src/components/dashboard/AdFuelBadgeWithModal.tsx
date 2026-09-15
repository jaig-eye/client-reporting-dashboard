'use client'

import { useState } from 'react'
import AdFuelBadge from './AdFuelBadge'
import AdFuelModal from './AdFuelModal'

export default function AdFuelBadgeWithModal({
  balance,
  clientName,
  monthlyBudget,
  pendingAmount,
  width,
}: {
  balance:        number | null
  clientName:     string
  monthlyBudget?: number
  pendingAmount?: number
  /** Defaults to the badge's own 188px; the sidebar passes '100%'. */
  width?:         number | string
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <AdFuelBadge
        balance={balance}
        clientName={clientName}
        monthlyBudget={monthlyBudget}
        pendingAmount={pendingAmount}
        onActivityClick={() => setOpen(true)}
        width={width}
      />
      {open && <AdFuelModal balance={balance} onClose={() => setOpen(false)} />}
    </>
  )
}

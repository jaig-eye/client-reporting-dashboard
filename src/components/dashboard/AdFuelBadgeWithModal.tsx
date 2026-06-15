'use client'

import { useState } from 'react'
import AdFuelBadge from './AdFuelBadge'
import AdFuelModal from './AdFuelModal'

export default function AdFuelBadgeWithModal({
  balance,
  clientName,
  monthlyBudget,
  pendingAmount,
}: {
  balance:        number
  clientName:     string
  monthlyBudget?: number
  pendingAmount?: number
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
      />
      {open && <AdFuelModal onClose={() => setOpen(false)} />}
    </>
  )
}

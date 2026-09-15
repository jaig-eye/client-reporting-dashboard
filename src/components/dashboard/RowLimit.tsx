'use client'

// Long tables show their top 10 rows, with a button for the rest.
//
// The rows stay rendered and are only hidden by CSS (.row-limit[data-open='false']), so a sortable
// table inside keeps working: sorting re-orders the rows and the top 10 of the new order show.

import { useState, type ReactNode } from 'react'

const LIMIT = 10   // matches the nth-child rule in globals.css

export default function RowLimit({
  total,
  noun,
  children,
}: {
  /** How many rows the table has. */
  total: number
  /** What the rows are, for the button: "Show all 25 searches". */
  noun: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const needed = total > LIMIT

  return (
    <div className="row-limit" data-open={open || !needed}>
      {children}
      {needed && (
        <button
          type="button"
          className="row-limit__toggle"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >
          {open ? `Show top ${LIMIT}` : `Show all ${total} ${noun}`}
        </button>
      )}
    </div>
  )
}

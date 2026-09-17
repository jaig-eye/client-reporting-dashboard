'use client'

// Long tables show their top 10 rows, with a button for the rest.
//
// The rows stay rendered and are only hidden by CSS (.row-limit[data-open='false']), so a sortable
// table inside keeps working: sorting re-orders the rows and the top 10 of the new order show.

import { useState, type ReactNode } from 'react'

// Each supported limit needs its own nth-child rule in globals.css, so this is a fixed set rather
// than any number: 10 for tables, 4 for lists whose rows are tall enough to run down the page.
const LIMIT = 10

export default function RowLimit({
  total,
  noun,
  limit = LIMIT,
  children,
}: {
  /** How many rows the table has. */
  total: number
  /** What the rows are, for the button: "Show all 25 searches". */
  noun: string
  /** How many to show before collapsing. Must have a matching rule in globals.css. */
  limit?: 4 | 10
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const needed = total > limit

  return (
    <div className="row-limit" data-open={open || !needed} data-limit={limit}>
      {children}
      {needed && (
        <button
          type="button"
          className="row-limit__toggle"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >
          {open ? `Show top ${limit}` : `Show all ${total} ${noun}`}
        </button>
      )}
    </div>
  )
}

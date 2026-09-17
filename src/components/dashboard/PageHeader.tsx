// The header every client dashboard page opens with.
//
// This was copy-pasted into three pages and missing entirely from a fourth (Google Maps Ranking),
// where a client landed on a bare card with no title and no date control. One component now, so a
// page cannot ship without a header and the layout only has to be made responsive once.

import { Suspense, type ReactNode } from 'react'
import DateRangePicker from '@/components/DateRangePicker'

interface Props {
  /** What the page shows, in the client's words — not the vendor's. */
  title: string
  fromDate?: Date
  toDate?: Date
  compare?: string
  /** Pages without a time dimension (an embed, a live snapshot) pass false. */
  showDateRange?: boolean
  /** A back link or badge that belongs with the title. */
  children?: ReactNode
}

const iso = (d: Date) => d.toISOString().split('T')[0]

export default function PageHeader({
  title, fromDate, toDate, compare = '', showDateRange = true, children,
}: Props) {
  return (
    <div className="dash-page-header">
      <div className="dash-page-header__title">
        <h1>{title}</h1>
        {children}
      </div>

      {showDateRange && fromDate && toDate && (
        <div className="dash-page-header__controls">
          <Suspense fallback={null}>
            <DateRangePicker from={iso(fromDate)} to={iso(toDate)} compare={compare} />
          </Suspense>
        </div>
      )}
    </div>
  )
}

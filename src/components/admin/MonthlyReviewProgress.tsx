'use client'

// The review's one control strip: which month (with the months either side), how far through it
// the reviewer is, and how many clients are finished. Sticks to the top while the list scrolls.

import Link from 'next/link'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'

interface Props {
  approvedCount:  number
  totalPosts:     number
  clientsTotal:   number
  clientsDone:    number
  month:          string
  prevUrl?:       string | null
  nextUrl?:       string | null
}

export default function MonthlyReviewProgress({
  approvedCount,
  totalPosts,
  clientsTotal,
  clientsDone,
  month,
  prevUrl,
  nextUrl,
}: Props) {
  const pct = totalPosts > 0 ? Math.round((approvedCount / totalPosts) * 100) : 0

  return (
    <div className="mr-bar">
      <nav className="mr-month" aria-label="Month">
        {prevUrl
          ? <Link href={prevUrl} className="mr-nav" aria-label="Previous month"><CaretLeft size={16} weight="bold" /></Link>
          : <span className="mr-nav" aria-disabled="true" aria-hidden><CaretLeft size={16} weight="bold" /></span>}
        <span className="mr-month-name" aria-current="date">{month}</span>
        {nextUrl
          ? <Link href={nextUrl} className="mr-nav" aria-label="Next month"><CaretRight size={16} weight="bold" /></Link>
          : <span className="mr-nav" aria-disabled="true" aria-hidden><CaretRight size={16} weight="bold" /></span>}
      </nav>

      {totalPosts > 0 && (
        <>
          <div
            className="mr-meter"
            role="progressbar"
            aria-label="Posts approved"
            aria-valuemin={0}
            aria-valuemax={totalPosts}
            aria-valuenow={approvedCount}
          >
            <span style={{ width: `${pct}%` }} />
          </div>
          <span className="mr-count">
            <strong>{approvedCount}</strong> of {totalPosts} approved · <strong>{clientsDone}</strong> of {clientsTotal} clients done
          </span>
        </>
      )}
    </div>
  )
}

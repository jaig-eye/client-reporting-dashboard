'use client'

// Every post in the month decided. Says what happens now, and offers the two useful next steps:
// the calendar, or the next month's review.

import Link from 'next/link'
import { CheckCircle } from '@phosphor-icons/react'
import Tile from '@/components/ui/Tile'

interface Props {
  totalPosts:   number
  clientsTotal: number
  month:        string
  nextUrl?:     string | null
}

export default function MonthlyReviewComplete({ totalPosts, clientsTotal, month, nextUrl }: Props) {
  return (
    <div className="mr-done" role="status">
      <span className="mr-done-tick"><Tile size="xl" tone="green"><CheckCircle size={30} weight="fill" /></Tile></span>
      <h2 className="mr-done-title">{month} is reviewed</h2>
      <p className="mr-done-text">
        {totalPosts} post{totalPosts === 1 ? '' : 's'} approved across {clientsTotal} client{clientsTotal === 1 ? '' : 's'}.
        They publish on their scheduled dates through the month.
      </p>
      <div className="mr-done-actions">
        <Link href="/admin/content?view=calendar" className="btn btn-secondary">Open the calendar</Link>
        {nextUrl && <Link href={nextUrl} className="btn btn-primary">Review next month</Link>}
      </div>
    </div>
  )
}

'use client'

import { WarningCircle } from '@phosphor-icons/react'
import EmptyState from '@/components/ui/EmptyState'

// A content view failed on the server (for example the review's query, which fails loudly rather
// than showing an empty month). Says what the server said, and offers a retry.
export default function ContentError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card" style={{ maxWidth: 560, margin: '2rem auto' }}>
      <EmptyState
        icon={<WarningCircle size={22} weight="duotone" />}
        tone="red"
        title="This view didn’t load"
        actions={<button type="button" className="btn btn-primary" onClick={reset}>Try again</button>}
      >
        {error.message}
      </EmptyState>
    </div>
  )
}

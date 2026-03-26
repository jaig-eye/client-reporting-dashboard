'use client'

import Link from 'next/link'

export default function PreviewButton({ clientId }: { clientId: string }) {
  return (
    <Link
      href={`/admin/preview/${clientId}`}
      className="btn btn-secondary"
      style={{ padding: '0.375rem 0.75rem' }}
    >
      Preview
    </Link>
  )
}

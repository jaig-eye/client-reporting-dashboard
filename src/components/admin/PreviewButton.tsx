'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function PreviewButton({ clientId }: { clientId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handlePreview() {
    setLoading(true)
    await fetch(`/api/admin/preview/${clientId}`, { method: 'POST' })
    router.push('/dashboard')
  }

  return (
    <button
      onClick={handlePreview}
      disabled={loading}
      className="btn btn-secondary"
      style={{ padding: '0.375rem 0.75rem' }}
    >
      {loading ? '…' : 'Preview'}
    </button>
  )
}

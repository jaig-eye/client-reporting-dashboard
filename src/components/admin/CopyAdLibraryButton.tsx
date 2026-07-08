'use client'

import { useState } from 'react'

export function CopyAdLibraryButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="btn btn-secondary"
      style={{ fontSize: '0.8rem', padding: '0.375rem 0.75rem' }}
    >
      {copied ? '✓ Copied!' : 'Ad Library Link'}
    </button>
  )
}

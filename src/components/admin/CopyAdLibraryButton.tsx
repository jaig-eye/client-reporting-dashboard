'use client'

import { useState } from 'react'

export function CopyAdLibraryButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard API unavailable (non-HTTPS or denied permission) — fall back to prompt
      window.prompt('Copy this link:', url)
    }
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

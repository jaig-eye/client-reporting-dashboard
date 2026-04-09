'use client'

import { useState } from 'react'
import { Copy, Check } from '@phosphor-icons/react'

export default function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const el = document.createElement('textarea')
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <button
      onClick={handleCopy}
      aria-label={copied ? 'Copied' : 'Copy to clipboard'}
      className="focus-ring"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: '0.75rem', fontWeight: 500, flexShrink: 0,
        background: 'none', border: 'none', cursor: 'pointer',
        color: copied ? 'var(--green)' : 'var(--blue)',
        transition: 'color 0.15s',
        padding: '2px 4px', borderRadius: 4,
      }}
    >
      {copied
        ? <Check size={12} aria-hidden />
        : <Copy size={12} aria-hidden />
      }
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

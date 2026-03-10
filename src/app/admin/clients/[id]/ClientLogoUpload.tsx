'use client'

import { useState } from 'react'

export default function ClientLogoUpload({
  clientId,
  currentLogoUrl,
}: {
  clientId: string
  currentLogoUrl?: string
}) {
  const [logoUrl,   setLogoUrl]   = useState(currentLogoUrl ?? '')
  const [uploading, setUploading] = useState(false)
  const [error,     setError]     = useState('')
  const [saved,     setSaved]     = useState(false)

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('folder', 'clients')
      const res  = await fetch('/api/upload', { method: 'POST', body: form })
      const data = await res.json()
      if (!data.url) throw new Error(data.error || 'Upload failed')
      await saveLogo(data.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function saveLogo(url: string) {
    const res = await fetch(`/api/admin/clients/${clientId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ logo_url: url }),
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error)
    setLogoUrl(url)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function removeLogo() {
    try {
      await saveLogo('')
      setLogoUrl('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove logo')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {logoUrl ? (
          <img src={logoUrl} alt="Client logo" className="h-12 max-w-[120px] object-contain rounded" />
        ) : (
          <div
            className="h-12 w-12 rounded-lg flex items-center justify-center text-xs font-medium flex-shrink-0"
            style={{ background: 'var(--bg-subtle)', color: 'var(--text-faint)', border: '1px solid var(--border)' }}
          >
            No logo
          </div>
        )}
        <div className="flex gap-2">
          <label className="btn btn-secondary cursor-pointer" style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}>
            {uploading ? 'Uploading…' : logoUrl ? 'Replace' : 'Upload'}
            <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
          </label>
          {logoUrl && (
            <button onClick={removeLogo} className="btn btn-secondary" style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}>
              Remove
            </button>
          )}
        </div>
      </div>
      {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
      {saved && <p className="text-xs" style={{ color: 'var(--green)' }}>Saved ✓</p>}
      <p className="text-xs" style={{ color: 'var(--text-faint)' }}>JPG, PNG, SVG — max 4 MB</p>
    </div>
  )
}

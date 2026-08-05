'use client'

import { useRef, useState } from 'react'

export default function ClientLogoUpload({
  clientId,
  currentLogoUrl,
  onUpload,
}: {
  clientId: string
  currentLogoUrl?: string
  onUpload?: (url: string) => void
}) {
  const fileRef   = useRef<HTMLInputElement>(null)
  const [logoUrl,   setLogoUrl]   = useState(currentLogoUrl ?? '')
  const [urlInput,  setUrlInput]  = useState('')
  const [uploading, setUploading] = useState(false)
  const [error,     setError]     = useState('')
  const [saved,     setSaved]     = useState(false)

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset input so same file can be re-selected if needed
    if (fileRef.current) fileRef.current.value = ''
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
    setUrlInput('')
    setSaved(true)
    onUpload?.(url)
    setTimeout(() => setSaved(false), 2500)
  }

  async function handleSaveUrl() {
    const url = urlInput.trim()
    if (!url) return
    setError('')
    try { await saveLogo(url) }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to save') }
  }

  async function removeLogo() {
    setError('')
    try { await saveLogo('') }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to remove logo') }
  }

  return (
    <div className="space-y-3">
      {/* Preview */}
      <div className="flex items-center gap-3">
        {logoUrl ? (
          <img src={logoUrl} alt="Client logo" className="h-12 max-w-[120px] object-contain rounded" style={{ border: '1px solid var(--border)' }} />
        ) : (
          <div
            className="h-12 w-12 rounded-lg flex items-center justify-center text-xs font-medium flex-shrink-0"
            style={{ background: 'var(--bg-subtle)', color: 'var(--text-faint)', border: '1px solid var(--border)' }}
          >
            No logo
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          {/* File upload — uses ref-based trigger for reliable cross-browser support */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="btn btn-secondary"
            style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
          >
            {uploading ? 'Uploading…' : logoUrl ? 'Replace' : 'Upload file'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleUpload}
          />
          {logoUrl && (
            <button
              type="button"
              onClick={removeLogo}
              className="btn btn-secondary"
              style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {/* URL paste alternative (works without Vercel Blob) */}
      <div className="flex gap-2">
        <input
          type="url"
          value={urlInput}
          onChange={e => setUrlInput(e.target.value)}
          placeholder="Or paste image URL…"
          className="input flex-1"
          style={{ fontSize: '0.8rem' }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSaveUrl() } }}
        />
        <button
          type="button"
          onClick={handleSaveUrl}
          disabled={!urlInput.trim()}
          className="btn btn-secondary"
          style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
        >
          Save URL
        </button>
      </div>

      {error && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--red-subtle)', color: 'var(--red)', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}
      {saved && <p className="text-xs" style={{ color: 'var(--green)' }}>Logo saved ✓</p>}
      <p className="text-xs" style={{ color: 'var(--text-faint)' }}>JPG, PNG, SVG — max 4 MB. File upload requires Vercel Blob (BLOB_READ_WRITE_TOKEN).</p>
    </div>
  )
}

'use client'

// The client's logo: upload a file, paste an image URL, or remove it. Saves straight away (it
// PATCHes logo_url itself), and tells the business-info form through onUpload.

import { useRef, useState } from 'react'
import { UploadSimple, Check } from '@phosphor-icons/react'

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
    <div className="co-logo">
      <div className="co-logo-top">
        <span className="co-logo-preview">
          {logoUrl ? <img src={logoUrl} alt="Client logo" /> : 'No logo'}
        </span>
        <div className="co-actions">
          {/* File upload — uses ref-based trigger for reliable cross-browser support */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="btn btn-secondary btn-sm"
          >
            <UploadSimple size={14} aria-hidden />
            {uploading ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleUpload}
          />
          {logoUrl && (
            <button type="button" onClick={removeLogo} className="btn btn-ghost btn-sm">
              Remove
            </button>
          )}
          {saved && <span className="co-saved" role="status"><Check size={13} weight="bold" aria-hidden />Logo saved</span>}
        </div>
      </div>

      {/* URL paste alternative (works without Vercel Blob) */}
      <div className="co-logo-url">
        <input
          type="url"
          value={urlInput}
          onChange={e => setUrlInput(e.target.value)}
          placeholder="Or paste an image URL"
          aria-label="Logo image URL"
          className="input"
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSaveUrl() } }}
        />
        <button
          type="button"
          onClick={handleSaveUrl}
          disabled={!urlInput.trim()}
          className="btn btn-secondary btn-sm"
        >
          Use URL
        </button>
      </div>

      {error && <div className="ui-notice ui-notice--danger" role="alert">{error}</div>}
      <p className="co-hint" style={{ marginTop: 0 }}>
        JPG, PNG or SVG, up to 4 MB. Or paste the address of an image that’s already online.
      </p>
    </div>
  )
}

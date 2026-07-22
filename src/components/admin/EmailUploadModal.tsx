'use client'

import { useState, useRef } from 'react'
import { X, Image, UploadSimple, ArrowLeft, ArrowRight } from '@phosphor-icons/react'
import type { EmailClient } from './EmailsClientShell'

interface Props {
  clients:   EmailClient[]
  onClose:   () => void
  onCreated: (email: unknown) => void
}

type Step = 1 | 2 | 3

export default function EmailUploadModal({ clients, onClose, onCreated }: Props) {
  const [step, setStep] = useState<Step>(1)

  // Step 1 fields
  const [clientId,    setClientId]    = useState('')
  const [title,       setTitle]       = useState('')
  const [subject,     setSubject]     = useState('')
  const [goal,        setGoal]        = useState('')
  const [sentAt,      setSentAt]      = useState('')
  const [status,      setStatus]      = useState<'pending_review' | 'draft'>('pending_review')

  // Step 2 fields
  const [imageUrl,    setImageUrl]    = useState<string | null>(null)
  const [imageFile,   setImageFile]   = useState<File | null>(null)
  const [previewUrl,  setPreviewUrl]  = useState('')
  const [htmlContent, setHtmlContent] = useState('')
  const [contentTab,  setContentTab]  = useState<'image' | 'html' | 'url'>('image')

  // Step 3 fields
  const [utmCampaign, setUtmCampaign] = useState('')
  const [openRate,    setOpenRate]    = useState('')
  const [clickRate,   setClickRate]   = useState('')
  const [conversions, setConversions] = useState('')
  const [revenue,     setRevenue]     = useState('')

  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // ── Image upload via Supabase storage (client-side fetch to upload route)
  async function uploadImage(file: File): Promise<string | null> {
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch('/api/admin/emails/upload-image', { method: 'POST', body: formData })
    if (!res.ok) return null
    const { url } = await res.json() as { url: string }
    return url
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    setImageUrl(URL.createObjectURL(file))
  }

  function canProceed(): boolean {
    if (step === 1) return !!clientId && !!title.trim()
    if (step === 2) return true // content is optional — can review before adding
    return true
  }

  async function handleSubmit() {
    if (saving) return
    setSaving(true)
    setError(null)

    try {
      let finalImageUrl: string | null = null
      if (imageFile) {
        finalImageUrl = await uploadImage(imageFile)
        if (!finalImageUrl) {
          setError('Image upload failed. Try again or use a URL.')
          setSaving(false)
          return
        }
      }

      const body = {
        client_id:         clientId,
        title:             title.trim(),
        subject_line:      subject.trim() || undefined,
        goal:              goal.trim() || undefined,
        sent_at:           sentAt || undefined,
        status,
        preview_image_url: finalImageUrl || undefined,
        preview_url:       previewUrl.trim() || undefined,
        html_content:      htmlContent.trim() || undefined,
        utm_campaign:      utmCampaign.trim() || undefined,
        open_rate:         openRate   ? parseFloat(openRate)   : undefined,
        click_rate:        clickRate  ? parseFloat(clickRate)  : undefined,
        conversions:       conversions ? parseInt(conversions)  : undefined,
        revenue:           revenue    ? parseFloat(revenue)    : undefined,
      }

      const res = await fetch('/api/admin/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json() as { error?: string }
        setError(d.error ?? 'Failed to save email')
        setSaving(false)
        return
      }
      const { email } = await res.json() as { email: unknown }
      onCreated(email)
    } catch {
      setError('Unexpected error. Please try again.')
      setSaving(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.5rem 0.625rem', boxSizing: 'border-box',
    background: 'var(--bg-subtle)', border: '1px solid var(--border)',
    borderRadius: 6, fontSize: '0.8rem', color: 'var(--text)', fontFamily: 'inherit',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)',
    display: 'block', marginBottom: 4,
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12,
        width: '100%', maxWidth: 560, maxHeight: '90vh', overflow: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Add Email</h2>
            <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-faint)' }}>Step {step} of 3</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
            <X size={18} aria-hidden />
          </button>
        </div>

        {/* Step progress */}
        <div style={{ display: 'flex', padding: '0.75rem 1.25rem 0', gap: 6 }}>
          {([1,2,3] as Step[]).map(s => (
            <div key={s} style={{
              flex: 1, height: 3, borderRadius: 2,
              background: s <= step ? 'var(--blue)' : 'var(--border)',
              transition: 'background 0.2s',
            }} />
          ))}
        </div>

        <div style={{ padding: '1.25rem' }}>
          {/* ── Step 1: Details ── */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={labelStyle}>Client *</label>
                <select value={clientId} onChange={e => setClientId(e.target.value)} style={inputStyle}>
                  <option value="">Select a client…</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Email Title *</label>
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. November Newsletter" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Subject Line</label>
                <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Don't miss these deals…" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Goal / Strategy</label>
                <input value={goal} onChange={e => setGoal(e.target.value)} placeholder="e.g. Drive holiday sales, Re-engage cold list" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Sent / Scheduled Date</label>
                <input type="date" value={sentAt} onChange={e => setSentAt(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Submit as</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['pending_review', 'draft'] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setStatus(s)}
                      style={{
                        flex: 1, padding: '0.4rem', fontSize: '0.75rem', fontWeight: 600,
                        borderRadius: 6, border: '1px solid',
                        borderColor: status === s ? 'var(--blue)' : 'var(--border)',
                        background:  status === s ? 'var(--blue)' : 'transparent',
                        color:       status === s ? '#fff' : 'var(--text-muted)',
                        cursor: 'pointer',
                      }}
                    >
                      {s === 'pending_review' ? 'Submit for Review' : 'Save as Draft'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2: Content (image-first) ── */}
          {step === 2 && (
            <div>
              {/* Tab switcher */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
                {(['image', 'html', 'url'] as const).map(t => (
                  <button key={t} onClick={() => setContentTab(t)}
                    style={{
                      padding: '0.3rem 0.75rem', fontSize: '0.72rem', fontWeight: 600, borderRadius: 6,
                      border: '1px solid',
                      borderColor: contentTab === t ? 'var(--blue)' : 'var(--border)',
                      background:  contentTab === t ? 'var(--blue)' : 'transparent',
                      color:       contentTab === t ? '#fff' : 'var(--text-muted)',
                      cursor: 'pointer',
                    }}>
                    {t === 'image' ? 'Upload Image' : t === 'html' ? 'Paste HTML' : 'Preview URL'}
                  </button>
                ))}
              </div>

              {contentTab === 'image' && (
                <div>
                  <input ref={fileRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
                  <div
                    onClick={() => fileRef.current?.click()}
                    style={{
                      border: '2px dashed var(--border)', borderRadius: 8,
                      padding: '2rem', textAlign: 'center', cursor: 'pointer',
                      background: 'var(--bg-subtle)',
                    }}
                  >
                    {imageUrl
                      ? <img src={imageUrl} alt="preview" style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 4, objectFit: 'contain' }} />
                      : <>
                          <UploadSimple size={28} style={{ color: 'var(--text-faint)', marginBottom: 8 }} aria-hidden />
                          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-faint)' }}>
                            Click to upload email screenshot (JPG, PNG, GIF)
                          </p>
                        </>}
                  </div>
                  {imageUrl && (
                    <button onClick={() => { setImageUrl(null); setImageFile(null) }}
                      style={{ marginTop: 6, fontSize: '0.72rem', color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer' }}>
                      Remove image
                    </button>
                  )}
                </div>
              )}

              {contentTab === 'html' && (
                <div>
                  <label style={labelStyle}>Paste email HTML</label>
                  <textarea
                    value={htmlContent}
                    onChange={e => setHtmlContent(e.target.value)}
                    rows={10}
                    placeholder="<!DOCTYPE html>…"
                    style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: '0.75rem' }}
                  />
                  {htmlContent && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ fontSize: '0.72rem', cursor: 'pointer', color: 'var(--text-faint)' }}>Preview HTML</summary>
                      <iframe
                        srcDoc={htmlContent}
                        sandbox=""
                        style={{ width: '100%', height: 300, border: '1px solid var(--border)', borderRadius: 6, marginTop: 6 }}
                        title="Email HTML preview"
                      />
                    </details>
                  )}
                </div>
              )}

              {contentTab === 'url' && (
                <div>
                  <label style={labelStyle}>External preview URL</label>
                  <input
                    value={previewUrl}
                    onChange={e => setPreviewUrl(e.target.value)}
                    placeholder="https://litmus.com/previews/…"
                    style={inputStyle}
                  />
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: 4 }}>
                    Link to a Litmus, Email on Acid, or other preview URL.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Tracking / Performance ── */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-faint)' }}>
                These fields are optional and can be filled in after the email sends.
              </p>
              <div>
                <label style={labelStyle}>UTM Campaign</label>
                <input value={utmCampaign} onChange={e => setUtmCampaign(e.target.value)} placeholder="e.g. nov-newsletter-2024" style={inputStyle} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={labelStyle}>Open Rate (%)</label>
                  <input type="number" min="0" max="100" step="0.1" value={openRate} onChange={e => setOpenRate(e.target.value)} placeholder="22.5" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Click Rate (%)</label>
                  <input type="number" min="0" max="100" step="0.1" value={clickRate} onChange={e => setClickRate(e.target.value)} placeholder="3.4" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Conversions</label>
                  <input type="number" min="0" value={conversions} onChange={e => setConversions(e.target.value)} placeholder="12" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Revenue ($)</label>
                  <input type="number" min="0" step="0.01" value={revenue} onChange={e => setRevenue(e.target.value)} placeholder="1500.00" style={inputStyle} />
                </div>
              </div>
            </div>
          )}

          {error && (
            <p style={{ marginTop: 10, fontSize: '0.78rem', color: 'var(--red)' }}>{error}</p>
          )}

          {/* Footer nav */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20 }}>
            <button
              onClick={() => step > 1 ? setStep((step - 1) as Step) : onClose()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '0.45rem 0.9rem', background: 'transparent',
                border: '1px solid var(--border)', borderRadius: 6,
                fontSize: '0.78rem', cursor: 'pointer', color: 'var(--text-muted)',
              }}
            >
              <ArrowLeft size={14} aria-hidden />
              {step === 1 ? 'Cancel' : 'Back'}
            </button>

            {step < 3 ? (
              <button
                onClick={() => canProceed() && setStep((step + 1) as Step)}
                disabled={!canProceed()}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '0.45rem 0.9rem', background: 'var(--blue)', color: '#fff',
                  border: 'none', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600,
                  cursor: canProceed() ? 'pointer' : 'not-allowed', opacity: canProceed() ? 1 : 0.5,
                }}
              >
                Next <ArrowRight size={14} aria-hidden />
              </button>
            ) : (
              <button
                onClick={() => void handleSubmit()}
                disabled={saving}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '0.45rem 0.9rem', background: 'var(--blue)', color: '#fff',
                  border: 'none', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600,
                  cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? 'Submitting…' : 'Submit Email'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

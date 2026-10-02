'use client'

// Add an email campaign in two steps: the details, then what it looks like (a screenshot, the
// HTML, or a link to an external preview). Content is optional, so an email can go in for review
// before it's designed. The shared Dialog, so on a phone it rises from the bottom.

import '@/styles/admin/emails.css'
import { useState, useRef } from 'react'
import { UploadSimple, ArrowLeft, ArrowRight } from '@phosphor-icons/react'
import { PillTabs } from '@/components/ui/PillTabs'
import Dialog from '@/components/ui/Dialog'
import type { EmailClient } from './EmailsClientShell'

interface Props {
  clients:   EmailClient[]
  onClose:   () => void
  onCreated: (email: unknown) => void
}

type Step = 1 | 2

const CONTENT_TABS = [
  { id: 'image', label: 'Upload image' },
  { id: 'html',  label: 'Paste HTML' },
  { id: 'url',   label: 'Preview link' },
] as const

export default function EmailUploadModal({ clients, onClose, onCreated }: Props) {
  const [step, setStep] = useState<Step>(1)

  // Step 1 fields
  const [clientId,    setClientId]    = useState('')
  const [title,       setTitle]       = useState('')
  const [subject,     setSubject]     = useState('')
  const [goal,        setGoal]        = useState('')
  const [sentAt,      setSentAt]      = useState('')
  const [utmCampaign, setUtmCampaign] = useState('')
  const [status,      setStatus]      = useState<'pending_review' | 'draft'>('pending_review')

  // Step 2 fields
  const [imageUrl,    setImageUrl]    = useState<string | null>(null)
  const [imageFile,   setImageFile]   = useState<File | null>(null)
  const [previewUrl,  setPreviewUrl]  = useState('')
  const [htmlContent, setHtmlContent] = useState('')
  const [contentTab,  setContentTab]  = useState<'image' | 'html' | 'url'>('image')

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
          setError('The image didn’t upload. Try again, or use a preview link instead.')
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
      }

      const res = await fetch('/api/admin/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json() as { error?: string }
        setError(d.error ?? 'Couldn’t save the email.')
        setSaving(false)
        return
      }
      const { email } = await res.json() as { email: unknown }
      onCreated(email)
    } catch {
      setError('Something went wrong. Try again.')
      setSaving(false)
    }
  }

  function next() {
    if (canProceed()) setStep((step + 1) as Step)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      busy={saving}
      className="em-scope"
      title="Add an email"
      description={`Step ${step} of 2: ${step === 1 ? 'the details' : 'what it looks like'}`}
      footer={<>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => step > 1 ? setStep((step - 1) as Step) : onClose()}
          disabled={saving}
        >
          {step > 1 && <ArrowLeft size={14} aria-hidden />}
          {step === 1 ? 'Cancel' : 'Back'}
        </button>

        {step < 2 ? (
          <button type="submit" form="em-add-details" className="btn btn-primary" disabled={!canProceed()}>
            Next: the content <ArrowRight size={14} aria-hidden />
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => void handleSubmit()} disabled={saving}>
            {saving ? 'Saving…' : status === 'pending_review' ? 'Send for review' : 'Save draft'}
          </button>
        )}
      </>}
    >
        <div className="em-steps" aria-hidden>
          {([1, 2] as Step[]).map(s => <span key={s} data-on={s <= step} />)}
        </div>
          {/* ── Step 1: Details ── */}
          {step === 1 && (
            <form className="em-form" onSubmit={e => { e.preventDefault(); next() }} id="em-add-details">
              <div className="em-fields">
                <div className="em-field">
                  <label className="em-label" htmlFor="em-client">Client <span className="em-label-note">Required</span></label>
                  <select id="em-client" className="input" value={clientId} onChange={e => setClientId(e.target.value)} required>
                    <option value="">Choose a client…</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="em-field">
                  <label className="em-label" htmlFor="em-title">Email title <span className="em-label-note">Required</span></label>
                  <input id="em-title" className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="November newsletter" required />
                </div>
              </div>
              <div className="em-field">
                <label className="em-label" htmlFor="em-subject">Subject line</label>
                <input id="em-subject" className="input" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Don’t miss these deals" />
              </div>
              <div className="em-field">
                <label className="em-label" htmlFor="em-goal">Goal or strategy</label>
                <input id="em-goal" className="input" value={goal} onChange={e => setGoal(e.target.value)} placeholder="Drive holiday sales, re-engage the cold list" />
              </div>
              <div className="em-fields">
                <div className="em-field">
                  <label className="em-label" htmlFor="em-sent">Sent or scheduled for</label>
                  <input id="em-sent" className="input" type="date" value={sentAt} onChange={e => setSentAt(e.target.value)} />
                </div>
                <div className="em-field">
                  <label className="em-label" htmlFor="em-utm">UTM campaign</label>
                  <input id="em-utm" className="input em-mono" value={utmCampaign} onChange={e => setUtmCampaign(e.target.value)} placeholder="nov-newsletter-2026" />
                </div>
              </div>
              <div className="em-field">
                <p className="em-label">Send it</p>
                <PillTabs
                  block
                  label="Send it"
                  activeId={status}
                  onSelect={id => setStatus(id === 'draft' ? 'draft' : 'pending_review')}
                  items={[
                    { id: 'pending_review', label: 'For review' },
                    { id: 'draft',          label: 'As a draft' },
                  ]}
                />
                <p className="em-hint">
                  {status === 'pending_review'
                    ? 'It goes to the review queue for someone to approve or reject.'
                    : 'It stays a draft until you’re ready to send it for review.'}
                </p>
              </div>
            </form>
          )}

          {/* ── Step 2: Content (image-first) ── */}
          {step === 2 && (
            <div className="em-form">
              <PillTabs
                block
                label="How to add the email"
                activeId={contentTab}
                onSelect={id => setContentTab(id as 'image' | 'html' | 'url')}
                items={CONTENT_TABS.map(t => ({ id: t.id, label: t.label }))}
              />

              {contentTab === 'image' && (
                <div>
                  <input ref={fileRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
                  <button type="button" className="em-drop" onClick={() => fileRef.current?.click()}>
                    {imageUrl
                      ? <img src={imageUrl} alt="The email screenshot you picked" />
                      : <>
                          <UploadSimple size={26} aria-hidden />
                          <span className="em-drop-title">Choose a screenshot of the email</span>
                          <span className="em-drop-text">JPG, PNG or GIF</span>
                        </>}
                  </button>
                  {imageUrl && (
                    <div style={{ marginTop: 10 }}>
                      <button type="button" className="em-linkbtn em-linkbtn--danger" onClick={() => { setImageUrl(null); setImageFile(null) }}>
                        Remove image
                      </button>
                    </div>
                  )}
                </div>
              )}

              {contentTab === 'html' && (
                <div className="em-field">
                  <label className="em-label" htmlFor="em-html">Email HTML</label>
                  <textarea
                    id="em-html"
                    className="input em-mono"
                    value={htmlContent}
                    onChange={e => setHtmlContent(e.target.value)}
                    rows={10}
                    placeholder="<!DOCTYPE html>…"
                    style={{ resize: 'vertical' }}
                  />
                  {htmlContent && (
                    <details className="em-details" style={{ marginTop: 10 }}>
                      <summary>Preview the HTML</summary>
                      <iframe srcDoc={htmlContent} sandbox="" className="em-frame" style={{ height: 300, marginTop: 8 }} title="Email HTML preview" />
                    </details>
                  )}
                </div>
              )}

              {contentTab === 'url' && (
                <div className="em-field">
                  <label className="em-label" htmlFor="em-preview-url">External preview link</label>
                  <input
                    id="em-preview-url"
                    className="input"
                    type="url"
                    value={previewUrl}
                    onChange={e => setPreviewUrl(e.target.value)}
                    placeholder="https://litmus.com/previews/…"
                  />
                  <p className="em-hint">A Litmus, Email on Acid or other preview page.</p>
                </div>
              )}

              <p className="em-hint" style={{ margin: 0 }}>Optional: you can add the email without a preview and attach one later.</p>
            </div>
          )}

          {error && <div className="ui-notice ui-notice--danger" role="alert" style={{ marginTop: 14, marginBottom: 0 }}>{error}</div>}
    </Dialog>
  )
}

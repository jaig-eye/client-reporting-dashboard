'use client'

// Profile editing form for regular admin users.
// Supports: display name, email, avatar upload, password change. Each section reports its own
// result next to its own button.

import { useState } from 'react'
import { CheckCircle, UploadSimple } from '@phosphor-icons/react'
import Section from '@/components/ui/Section'
import Field from '@/components/ui/Field'
import Avatar from '@/components/ui/Avatar'

interface Props {
  userId:           string
  initialName:      string
  initialEmail:     string
  initialAvatarUrl: string
}

type Status = { state: 'idle' | 'saving' | 'saved' } | { state: 'error'; message: string }

function Result({ status, saved }: { status: Status; saved: string }) {
  if (status.state === 'saved') return <span className="ui-saved" role="status"><CheckCircle size={16} weight="fill" aria-hidden />{saved}</span>
  if (status.state === 'error') return <div className="ui-notice ui-notice--danger" role="alert" style={{ margin: 0, flexBasis: '100%' }}>{status.message}</div>
  return null
}

export default function ProfileForm({ initialName, initialEmail, initialAvatarUrl }: Props) {
  const [name,      setName]      = useState(initialName)
  const [email,     setEmail]     = useState(initialEmail)
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw,     setNewPw]     = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [profile,   setProfile]   = useState<Status>({ state: 'idle' })
  const [password,  setPassword]  = useState<Status>({ state: 'idle' })
  const [uploading, setUploading] = useState(false)

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('folder', 'avatars')
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const data = await res.json()
      if (data.url) { setAvatarUrl(data.url); setProfile({ state: 'idle' }) }
      else throw new Error(data.error || 'Upload failed')
    } catch (err) {
      setProfile({ state: 'error', message: `The photo didn’t upload${err instanceof Error ? `: ${err.message}` : '.'}` })
    } finally {
      setUploading(false)
    }
  }

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault()
    setProfile({ state: 'saving' })
    try {
      const res = await fetch('/api/admin/users/me', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, email, avatar_url: avatarUrl }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Your profile wasn’t saved. Try again.')
      }
      setProfile({ state: 'saved' })
    } catch (err) {
      setProfile({ state: 'error', message: err instanceof Error ? err.message : 'Your profile wasn’t saved. Try again.' })
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault()
    if (newPw !== confirmPw) { setPassword({ state: 'error', message: 'The two new passwords don’t match.' }); return }
    if (newPw.length < 10)   { setPassword({ state: 'error', message: 'The new password needs at least 10 characters.' }); return }
    setPassword({ state: 'saving' })
    try {
      const res = await fetch('/api/admin/users/me/password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ current_password: currentPw, new_password: newPw }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Your password wasn’t changed. Try again.')
      }
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
      setPassword({ state: 'saved' })
    } catch (err) {
      setPassword({ state: 'error', message: err instanceof Error ? err.message : 'Your password wasn’t changed. Try again.' })
    }
  }

  return (
    <>
      <form onSubmit={handleProfileSave}>
        <Section title="Profile" description="How you appear to your team in the admin.">
          <div className="ui-fields">
            <Field label="Photo" hint="JPG, PNG or WebP, up to 4 MB. It’s saved when you save your profile.">
              <div className="us-photo">
                <Avatar name={name || '?'} url={avatarUrl} size={56} />
                <label className="btn btn-secondary btn-sm" style={{ cursor: uploading ? 'default' : 'pointer' }}>
                  <UploadSimple size={14} aria-hidden />
                  {uploading ? 'Uploading…' : avatarUrl ? 'Replace photo' : 'Upload photo'}
                  <input type="file" accept="image/*" className="sr-only" onChange={handleAvatarUpload} disabled={uploading} />
                </label>
                {avatarUrl && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAvatarUrl('')}>Remove</button>}
              </div>
            </Field>
            <Field label="Name" id="me-name">
              <input id="me-name" className="input" placeholder="Your name" autoComplete="name"
                value={name} onChange={e => { setName(e.target.value); setProfile({ state: 'idle' }) }} />
            </Field>
            <Field label="Email" id="me-email">
              <input id="me-email" className="input" type="email" placeholder="you@agency.com" autoComplete="email"
                value={email} onChange={e => { setEmail(e.target.value); setProfile({ state: 'idle' }) }} />
            </Field>
            <div className="us-actions">
              <Result status={profile} saved="Profile saved" />
              <button type="submit" className="btn btn-primary" disabled={profile.state === 'saving' || uploading}>
                {profile.state === 'saving' ? 'Saving…' : 'Save profile'}
              </button>
            </div>
          </div>
        </Section>
      </form>

      <form onSubmit={handlePasswordChange}>
        <Section title="Password" description="At least 10 characters.">
          <div className="ui-fields">
            <Field label="Current password" id="me-pw-current">
              <input id="me-pw-current" className="input" type="password" required autoComplete="current-password"
                value={currentPw} onChange={e => setCurrentPw(e.target.value)} />
            </Field>
            <div className="ui-grid-2">
              <Field label="New password" id="me-pw-new">
                <input id="me-pw-new" className="input" type="password" required minLength={10} autoComplete="new-password"
                  value={newPw} onChange={e => setNewPw(e.target.value)} />
              </Field>
              <Field label="New password again" id="me-pw-confirm">
                <input id="me-pw-confirm" className="input" type="password" required minLength={10} autoComplete="new-password"
                  value={confirmPw} onChange={e => setConfirmPw(e.target.value)} />
              </Field>
            </div>
            <div className="us-actions">
              <Result status={password} saved="Password changed" />
              <button type="submit" className="btn btn-primary" disabled={password.state === 'saving'}>
                {password.state === 'saving' ? 'Changing…' : 'Change password'}
              </button>
            </div>
          </div>
        </Section>
      </form>

    </>
  )
}

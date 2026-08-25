'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ClientTemperature } from '@/lib/types'

const TEMPERATURES: { key: ClientTemperature; label: string; color: string; hint: string }[] = [
  { key: 'low',    label: 'Low',    color: '#22c55e', hint: 'Ticking along, light touch' },
  { key: 'medium', label: 'Medium', color: '#f59e0b', hint: 'Needs regular attention' },
  { key: 'high',   label: 'High',   color: '#ef4444', hint: 'Hands-on this week' },
]

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ClientRelationshipCard({
  clientId,
  temperature: initialTemp,
  lastContactedAt: initialContact,
  contactStaleDays: initialOverride,
  agencyStaleDays,
}: {
  clientId:         string
  temperature:      ClientTemperature | null
  lastContactedAt:  string | null
  contactStaleDays: number | null
  agencyStaleDays:  number
}) {
  const router = useRouter()

  const [temp,     setTemp]     = useState<ClientTemperature | null>(initialTemp)
  const [contact,  setContact]  = useState<string | null>(initialContact)
  const [override, setOverride] = useState<string>(initialOverride?.toString() ?? '')
  const [saving,   setSaving]   = useState(false)
  const [editingDate, setEditingDate] = useState(false)

  const threshold = initialOverride ?? agencyStaleDays
  const elapsed   = contact ? daysSince(contact) : null
  const isStale   = elapsed === null || elapsed >= threshold

  async function patch(body: Record<string, unknown>, rollback: () => void) {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Save failed')
      router.refresh()
    } catch {
      rollback()
    } finally {
      setSaving(false)
    }
  }

  function setTemperature(next: ClientTemperature | null) {
    const prev = temp
    setTemp(next)
    // Clearing the alert marker re-arms the staleness cron for this client.
    void patch({ temperature: next }, () => setTemp(prev))
  }

  function logContactNow() {
    const prev = contact
    const iso  = new Date().toISOString()
    setContact(iso)
    void patch({ last_contacted_at: iso }, () => setContact(prev))
  }

  function setContactDate(dateStr: string) {
    if (!dateStr) return
    const prev = contact
    // Noon UTC keeps the date stable either side of a timezone boundary.
    const iso = new Date(`${dateStr}T12:00:00Z`).toISOString()
    setContact(iso)
    setEditingDate(false)
    void patch({ last_contacted_at: iso }, () => setContact(prev))
  }

  function saveOverride(raw: string) {
    const trimmed = raw.trim()
    const value   = trimmed === '' ? null : Number(trimmed)
    if (value !== null && (!Number.isFinite(value) || value < 1 || value > 365)) return
    const prev = override
    setOverride(trimmed)
    void patch({ contact_stale_days: value }, () => setOverride(prev))
  }

  return (
    <div className="card p-5">
      <h2 className="section-title mb-1">Relationship</h2>
      <p className="section-desc mb-3">Attention level and when we last spoke.</p>

      {/* Temperature ------------------------------------------------------- */}
      <p style={{ fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--text-faint)', margin: '0 0 5px' }}>
        Attention needed
      </p>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        {TEMPERATURES.map(t => {
          const on = temp === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTemperature(on ? null : t.key)}
              disabled={saving}
              title={t.hint}
              style={{
                flex: 1, padding: '0.35rem 0.25rem', borderRadius: 6, cursor: 'pointer',
                fontSize: '0.75rem', fontWeight: 600,
                background: on ? t.color : `${t.color}12`,
                color:      on ? '#fff' : t.color,
                border: `1px solid ${on ? t.color : `${t.color}40`}`,
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      <p style={{ fontSize: '0.66rem', color: 'var(--text-faint)', margin: '0 0 1rem', minHeight: '1em' }}>
        {temp ? TEMPERATURES.find(t => t.key === temp)?.hint : 'Not triaged - click to set'}
      </p>

      {/* Last contacted ---------------------------------------------------- */}
      <p style={{ fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--text-faint)', margin: '0 0 5px' }}>
        Last contacted
      </p>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
        padding: '0.5rem 0.625rem', borderRadius: 6,
        background: isStale ? 'rgba(239,68,68,0.08)' : 'var(--bg-subtle)',
        border: `1px solid ${isStale ? 'rgba(239,68,68,0.28)' : 'var(--border)'}`,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {contact ? (
            <>
              <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 600, color: isStale ? '#ef4444' : 'var(--text-primary)' }}>
                {elapsed === 0 ? 'Today' : `${elapsed} day${elapsed === 1 ? '' : 's'} ago`}
              </p>
              <p style={{ margin: 0, fontSize: '0.66rem', color: 'var(--text-faint)' }}>
                {formatDate(contact)}
                {isStale && ` - past the ${threshold}-day mark`}
              </p>
            </>
          ) : (
            <>
              <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 600, color: '#ef4444' }}>Never logged</p>
              <p style={{ margin: 0, fontSize: '0.66rem', color: 'var(--text-faint)' }}>
                Log a Contact note, or set the date directly
              </p>
            </>
          )}
        </div>
        <button
          onClick={logContactNow}
          disabled={saving}
          className="btn btn-secondary"
          style={{ padding: '0.22rem 0.55rem', fontSize: '0.72rem', whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          Mark today
        </button>
      </div>

      {editingDate ? (
        <input
          type="date"
          autoFocus
          defaultValue={contact ? new Date(contact).toISOString().slice(0, 10) : ''}
          onBlur={e => { if (e.target.value) setContactDate(e.target.value); else setEditingDate(false) }}
          onChange={e => e.target.value && setContactDate(e.target.value)}
          className="input w-full"
          style={{ fontSize: '0.75rem', marginBottom: 6 }}
        />
      ) : (
        <button
          onClick={() => setEditingDate(true)}
          style={{
            background: 'none', border: 'none', padding: 0, marginBottom: 8,
            fontSize: '0.68rem', color: 'var(--blue)', cursor: 'pointer', textAlign: 'left',
          }}
        >
          Set a different date
        </button>
      )}

      {/* Per-client staleness override ------------------------------------- */}
      <label style={{ display: 'block' }}>
        <span style={{ fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
          Alert after
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <input
            type="number"
            min={1}
            max={365}
            value={override}
            placeholder={`Global: ${agencyStaleDays}`}
            onChange={e => setOverride(e.target.value)}
            onBlur={e => saveOverride(e.target.value)}
            disabled={saving}
            className="input"
            style={{ fontSize: '0.75rem', width: 110 }}
          />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>days without contact</span>
          {override !== '' && (
            <button
              onClick={() => saveOverride('')}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', padding: 0, fontSize: '0.66rem', color: 'var(--blue)', cursor: 'pointer' }}
            >
              Reset to global
            </button>
          )}
        </div>
      </label>
      <p style={{ fontSize: '0.63rem', color: 'var(--text-faint)', margin: '5px 0 0' }}>
        Leave blank to follow the agency default ({agencyStaleDays} days).
      </p>
    </div>
  )
}

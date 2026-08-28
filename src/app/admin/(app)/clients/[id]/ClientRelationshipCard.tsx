'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { ClientTemperature } from '@/lib/types'

const TEMPERATURES: { key: ClientTemperature; label: string; color: string; hint: string }[] = [
  { key: 'low',    label: 'Low',    color: '#22c55e', hint: 'Ticking along, light touch' },
  { key: 'medium', label: 'Medium', color: '#f59e0b', hint: 'Needs regular attention' },
  { key: 'high',   label: 'High',   color: '#ef4444', hint: 'Hands-on this week' },
]

function daysSince(iso: string): number {
  // Floored at 0. Contact dates are stamped at noon UTC, so a row written before
  // the clamp existed can sit slightly in the future for anyone west of UTC, and
  // Math.floor on a small negative difference renders "-1 days ago".
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * The date input's value in the same calendar terms formatDate displays.
 *
 * toISOString().slice(0,10) is the UTC date, while the card above renders the
 * local one — so for a noon-UTC stamp the field pre-filled a DIFFERENT day than
 * the label, and because it commits on blur, merely focusing and tabbing out
 * silently moved the contact date.
 */
function dateInputValue(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
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

  // Optimistic OVERLAY, not a mirror of the props.
  //
  // useState initialisers run once, so plain mirrors never picked up new props —
  // and this component's own patch() calls router.refresh(), which re-renders the
  // mounted component rather than remounting it. Logging a Contact note elsewhere
  // on the page stamps clients.last_contacted_at, the fresh prop arrives, and the
  // card kept showing "Never logged" until a hard reload. Worse, `threshold` was
  // read from the PROP while the input rendered the STATE, so editing "Alert
  // after" computed the red banner against the previous value.
  //
  // Holding only the in-flight value and clearing it when the server value
  // catches up gives instant feedback AND convergence.
  const [pendingTemp,     setPendingTemp]     = useState<{ value: ClientTemperature | null } | null>(null)
  const [pendingContact,  setPendingContact]  = useState<string | null>(null)
  const [pendingOverride, setPendingOverride] = useState<string | null>(null)
  const [saving,   setSaving]   = useState(false)
  const [editingDate, setEditingDate] = useState(false)

  const temp     = pendingTemp ? pendingTemp.value : initialTemp
  const contact  = pendingContact ?? initialContact
  const override = pendingOverride ?? (initialOverride?.toString() ?? '')

  // Once the server agrees with what we optimistically showed, drop the overlay
  // so later external changes flow through.
  useEffect(() => { setPendingTemp(null) },     [initialTemp])
  useEffect(() => { setPendingContact(null) },  [initialContact])
  useEffect(() => { setPendingOverride(null) }, [initialOverride])

  const overrideNum = override.trim() === '' ? null : Number(override)
  const threshold   = overrideNum !== null && Number.isFinite(overrideNum) ? overrideNum : agencyStaleDays
  const elapsed     = contact ? daysSince(contact) : null
  const isStale     = elapsed === null || elapsed >= threshold

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
    setPendingTemp({ value: next })
    // Clearing the alert marker re-arms the staleness cron for this client.
    void patch({ temperature: next }, () => setPendingTemp(null))
  }

  function logContactNow() {
    const iso = new Date().toISOString()
    setPendingContact(iso)
    void patch({ last_contacted_at: iso }, () => setPendingContact(null))
  }

  function setContactDate(dateStr: string) {
    if (!dateStr) return
    // Noon UTC keeps the date stable either side of a timezone boundary, but it
    // can land in the FUTURE for anyone west of UTC picking today's date before
    // noon — which rendered "-1 days ago" and, server-side, dropped the client
    // out of the staleness digest. Never stamp ahead of now.
    const picked = new Date(`${dateStr}T12:00:00Z`)
    const now    = new Date()
    const iso    = (picked > now ? now : picked).toISOString()
    setPendingContact(iso)
    setEditingDate(false)
    void patch({ last_contacted_at: iso }, () => setPendingContact(null))
  }

  function saveOverride(raw: string) {
    const trimmed = raw.trim()
    const value   = trimmed === '' ? null : Number(trimmed)
    if (value !== null && (!Number.isFinite(value) || value < 1 || value > 365)) return
    setPendingOverride(trimmed)
    void patch({ contact_stale_days: value }, () => setPendingOverride(null))
  }

  return (
    <div className="card p-5">
      <h2 className="section-title mb-1">
        Relationship
        <span style={{
          fontSize: '0.5rem', fontWeight: 700, letterSpacing: '0.05em',
          background: 'var(--blue)', color: '#fff',
          padding: '1px 4px', borderRadius: 3,
          marginLeft: 5, verticalAlign: 'middle', lineHeight: 1.4,
        }}>BETA</span>
      </h2>
      <p className="section-desc mb-3">Attention level and when we last spoke.</p>

      {/* Temperature ------------------------------------------------------- */}
      {/* Marked BETA and rendered in neutral tones until a level is chosen.
          The control is fully functional, but today it only labels the client
          and orders the weekly check-in digest — it does not yet change what is
          monitored or when anything alerts. Colouring the unselected options
          would promise more than it currently does. */}
      {/* The BETA pill lives on the card heading now, so it is not repeated here. */}
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
                // Colour only on the chosen level, so the card still reads at a
                // glance without the whole row implying active monitoring.
                background: on ? t.color : 'var(--bg-subtle)',
                color:      on ? '#fff'  : 'var(--text-muted)',
                border: `1px solid ${on ? t.color : 'var(--border)'}`,
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      <p style={{ fontSize: '0.66rem', color: 'var(--text-faint)', margin: '0 0 0.35rem', minHeight: '1em' }}>
        {temp ? TEMPERATURES.find(t => t.key === temp)?.hint : 'Not triaged - click to set'}
      </p>
      <p style={{ fontSize: '0.63rem', color: 'var(--text-faint)', margin: '0 0 1rem', lineHeight: 1.5 }}>
        For now this is a label: it flags the client here and puts high-attention
        accounts at the top of the weekly check-in digest. It does not change what
        gets monitored or when anything alerts — that comes in a later update.
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
        // Commit on blur / Enter only. A per-keystroke onChange fires while the
        // year is still being typed ("0002-.."), saving a nonsense date and
        // unmounting the field after the first digit.
        <input
          type="date"
          autoFocus
          defaultValue={contact ? dateInputValue(contact) : ''}
          onBlur={e => { if (e.target.value) setContactDate(e.target.value); else setEditingDate(false) }}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
            if (e.key === 'Escape') { e.preventDefault(); setEditingDate(false) }
          }}
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
            // Typing updates the overlay so the field stays editable; only blur
            // commits. The threshold above is derived from the same value, so the
            // "past the N-day mark" banner tracks what is on screen.
            onChange={e => setPendingOverride(e.target.value)}
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

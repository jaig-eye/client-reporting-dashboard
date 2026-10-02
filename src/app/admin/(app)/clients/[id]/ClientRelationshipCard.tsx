'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Section from '@/components/ui/Section'
import StatusBadge from '@/components/ui/StatusBadge'
import type { ClientTemperature } from '@/lib/types'

// Colour comes from the stylesheet (data-level), only on the chosen level.
const TEMPERATURES: { key: ClientTemperature; label: string; hint: string }[] = [
  { key: 'low',    label: 'Low',    hint: 'Ticking along, light touch' },
  { key: 'medium', label: 'Medium', hint: 'Needs regular attention' },
  { key: 'high',   label: 'High',   hint: 'Hands-on this week' },
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

  const level = temp ? TEMPERATURES.find(t => t.key === temp) : null

  return (
    <Section
      title={<span className="co-title">Relationship <StatusBadge tone="info" dot={false}>Beta</StatusBadge></span>}
      description="How much attention the client needs, and when we last spoke."
    >
      {/* Temperature ------------------------------------------------------- */}
      {/* Marked Beta and rendered in neutral tones until a level is chosen.
          The control is fully functional, but today it only labels the client
          and orders the weekly check-in digest — it does not yet change what is
          monitored or when anything alerts. Colouring the unselected options
          would promise more than it currently does. */}
      <div className="co-block">
        <p className="co-label" id={`attention-${clientId}`}>Attention needed</p>
        <div className="co-levels" role="group" aria-labelledby={`attention-${clientId}`}>
          {TEMPERATURES.map(t => {
            const on = temp === t.key
            return (
              <button
                key={t.key}
                type="button"
                className="co-level"
                data-level={t.key}
                aria-pressed={on}
                onClick={() => setTemperature(on ? null : t.key)}
                disabled={saving}
                title={on ? `${t.hint}. Click again to clear.` : t.hint}
              >
                {t.label}
              </button>
            )
          })}
        </div>
        <p className="co-level-hint">{level ? level.hint : 'Not set yet. Pick a level.'}</p>
        <p className="co-hint">
          Sorts high-attention clients to the top of the weekly check-in digest. Monitoring and alerts
          stay the same.
        </p>
      </div>

      {/* Last contacted ---------------------------------------------------- */}
      <div className="co-block">
        <p className="co-label">Last contacted</p>
        <div className={`co-contact${isStale ? ' co-contact--stale' : ''}`}>
          <div className="co-contact-text">
            {contact ? (
              <>
                <span className="co-contact-main">
                  {elapsed === 0 ? 'Today' : `${elapsed} day${elapsed === 1 ? '' : 's'} ago`}
                </span>
                <span className="co-contact-sub">
                  {formatDate(contact)}
                  {isStale && `, past the ${threshold}-day mark`}
                </span>
              </>
            ) : (
              <>
                <span className="co-contact-main">Never logged</span>
                <span className="co-contact-sub">Log a contact note, or set the date here</span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={logContactNow}
            disabled={saving}
            className="btn btn-secondary btn-sm"
            style={{ flexShrink: 0 }}
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
            aria-label="Last contacted date"
            defaultValue={contact ? dateInputValue(contact) : ''}
            onBlur={e => { if (e.target.value) setContactDate(e.target.value); else setEditingDate(false) }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
              if (e.key === 'Escape') { e.preventDefault(); setEditingDate(false) }
            }}
            className="input co-contact-date"
          />
        ) : (
          <div className="co-contact-more">
            <button type="button" className="co-linkbtn" onClick={() => setEditingDate(true)}>
              Set a different date
            </button>
          </div>
        )}
      </div>

      {/* Per-client staleness override ------------------------------------- */}
      <div className="co-block">
        <label className="co-label" htmlFor={`stale-${clientId}`}>Alert after</label>
        <div className="co-threshold">
          <input
            id={`stale-${clientId}`}
            type="number"
            min={1}
            max={365}
            value={override}
            placeholder={`Default: ${agencyStaleDays}`}
            // Typing updates the overlay so the field stays editable; only blur
            // commits. The threshold above is derived from the same value, so the
            // "past the N-day mark" banner tracks what is on screen.
            onChange={e => setPendingOverride(e.target.value)}
            onBlur={e => saveOverride(e.target.value)}
            disabled={saving}
            className="input"
          />
          <span className="co-threshold-unit">days without contact</span>
          {override !== '' && (
            // Not disabled while saving: clicking it blurs the field first, which starts a save,
            // and a disabled button would then swallow the click.
            <button type="button" className="co-linkbtn" onClick={() => saveOverride('')}>
              Use agency default
            </button>
          )}
        </div>
        <p className="co-hint">Leave blank to follow the agency default ({agencyStaleDays} days).</p>
      </div>
    </Section>
  )
}

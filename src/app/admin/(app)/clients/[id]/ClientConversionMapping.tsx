'use client'

import { useState } from 'react'
import SaveStatus, { useSaveStatus, requestJson } from '@/components/ui/SaveStatus'

interface Props {
  clientId:           string
  leadAction:         string | null    // client override (null = use agency default)
  purchaseAction:     string | null    // client override
  agencyLeadAction:   string           // agency default
  agencyPurchaseAction: string         // agency default
  discoveredActions:  string[]         // all action types seen in this client's Meta data
}

export default function ClientConversionMapping({
  clientId,
  leadAction:         initialLead,
  purchaseAction:     initialPurchase,
  agencyLeadAction,
  agencyPurchaseAction,
  discoveredActions,
}: Props) {
  const [lead,     setLead]     = useState(initialLead     ?? '')
  const [purchase, setPurchase] = useState(initialPurchase ?? '')
  // Last values the server accepted; the form is dirty when it differs.
  const [baseline, setBaseline] = useState({ lead: initialLead ?? '', purchase: initialPurchase ?? '' })
  const status = useSaveStatus()

  const dirty = lead !== baseline.lead || purchase !== baseline.purchase

  function handleSave() {
    const next = { lead, purchase }
    void status.run(async () => {
      await requestJson(`/api/admin/clients/${clientId}`, {
        method: 'PATCH',
        json: {
          lead_action:     next.lead     || null,
          purchase_action: next.purchase || null,
        },
      })
      setBaseline(next)
    })
  }

  // Combine discovered actions with any existing values so nothing disappears
  const allOptions = Array.from(new Set([
    agencyLeadAction,
    agencyPurchaseAction,
    ...discoveredActions,
    ...(lead     ? [lead]     : []),
    ...(purchase ? [purchase] : []),
  ])).sort()

  return (
    <div className="space-y-4">
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        These mappings control which Meta action type counts as a conversion for this client.
        Leave blank to use the agency default.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Lead Gen mapping */}
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>
            Lead Gen conversion action
          </label>
          <select
            value={lead}
            onChange={e => setLead(e.target.value)}
            className="input w-full"
            style={{ fontSize: '0.8rem' }}
          >
            <option value="">Agency default ({agencyLeadAction})</option>
            {allOptions.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
            Used for campaigns with Lead Gen display mode
          </p>
        </div>

        {/* Ecom mapping */}
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>
            Ecommerce purchase action
          </label>
          <select
            value={purchase}
            onChange={e => setPurchase(e.target.value)}
            className="input w-full"
            style={{ fontSize: '0.8rem' }}
          >
            <option value="">Agency default ({agencyPurchaseAction})</option>
            {allOptions.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
            Used for campaigns with Ecommerce display mode
          </p>
        </div>
      </div>

      {discoveredActions.length === 0 && (
        <p className="text-xs py-2 px-3 rounded" style={{
          background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)',
          color: 'var(--text-faint)',
        }}>
          No Meta action types discovered yet — run a sync to populate the action type list.
        </p>
      )}

      <div className="form-actions">
        <button
          onClick={handleSave}
          disabled={!dirty || status.saving}
          className="btn btn-primary"
          style={{ fontSize: '0.8rem', padding: '0.375rem 0.75rem' }}
        >
          Save changes
        </button>
        <SaveStatus state={status.state} error={status.error} retry={status.retry} dirty={dirty} />
      </div>
    </div>
  )
}

'use client'

// An integration configured in a dialog (API keys, IDs): Ahrefs, DataForSEO, SerpApi, Discord,
// Stripe at agency level; WordPress, HighLevel, BigCommerce, Discord, Stripe, Local Dominator per
// client. Drawn as the shared IntegrationRow so every integration looks the same; the button opens
// the dialog (IntegrationModal).

import { useEffect, useState } from 'react'
import IntegrationRow from './integrations/IntegrationRow'

interface IntegrationCardProps {
  /** Legacy icon (emoji or element). Ignored when `brand` is set. */
  icon?:           React.ReactNode
  /** Connector type / service key: the real logo. */
  brand?:          string
  name:            string
  description:     string
  isConnected:     boolean
  connectedLabel?: string          // e.g. "ch: 123456789..." or "cus_xxx..."
  onConfigure:     () => void
  justConnected?:  boolean         // parent sets true after save → the badge pops
}

export default function IntegrationCard({
  icon, brand, name, description, isConnected, connectedLabel, onConfigure, justConnected,
}: IntegrationCardProps) {
  const [pop, setPop] = useState(false)
  useEffect(() => {
    if (!justConnected) return
    setPop(true)
    const t = setTimeout(() => setPop(false), 1600)
    return () => clearTimeout(t)
  }, [justConnected])

  return (
    <IntegrationRow
      brand={brand}
      logo={brand ? undefined : <span className="ui-tile ui-tile--lg" aria-hidden>{icon}</span>}
      name={name}
      status={isConnected ? { tone: 'success', label: 'Connected', live: pop } : { tone: 'neutral', label: 'Not connected' }}
      description={description}
      meta={isConnected && connectedLabel ? <code className="int-code">{connectedLabel}</code> : undefined}
      actions={
        <button type="button" onClick={onConfigure} className={`btn btn-sm ${isConnected ? 'btn-secondary' : 'btn-primary'}`}>
          {isConnected ? 'Manage' : 'Connect'}
        </button>
      }
    />
  )
}

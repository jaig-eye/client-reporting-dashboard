// ─────────────────────────────────────────────────────────────────────────────
// Connector Registry
//
// Maps each ConnectorType to its adapter (runtime) and definition (UI metadata).
//
// To add a new data source:
//   1. Add the type to ConnectorType in types.ts
//   2. Add a DB check constraint in the connectors migration
//   3. Create a new connector file in this directory (implement ConnectorAdapter)
//   4. Register it here
//
// The rest of the system (sync engine, admin UI, client dashboard) picks up
// new connectors automatically through this registry.
// ─────────────────────────────────────────────────────────────────────────────

import type { ConnectorType, ConnectorTypeDef } from '../types'
import type { ConnectorRegistryEntry, ConnectorAdapter } from './types'
import { googleAdsConnector } from './google-ads'
import { metaAdsConnector } from './meta-ads'

// ─────────────────────────────────────────────────────────────────────────────
// UI DEFINITIONS
// Displayed in the Data Connections section and client connection cards.
// ─────────────────────────────────────────────────────────────────────────────

const CONNECTOR_DEFINITIONS: Record<ConnectorType, ConnectorTypeDef> = {
  google_ads: {
    type: 'google_ads',
    label: 'Google Ads',
    description: 'Connect your Google Ads MCC to sync campaign performance data.',
    icon: 'G',
    color: '#4285F4',
    authFlow: 'oauth',
  },
  meta_ads: {
    type: 'meta_ads',
    label: 'Meta Ads',
    description: 'Connect via Meta System User token or OAuth for campaign data.',
    icon: 'f',
    color: '#1877F2',
    authFlow: 'token',
  },
  google_analytics: {
    type: 'google_analytics',
    label: 'Google Analytics',
    description: 'Connect a GA4 property to sync traffic and conversion data.',
    icon: 'A',
    color: '#E37400',
    authFlow: 'oauth',
  },
  google_search_console: {
    type: 'google_search_console',
    label: 'Search Console',
    description: 'Connect Google Search Console for organic search performance.',
    icon: 'S',
    color: '#34A853',
    authFlow: 'oauth',
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTERS
// Only implemented connectors have a runtime adapter.
// Connectors without adapters are displayed as "coming soon" in the UI.
// ─────────────────────────────────────────────────────────────────────────────

const CONNECTOR_ADAPTERS: Partial<Record<ConnectorType, ConnectorAdapter>> = {
  google_ads: googleAdsConnector,
  meta_ads:   metaAdsConnector,
  // google_analytics:       not yet implemented
  // google_search_console:  not yet implemented
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/** All connector type definitions, in display order. */
export const ALL_CONNECTOR_TYPES: ConnectorType[] = [
  'google_ads',
  'meta_ads',
  'google_analytics',
  'google_search_console',
]

/** Returns the UI definition for a connector type. */
export function getConnectorDef(type: ConnectorType): ConnectorTypeDef {
  return CONNECTOR_DEFINITIONS[type]
}

/** Returns the runtime adapter for a connector type, or null if not yet implemented. */
export function getConnectorAdapter(type: ConnectorType): ConnectorAdapter | null {
  return CONNECTOR_ADAPTERS[type] ?? null
}

/** Returns true if a connector type has a fully implemented adapter. */
export function isConnectorImplemented(type: ConnectorType): boolean {
  return type in CONNECTOR_ADAPTERS
}

/** Returns the full registry entry (definition + adapter) for a connector type. */
export function getConnectorEntry(type: ConnectorType): ConnectorRegistryEntry | null {
  const definition = CONNECTOR_DEFINITIONS[type]
  const adapter = CONNECTOR_ADAPTERS[type]
  if (!adapter) return null
  return { definition, adapter }
}

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
import { googleAnalyticsConnector } from './google-analytics'
import { googleSearchConsoleConnector } from './google-search-console'
import { googleBusinessProfileConnector } from './google-business-profile'
import { ghlConnector } from './ghl'
import { wordpressConnector } from './wordpress'
import { ahrefsConnector } from './ahrefs'
import { GoogleAdsLogo, MetaAdsLogo, GALogo, GSCLogo, GhlLogo, WpLogo } from '@/components/ConnectorLogo'

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
    logo: GoogleAdsLogo,
    color: '#4285F4',
    authFlow: 'oauth',
  },
  meta_ads: {
    type: 'meta_ads',
    label: 'Meta Ads',
    description: 'Connect via Meta System User token or OAuth for campaign data.',
    icon: 'f',
    logo: MetaAdsLogo,
    color: '#0081FB',
    authFlow: 'token',
  },
  google_analytics: {
    type: 'google_analytics',
    label: 'Google Analytics',
    description: 'Connect a GA4 property to sync traffic and conversion data.',
    icon: 'A',
    logo: GALogo,
    color: '#E37400',
    authFlow: 'oauth',
  },
  google_search_console: {
    type: 'google_search_console',
    label: 'Search Console',
    description: 'Connect Google Search Console for organic search performance.',
    icon: 'S',
    logo: GSCLogo,
    color: '#34A853',
    authFlow: 'oauth',
  },
  google_business_profile: {
    type: 'google_business_profile',
    label: 'Google Business Profile',
    description: 'Connect Google Business Profile to track views, calls, and reviews.',
    icon: 'B',
    logo: GALogo,   // reuse GA logo as placeholder until a GBP logo component is added
    color: '#0F9D58',
    authFlow: 'oauth',
  },
  ghl: {
    type: 'ghl',
    label: 'GoHighLevel',
    description: 'Connect your GHL CRM for contacts, calls, forms, and reviews.',
    icon: 'G',
    logo: GhlLogo,
    color: '#FF6B35',
    authFlow: 'credentials',
  },
  wordpress: {
    type: 'wordpress',
    label: 'WordPress',
    description: 'Connect a WordPress site to publish content and manage posts.',
    icon: 'W',
    logo: WpLogo,
    color: '#21759B',
    authFlow: 'credentials',
  },
  ahrefs: {
    type: 'ahrefs',
    label: 'Ahrefs',
    description: 'Connect Ahrefs to track Domain Rating, backlinks, and organic traffic.',
    icon: 'A',
    color: '#f59e0b',
    authFlow: 'token',
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTERS
// Only implemented connectors have a runtime adapter.
// Connectors without adapters are displayed as "coming soon" in the UI.
// ─────────────────────────────────────────────────────────────────────────────

const CONNECTOR_ADAPTERS: Partial<Record<ConnectorType, ConnectorAdapter>> = {
  google_ads:              googleAdsConnector,
  meta_ads:                metaAdsConnector,
  google_analytics:        googleAnalyticsConnector,
  google_search_console:   googleSearchConsoleConnector,
  google_business_profile: googleBusinessProfileConnector,
  ghl:                     ghlConnector,
  wordpress:               wordpressConnector,
  ahrefs:                  ahrefsConnector,
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
  'google_business_profile',
  'ghl',
  'wordpress',
  'ahrefs',
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

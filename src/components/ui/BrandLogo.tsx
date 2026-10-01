// The real logo for every service the admin connects to — one component for connector cards,
// client rows, menus and the usage page, so a service never looks different in two places.
//
// Sources, in order: official icon files in public/brand (Google's own product icons, each vendor's
// site icon), Simple Icons glyphs in the brand's colour (CC0), and the hand-drawn SVGs in
// ConnectorLogo. Anything unknown gets its initial on a tile rather than a broken image.

import { ConnectorLogo } from '@/components/ConnectorLogo'
import { BRAND_GLYPHS } from './brandGlyphs'
import Tile from './Tile'

/** Official icon files in public/brand, by connector type or service key. */
const ASSETS: Record<string, string> = {}

/** Service keys that use a Simple Icons glyph. */
const GLYPH_FOR: Record<string, keyof typeof BRAND_GLYPHS> = {
  wordpress: 'wordpress', discord: 'discord', meta_ads: 'meta', meta: 'meta',
  bigcommerce: 'bigcommerce', bigcommerce_analytics: 'bigcommerce', stripe: 'stripe',
}

/** Display names, for alt text and the initial fallback. */
export const BRAND_NAMES: Record<string, string> = {
  google: 'Google', google_ads: 'Google Ads', google_analytics: 'Google Analytics',
  google_search_console: 'Search Console', google_business_profile: 'Google Business Profile',
  meta_ads: 'Meta Ads', meta: 'Meta', ghl: 'HighLevel', wordpress: 'WordPress',
  bigcommerce: 'BigCommerce', bigcommerce_analytics: 'BigCommerce Analytics',
  ahrefs: 'Ahrefs', dataforseo: 'DataForSEO', serpapi: 'SerpApi', discord: 'Discord',
  stripe: 'Stripe', local_dominator: 'Local Dominator', openai: 'OpenAI', anthropic: 'Anthropic',
}

/** A dark brand colour (BigCommerce's near-black) would vanish in dark mode; it follows the text colour instead. */
function isInk(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.18
}

export default function BrandLogo({ type, size = 18, tile, tileSize = 'md', title }: {
  type: string
  /** The mark's size in px. */
  size?: number
  /** Sit the mark on a bordered white tile. */
  tile?: boolean
  tileSize?: 'sm' | 'md' | 'lg' | 'xl'
  title?: string
}) {
  const name = title ?? BRAND_NAMES[type] ?? type
  let mark: React.ReactNode
  const asset = ASSETS[type]
  const glyph = GLYPH_FOR[type] ? BRAND_GLYPHS[GLYPH_FOR[type]] : undefined
  if (asset) {
    mark = <img src={asset} alt="" width={size} height={size} style={{ width: size, height: size, objectFit: 'contain' }} />
  } else if (glyph) {
    const ink = isInk(glyph.hex)
    mark = (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={ink ? { color: 'var(--text-primary)' } : undefined}>
        <path d={glyph.path} fill={ink ? 'currentColor' : glyph.hex} />
      </svg>
    )
  } else if (['google', 'google_ads', 'google_analytics', 'google_search_console', 'ghl'].includes(type)) {
    mark = <ConnectorLogo type={type === 'google' ? 'google_ads' : type} size={size} aria-hidden />
  } else {
    mark = <span style={{ fontSize: Math.round(size * 0.62), fontWeight: 700, color: 'var(--text-secondary)', lineHeight: 1 }}>{name.slice(0, 1).toUpperCase()}</span>
  }

  if (!tile) return <span role="img" aria-label={name} title={name} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, flexShrink: 0 }}>{mark}</span>
  return <Tile size={tileSize} tone="logo" title={name}>{mark}</Tile>
}

// ─────────────────────────────────────────────────────────────────────────────
// Website Creator — core contract (self-contained; no runtime deps).
// See KNOWLEDGE.md (conventions) and ARCHITECTURE.md (pipeline).
// ─────────────────────────────────────────────────────────────────────────────

/** Company facts — stored once in the site_settings record, referenced everywhere via
 *  Kadence dynamic fields. Keys mirror the MetaBox field IDs in wp/site-settings-cpt.php. */
export interface CompanyInfo {
  company_name:  string
  tagline?:      string
  phone:         string          // click-to-call + NAP
  email?:        string
  address_line?: string
  city?:         string
  state?:        string
  zip?:          string
  service_area?: string          // e.g. "Greater Phoenix, AZ"
  hours?:        string          // e.g. "Mon–Fri 8–6, Sat 9–2"
  license_no?:   string
  years_in_business?: number
  rating?:       number          // e.g. 4.9
  review_count?: number
  socials?:      { facebook?: string; instagram?: string; google?: string; yelp?: string }
  logo_url?:     string
  primary_color?: string         // brand seed for palette derivation
}

/** Intake — the minimum an operator provides. Drives structure + fills CompanyInfo. */
export interface BusinessProfile {
  info:      CompanyInfo
  industry:  string              // 'hvac' | 'landscaping' | 'roofing' | ... (seeds presets)
  services:  { name: string; slug: string; blurb?: string }[]
  cities?:   string[]            // service-area page targets
  voice?:    string              // brand voice note for copy ("straightforward, no-nonsense")
  usps?:     string[]            // differentiators to weave into copy
}

// ── Toggles ──────────────────────────────────────────────────────────────────
export type Vibe        = 'clean-corporate' | 'bold-trades' | 'friendly-local' | 'premium-modern'
export type ColorMood   = 'blue-trust' | 'green-growth' | 'red-urgent' | 'earthy' | 'mono-slate' | 'from-logo'
export type ButtonStyle = 'rounded' | 'pill' | 'square'
export type Density     = 'airy' | 'balanced' | 'compact'
export type CtaStyle    = 'call-first' | 'quote-first' | 'both'

export interface SiteSpec {
  vibe:        Vibe
  colorMood:   ColorMood
  fontPairing: 'auto' | string
  buttonStyle: ButtonStyle
  density:     Density
  ctaStyle:    CtaStyle
  proof:       { reviews: boolean; license: boolean; years: boolean }
  pages: {
    servicesPages:    boolean    // one page per service
    serviceAreaPages: boolean    // one page per city
    about:            boolean
  }
  /** 'auto' lets the composer pick sections; power users can pin an ordered list per page. */
  sections: 'auto' | Record<string, SectionType[]>
}

// ── Brand (resolved from vibe + colorMood + logo) → written to Kadence globals ──
export interface Brand {
  /** 9-slot Kadence global palette (index 0 = slot 1). */
  palette: [string, string, string, string, string, string, string, string, string]
  fonts:   { heading: string; body: string }
  button:  { style: ButtonStyle; radiusPx: number }
  density: Density
}

// ── Patterns ─────────────────────────────────────────────────────────────────
export type SectionType =
  | 'hero' | 'trust-bar' | 'value-props' | 'services-grid' | 'about'
  | 'testimonials' | 'service-area' | 'process' | 'faq' | 'cta-band' | 'contact'

/** Everything a pattern needs to render block markup. */
export interface BuildContext {
  profile: BusinessProfile
  brand:   Brand
  /** Emit a Kadence dynamic-field span bound to a settings field (never hard-code facts). */
  dyn: (field: keyof CompanyInfo, fallback: string, opts?: { before?: string }) => string
}

export interface SectionPattern {
  id:      string
  type:    SectionType
  /** Industries this pattern suits ('*' = any). Used by the composer + reference harvester. */
  industries: string[]
  /** Returns Gutenberg/Kadence block markup for post_content. */
  render:  (ctx: BuildContext, content: Record<string, unknown>) => string
}

export interface PageSpec {
  slug:     string
  title:    string
  sections: { type: SectionType; content?: Record<string, unknown> }[]
  seo?:     { title?: string; description?: string }
}

/** The full plan the composer produces and the deployer executes. */
export interface SitePlan {
  brand:    Brand
  settings: CompanyInfo
  pages:    PageSpec[]
  elements: { header: string; footer: string }   // Kadence Element block markup
}

// ─────────────────────────────────────────────────────────────────────────────
// Website Creator — starter pattern library + composer (Phase 0 scaffold).
//
// A pattern is a pure function: (BuildContext, content) → Gutenberg/Kadence block
// markup for post_content. Company facts are injected via ctx.dyn() (Kadence dynamic
// fields), NEVER hard-coded — see KNOWLEDGE.md §3. Patterns inherit the global palette;
// only the hero sets a section background (from the resolved brand).
// ─────────────────────────────────────────────────────────────────────────────

import type {
  BuildContext, CompanyInfo, PageSpec, SectionPattern, SectionType,
} from './types'

/** Build a ctx.dyn() bound to the site's settings post — emits a Kadence dynamic-field span. */
export function makeDyn(settingsPostId: number): BuildContext['dyn'] {
  return (field: keyof CompanyInfo, fallback: string, opts) =>
    `<span data-field="post|post_custom_field" data-para="mb_meta|${String(field)}"` +
    (opts?.before ? ` data-before="${opts.before}"` : '') +
    ` data-source-post="${settingsPostId}" class="kb-inline-dynamic">${fallback}</span>`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ── Patterns ─────────────────────────────────────────────────────────────────

const hero: SectionPattern = {
  id: 'hero.centered-cta', type: 'hero', industries: ['*'],
  render(ctx, content) {
    const { brand, dyn } = ctx
    const bg = brand.palette[5]       // slot 6 — BG-1
    const accent = brand.palette[0]   // slot 1 — Primary
    const ink = '#ffffff'
    const headline = esc(String(content.headline ?? `${ctx.profile.info.company_name}`))
    const sub = esc(String(content.sub ?? ctx.profile.info.tagline ?? ''))
    return `
<!-- wp:cover {"minHeight":560,"isDark":true,"align":"full","style":{"color":{"background":"${bg}"}}} -->
<div class="wp-block-cover alignfull is-dark" style="min-height:560px;background-color:${bg}">
<span aria-hidden="true" class="wp-block-cover__background has-background-dim-90 has-background-dim"></span>
<div class="wp-block-cover__inner-container">
<!-- wp:group {"layout":{"type":"constrained","contentSize":"1080px"}} --><div class="wp-block-group">
<!-- wp:heading {"level":1,"style":{"color":{"text":"${ink}"}}} -->
<h1 class="wp-block-heading" style="color:${ink}">${headline}</h1>
<!-- /wp:heading -->
<!-- wp:paragraph {"style":{"color":{"text":"${ink}"}}} --><p style="color:${ink}">${sub}</p><!-- /wp:paragraph -->
<!-- wp:buttons -->
<div class="wp-block-buttons">
<!-- wp:button {"style":{"color":{"background":"${accent}","text":"${ink}"}}} -->
<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="tel:">Call ${dyn('phone', '(000) 000-0000')}</a></div>
<!-- /wp:button -->
<!-- wp:button {"className":"is-style-outline"} -->
<div class="wp-block-button is-style-outline"><a class="wp-block-button__link wp-element-button" href="/contact">Get a Free Quote</a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons --></div><!-- /wp:group --></div></div>
<!-- /wp:cover -->`.trim()
  },
}

const servicesGrid: SectionPattern = {
  id: 'services.icon-grid', type: 'services-grid', industries: ['*'],
  render(ctx, content) {
    const services = (content.services as { name: string; slug: string; blurb?: string }[] | undefined)
      ?? ctx.profile.services
    const cards = services.map(s => `
<!-- wp:column --><div class="wp-block-column">
<!-- wp:heading {"level":3} --><h3 class="wp-block-heading">${esc(s.name)}</h3><!-- /wp:heading -->
<!-- wp:paragraph --><p>${esc(s.blurb ?? `Professional ${s.name.toLowerCase()} you can rely on.`)}</p><!-- /wp:paragraph -->
<!-- wp:paragraph --><p><a href="/services/${esc(s.slug)}">Learn more →</a></p><!-- /wp:paragraph --></div><!-- /wp:column -->`).join('')
    return `
<!-- wp:group {"align":"full","layout":{"type":"constrained","contentSize":"1080px"},"style":{"spacing":{"padding":{"top":"64px","bottom":"64px"}}}} -->
<div class="wp-block-group alignfull" style="padding-top:64px;padding-bottom:64px">
<!-- wp:heading {"textAlign":"center","level":2} --><h2 class="wp-block-heading has-text-align-center">${esc(String(content.heading ?? 'Our Services'))}</h2><!-- /wp:heading -->
<!-- wp:columns -->${cards}<!-- /wp:columns --></div>
<!-- /wp:group -->`.trim()
  },
}

const ctaBand: SectionPattern = {
  id: 'cta.band', type: 'cta-band', industries: ['*'],
  render(ctx, content) {
    const { brand, dyn } = ctx
    const bg = brand.palette[0]
    return `
<!-- wp:group {"align":"full","style":{"color":{"background":"${bg}"},"spacing":{"padding":{"top":"48px","bottom":"48px"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull" style="background-color:${bg};padding-top:48px;padding-bottom:48px">
<!-- wp:heading {"textAlign":"center","level":2,"style":{"color":{"text":"#ffffff"}}} -->
<h2 class="wp-block-heading has-text-align-center" style="color:#ffffff">${esc(String(content.heading ?? 'Ready to get started?'))}</h2><!-- /wp:heading -->
<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} --><div class="wp-block-buttons">
<!-- wp:button --><div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="tel:">Call ${dyn('phone', '(000) 000-0000')}</a></div><!-- /wp:button -->
</div><!-- /wp:buttons --></div>
<!-- /wp:group -->`.trim()
  },
}

/** Registry — the composer picks from here by section type. Extend / harvest into this. */
export const PATTERNS: Partial<Record<SectionType, SectionPattern[]>> = {
  hero: [hero],
  'services-grid': [servicesGrid],
  'cta-band': [ctaBand],
}

/** Pick the best pattern for a section type + industry (first match; extend with scoring). */
export function pickPattern(type: SectionType, industry: string): SectionPattern | null {
  const list = PATTERNS[type] ?? []
  return list.find(p => p.industries.includes('*') || p.industries.includes(industry)) ?? list[0] ?? null
}

/** Compose one page's post_content from its ordered sections. */
export function composePage(ctx: BuildContext, page: PageSpec): string {
  return page.sections
    .map(s => {
      const pat = pickPattern(s.type, ctx.profile.industry)
      return pat ? pat.render(ctx, s.content ?? {}) : `<!-- missing pattern: ${s.type} -->`
    })
    .filter(Boolean)
    .join('\n\n')
}

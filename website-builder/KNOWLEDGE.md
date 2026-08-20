# How LaunchLocal Builds Websites — the Playbook

> This is the "ultimate knowledge" the website-creator AI must follow. It encodes *our*
> conventions so generated sites look and behave like sites we hand-build — not generic
> AI output. Rule of thumb: **use the full Kadence + WordPress feature set creatively, but
> stick to the basics — global styles and vetted patterns, not one-off custom CSS.**

## 1. The stack (assume the template already has these)

| Layer | Tool | Notes |
|---|---|---|
| Theme | **Kadence** (+ Kadence Blocks / Pro) | Global styles + Elements do the heavy lifting |
| Fields / CPTs | **MetaBox** (+ MB Builder, MB Settings Page) | CPTs & taxonomies are stored as `mb-post-type` / `mb-taxonomy` posts (see `create_mb_cpt.php`) |
| SEO | **Rank Math** | Titles, meta, LocalBusiness schema |
| Commerce (opt) | **WooCommerce** | Only when the business sells products |
| Host / deploy | SiteGround + **WP-CLI over SSH** | Pages upserted with `wp post create/update --post_content-file` (see `build_pages.py`) |

## 2. Global design system FIRST (this is what makes it look good)

Never style per-page. Set the site's global system once; every block inherits it → cohesion.

1. **Palette** → `kadence_global_palette` (we already set this in `fix_kadence_v2.py`). 9 slots:
   `1=Primary, 2=Primary-hover/secondary, 3=Text, 4=Text-light, 5=Border/subtle, 6=BG-1, 7=BG-2, 8=White, 9=Contrast`.
2. **Typography** → `theme_mods_kadence` (base font, headings h1–h6, buttons). Pick from a **vetted font-pairing set** (a display/heading + a clean body). Never a random Google font per site.
3. **Buttons** → Kadence global button style (radius, padding, fill/outline). One button system site-wide.
4. **Spacing / width** → Kadence content max-width + section padding scale. Consistent rhythm.
5. **Additional CSS** → only for tiny overrides, kept in `custom_css`. Prefer setting a global option over writing CSS.

The AI chooses palette + fonts + button style from **curated presets** (by industry/vibe toggle), then writes them to these globals. It does **not** invent per-page colors.

## 3. Company info is centralized — "set once, appears everywhere"

Every business fact lives in ONE place: a **`site_settings` MetaBox record** (a single settings post / MB Settings Page). Fields: `company_name, phone, email, address_*, hours, service_area, license_no, socials, primary_color, tagline, …` (see `wp/site-settings-cpt.php`).

Pages/headers/footers reference these via **Kadence dynamic fields** — the same mechanism our resource templates use:

```html
<span data-field="post|post_custom_field" data-para="mb_meta|phone" class="kb-inline-dynamic">(000) 000-0000</span>
```

So changing the phone number once updates it across the entire site — hero, header, footer, CTAs, contact page, schema. This is also **NAP consistency**, which matters for local SEO. The AI must wire company facts as dynamic fields, never hard-code them into page content.

## 4. Kadence Elements for the site chrome

Header, footer, and any CPT single/archive templates are **Kadence Elements** (hooked site-wide), not per-page content:
- **Header Element** — logo, nav, click-to-call button (phone via dynamic field), primary CTA.
- **Footer Element** — NAP block (all dynamic fields), hours, service area, socials, copyright.
- **Template Elements** — single/archive layouts for any CPT (services, projects, reviews).

Build these once per site; every page gets consistent chrome.

## 5. Pages are assembled from a vetted section library

Don't free-write layouts. Compose pages from a **pattern library** of proven sections (each is core + Kadence blocks, inheriting globals, minimal inline CSS). Starter set:

`hero` · `trust-bar` (reviews/licenses) · `value-props` (3–4 icon cards) · `services-grid` ·
`about` · `testimonials` · `service-area` (map + towns) · `process` (steps) · `faq` · `cta-band` · `contact` (form + NAP).

**Standard local-service page set:** Home (hero → value-props → services-grid → testimonials → service-area → cta), a **Service page per service**, **Service-area pages** (local SEO), About, Contact. Each page = an ordered list of patterns; the AI fills copy + picks which patterns, guided by toggles.

## 6. Content & conversion rules (local service pros)

- Every page has a clear primary CTA: **Call now** (dynamic phone) and **Get a quote**.
- Above the fold: what you do + where + a CTA. No fluff.
- Trust signals early: star rating / review count, years in business, license #, guarantees.
- One `<h1>` per page; semantic h2/h3. Benefit-led headings, not clever.
- Internal links: services ↔ service-areas ↔ home. Every service links to Contact.
- Real, specific copy in the business's voice — never lorem, never "we are passionate about excellence."

## 7. SEO (Rank Math)

- Title + meta description per page (keyword + location + brand).
- **LocalBusiness schema** populated from the settings record (NAP, hours, geo, priceRange).
- Service pages target "{service} {city}"; service-area pages target "{service} in {town}".

## 8. Deploy conventions (idempotent)

- Upsert by slug: if the page exists, `wp post update`; else `wp post create` (see `build_pages.py::upsert_page`).
- Set: homepage (`wp option update page_on_front`), primary menu, Kadence Elements, globals, Rank Math meta.
- Everything re-runnable — running the builder twice produces the same site, not duplicates.

## 9. Hard "don'ts" (keep it basic)

- ❌ Per-page custom colors/fonts — use globals.
- ❌ Sprawling custom CSS / absolute-positioned hacks — use Kadence block settings.
- ❌ Hard-coded phone/address/name in content — use dynamic fields.
- ❌ Random new Google fonts — use the vetted pairings.
- ❌ Novel layouts per page — compose from the pattern library.
- ✅ Do use the full expressive range of Kadence blocks (row layouts, columns, icons, tabs,
  accordions, galleries, forms) *within* the global system.

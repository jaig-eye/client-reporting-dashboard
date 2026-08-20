# Website Creator — Architecture

Turns a short **business profile + a few toggles** into a complete, on-brand Kadence site,
deployed to a pre-provisioned WordPress template via our existing WP-CLI/SSH connection.

## The pipeline

```
BusinessProfile + SiteSpec (toggles)
        │
        ▼
1. Brand resolve   → pick palette + font pairing + button style from CURATED presets
        │             (industry + vibe) → write Kadence globals (kadence_global_palette,
        │             theme_mods_kadence)
        ▼
2. Settings record → upsert the site_settings post with all company facts (NAP, hours,
        │             services, socials, license) → everything else references it dynamically
        ▼
3. Structure       → decide the page set (Home, Service pages, Service-area pages, About,
        │             Contact) from the profile + toggles
        ▼
4. Compose         → for each page, order patterns from the LIBRARY and let AI fill copy;
        │             company facts injected as Kadence dynamic fields (never hard-coded)
        ▼
5. Chrome          → build Header/Footer/Template Kadence Elements
        ▼
6. SEO             → Rank Math titles/meta + LocalBusiness schema from the settings record
        ▼
7. Deploy          → idempotent WP-CLI upsert over SSH (reuse the dashboard's WP connector);
                      set homepage, menu, elements, globals
        ▼
8. Review pass     → AI critiques the built site for cohesion/NAP/CTA coverage; flags fixes
```

## "Training" — what it actually means (read this)

You don't need to **fine-tune a model**. That's expensive, slow to iterate, and worse than the
approach below for this problem. What "train it on our sites" really means in practice:

1. **The playbook** (`KNOWLEDGE.md`) is the system prompt — the conventions the AI must follow.
2. **A curated pattern library** — vetted sections that already look good. The AI *composes*,
   it doesn't freehand. This is 80% of "looks like we built it."
3. **Reference-site ingestion (RAG, not fine-tuning).** Point the tool at sites we already
   built (we have SSH/WP-CLI access): pull each page's block content (`wp post get --field=post_content`),
   **harvest** the sections into normalized, reusable patterns (strip site-specific colors/copy,
   keep structure + block settings), tag by section type + industry, and add them to the library.
   Now the AI "learns from" real sites by reusing their proven structures. Every good site we
   build makes the next one better — no model training loop.
4. **Preset expansion** — palettes/font-pairings/toggle defaults captured from sites we like.

If we ever want a model that *writes better Kadence copy*, that's a prompt/few-shot concern,
still not fine-tuning.

## Toggles (SiteSpec) — simple knobs to tune output

Kept intentionally small; each maps to concrete build decisions (see `types.ts`):

- **vibe**: `clean-corporate | bold-trades | friendly-local | premium-modern` → palette + font + density preset
- **colorMood**: `blue-trust | green-growth | red-urgent | earthy | mono-slate | from-logo`
- **fontPairing**: `auto | <named pairing>`
- **buttonStyle**: `rounded | pill | square`
- **density**: `airy | balanced | compact` → section padding scale
- **pages**: which page types to generate (home always; services per service; service-area on/off)
- **sections per page**: `auto` or an explicit ordered pattern list (power users)
- **ctaStyle**: `call-first | quote-first | both`
- **proof**: show reviews / license / years-in-business badges (on/off)

`auto` everywhere = give it a business profile and go. The toggles just steer.

## Interfaces (how the AI acts on WordPress)

Three layers, build in this order:

1. **WP-CLI over SSH** (we have this today via the dashboard's WordPress connection) — the
   deploy transport. Idempotent upserts, option writes, element creation.
2. **A thin WP helper (MU-plugin)** exposing high-level ops we don't want to script raw each
   time: `set_brand(palette,fonts,buttons)`, `upsert_settings(fields)`, `upsert_page(slug,blocks)`,
   `upsert_element(type,blocks)`, `set_seo(page,meta)`. Authenticated (app password / token).
2b. **MCP server** wrapping (1)+(2) as tools, so Claude Code *and* the platform agent drive it
    the same way. (Start from Automattic's `wordpress-mcp` + add our Kadence/brand tools.)
3. **This TS module** (`website-builder/`) = the brain: presets, pattern library, the composer
   that turns a SiteSpec into blocks + a deploy plan.

## Multi-tenant / where it lives

This is a **platform capability**, not part of the internal reporting dashboard UI. Recommended:
a separate app (or a dedicated area) that owns: business intake → build → the WP template
provisioning → deploy. It can share this `website-builder/` core and the WP connection. For now
the core (presets, patterns, composer, WP contract) lives here so it's reusable.

## Phased plan

- **Phase 0 (this branch):** the playbook, the SiteSpec/BusinessProfile contract, the
  `site_settings` CPT + fields, the pattern format + 1–2 patterns, a composer skeleton, and the
  WP op contract. Proves the loop end-to-end on paper + code.
- **Phase 1:** MU-plugin + MCP tools; brand resolver writing real Kadence globals; deploy a
  full Home page to a test template via WP-CLI.
- **Phase 2:** full pattern library (10–12 sections) + Header/Footer Elements + service &
  service-area page generators + Rank Math/schema.
- **Phase 3:** reference-site harvester (ingest our sites → patterns); preset library from real
  sites; the review/critique pass; the intake UI + toggles.

## Open decisions (need your call)

1. Where the tool lives — separate app vs an area of the platform (see the ToplinePro thread).
2. `site_settings` as a **MetaBox Settings Page** (global) vs a **single CPT post** (dynamic-field
   friendly). Leaning CPT-post so Kadence dynamic fields resolve cleanly (matches our resource
   templates). Confirm.
3. The exact company-fact field list (starter set in `wp/site-settings-cpt.php` — extend?).
4. First industries to seed presets/patterns for (HVAC, landscaping, roofing, …?).

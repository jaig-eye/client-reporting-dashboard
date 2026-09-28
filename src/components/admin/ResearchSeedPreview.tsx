'use client'

// What keyword research will search for, derived rather than typed.
//
// This lived in Brand DNA, beside an editable box asking for the same phrases. The box is gone —
// research searches outwards from Services Offered, and asking for them twice only created a way
// for the two to disagree — and the preview has followed the rest of the research controls to the
// Keywords tab, where looking and choosing happen.
//
// Built by buildResearchSeeds, the function research itself calls, so what is on screen is what
// gets bought. A preview computed separately would drift from the real thing the first time either
// changed, and a wrong preview is worse than none: it is the only place the spend is visible
// before it happens.

import { parseServices, geoPhrase, buildResearchSeeds } from '@/lib/content/researchSeeds'
import type { ResearchLocationValue } from './ResearchLocationPicker'

export default function ResearchSeedPreview({ services, location, geographicFocus, extra }: {
  services:        string
  location:        ResearchLocationValue | null
  geographicFocus: string
  /** content_settings.foundational_keywords, from older clients. Read-only now. */
  extra:           string
}) {
  const list  = parseServices(services)
  const geo   = geoPhrase(location ? { name: location.name } : null, geographicFocus)
  const older = String(extra ?? '').split(/[,;\n]+/).map(v => v.trim()).filter(Boolean)
  // Anything stored that is not simply one of the services — the rest would read as a duplicate.
  const kept  = older.filter(v => !list.some(s => s.toLowerCase() === v.toLowerCase()))
  const seeds = buildResearchSeeds(list, geo, kept)

  if (seeds.length === 0) {
    return (
      <p className="text-xs" style={{ margin: 0, color: 'var(--text-faint)' }}>
        No services set for this client yet, so there is nothing to search for. Add them under
        Settings → Brand DNA.
      </p>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {seeds.map(s => {
          // The geo variants are the same service with the market pinned on. Shown muted, or five
          // services read as ten separate decisions.
          const isGeo = !!geo && s.toLowerCase().endsWith(` ${geo.toLowerCase()}`)
          return (
            <span
              key={s}
              style={{
                display: 'inline-flex', alignItems: 'center',
                background: isGeo ? 'transparent' : 'var(--bg-subtle)',
                border: '1px solid var(--border)',
                borderRadius: 999, padding: '2px 9px', fontSize: '0.78rem',
                color: isGeo ? 'var(--text-faint)' : 'var(--text-primary)',
              }}
            >
              {s}
            </span>
          )
        })}
      </div>
      <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
        {seeds.length} search{seeds.length === 1 ? '' : 'es'}
        {geo ? <> — the faded ones are the same service measured in <strong style={{ color: 'var(--text-muted)' }}>{geo}</strong>.</> : '.'}
      </p>
    </div>
  )
}

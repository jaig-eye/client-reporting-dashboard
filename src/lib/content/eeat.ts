// Helpers for the E-E-A-T trust block stored in content_settings.eeat_data.

import type { EeatData } from './types'

/**
 * Founded year is the durable fact; "years in business" is derived.
 *
 * The original field was a free-text `years_in_business` ("22 years", "15+",
 * "Since 2008"), which silently rots — a client onboarded in 2024 as "20 years"
 * is still described as 20 years in 2030. `founded_year` fixes the fact and lets
 * the tenure be computed at prompt time.
 *
 * Legacy values are still honoured so nothing breaks before a client is migrated:
 * a 4-digit year in the old field is treated as a founding year, and any other
 * text is passed through verbatim.
 */
export function describeTenure(
  eeat: Partial<EeatData> | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!eeat) return null

  const currentYear = now.getUTCFullYear()

  const explicit = parseFoundedYear(eeat.founded_year, currentYear)
  if (explicit !== null) return renderTenure(explicit, currentYear)

  // eeat_data is untyped JSONB and the brand-DNA prompt asks the model for a
  // "number of years", so this value can legitimately arrive as a JSON number.
  // Calling .trim() on it would throw, and describeTenure runs inside four
  // content routes — the version on main used a template literal, which coerced
  // silently. Coerce explicitly rather than reintroducing that fragility.
  const legacyRaw = eeat.years_in_business
  const legacy = legacyRaw == null ? '' : String(legacyRaw).trim()
  if (!legacy) return null

  // "Since 2008" / "2008" — a bare year in the legacy field is a founding year.
  const embedded = legacy.match(/\b(1[89]\d{2}|20\d{2})\b/)
  if (embedded) {
    const y = parseFoundedYear(embedded[1], currentYear)
    if (y !== null) return renderTenure(y, currentYear)
  }

  // "22 years", "15+" — already a duration, use as written.
  return /year/i.test(legacy) ? legacy : `${legacy} years in business`
}

/** The founding year as a number, or null if unusable. */
export function parseFoundedYear(
  raw: string | number | null | undefined,
  currentYear: number = new Date().getUTCFullYear(),
): number | null {
  if (raw == null) return null
  const n = typeof raw === 'number' ? raw : parseInt(String(raw).trim(), 10)
  if (!Number.isFinite(n)) return null
  // Reject anything that cannot be a real founding year.
  if (n < 1800 || n > currentYear) return null
  return n
}

function renderTenure(founded: number, currentYear: number): string {
  const years = currentYear - founded
  if (years <= 0) return `founded ${founded}`
  return `${years} years in business (founded ${founded})`
}

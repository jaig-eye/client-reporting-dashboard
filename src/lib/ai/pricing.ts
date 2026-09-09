// ─────────────────────────────────────────────────────────────────────────────
// Model price list, in USD per MILLION tokens.
//
// This table is the single place rates live, and it is deliberately dumb data rather than
// anything clever: provider pricing changes without notice, so the maintenance job is
// "edit these numbers", not "understand the code".
//
// The important rule is what happens on a MISS. An unknown model returns null, the caller
// records the tokens with cost_usd = NULL, and the panel reports it as unpriced. It never
// falls back to a nearby model's rate — a silently wrong cost is worse than a visibly
// missing one, because it looks authoritative on a spend dashboard.
//
// Rates below were entered on 2026-09-09 and should be re-checked against provider pricing
// pages periodically; UPDATED_ON is surfaced in the UI so nobody mistakes stale figures for
// live billing. This is an ESTIMATE for internal budgeting, never a substitute for the
// provider invoice.
// ─────────────────────────────────────────────────────────────────────────────

export const PRICING_UPDATED_ON = '2026-09-09'

export interface TokenRate {
  /** USD per 1M input tokens. */
  input:  number
  /** USD per 1M output tokens. */
  output: number
}

/**
 * Keyed by the exact model id sent to the provider. Matching is exact-first, then longest
 * prefix, so a dated snapshot like `claude-sonnet-4-6-20260101` resolves to its family rate
 * without needing its own row.
 */
const TOKEN_RATES: Record<string, TokenRate> = {
  // Anthropic
  'claude-opus-5':      { input: 15.00, output: 75.00 },
  'claude-sonnet-5':    { input:  3.00, output: 15.00 },
  'claude-sonnet-4-6':  { input:  3.00, output: 15.00 },
  'claude-haiku-4-5':   { input:  1.00, output:  5.00 },

  // OpenAI
  'gpt-4o':             { input:  2.50, output: 10.00 },
  'gpt-4o-mini':        { input:  0.15, output:  0.60 },
}

/** Flat USD per generated image, for models that bill per image rather than per token. */
const IMAGE_RATES: Record<string, number> = {
  'dall-e-3':    0.040,
  'gpt-image-1': 0.040,
}

function resolve<T>(table: Record<string, T>, model: string): T | null {
  const key = model.trim().toLowerCase()
  if (table[key]) return table[key]
  // Longest-prefix match so dated snapshots inherit their family's rate.
  const prefix = Object.keys(table)
    .filter(k => key.startsWith(k))
    .sort((a, b) => b.length - a.length)[0]
  return prefix ? table[prefix] : null
}

/**
 * Cost of one text completion, or null when the model has no entry.
 * Null is meaningful — see the header. Do not coerce it to 0.
 */
export function priceTokens(model: string, inputTokens: number, outputTokens: number): number | null {
  const rate = resolve(TOKEN_RATES, model)
  if (!rate) return null
  const cost = (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output
  return Number(cost.toFixed(6))
}

/** Cost of N generated images, or null when the model has no entry. */
export function priceImages(model: string, count: number): number | null {
  const rate = resolve(IMAGE_RATES, model)
  if (rate == null) return null
  return Number((rate * count).toFixed(6))
}

/** Every model we can price, for the settings panel's "rates in use" disclosure. */
export function knownRates(): { model: string; input?: number; output?: number; perImage?: number }[] {
  return [
    ...Object.entries(TOKEN_RATES).map(([model, r]) => ({ model, input: r.input, output: r.output })),
    ...Object.entries(IMAGE_RATES).map(([model, perImage]) => ({ model, perImage })),
  ]
}

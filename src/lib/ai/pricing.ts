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

/** USD per 1M tokens for an image model, by what the tokens carry. */
export interface ImageTokenRate {
  textInput:   number
  imageInput:  number
  imageOutput: number
}

/**
 * GPT image models bill per token, split by modality — not per image.
 *
 * From https://developers.openai.com/api/docs/pricing ("Image generation models", standard tier),
 * entered 2026-09-30. Cached-input rates are left out: OpenAI states they apply only to the
 * Responses API image tool, never to /v1/images requests, which is the only way we call these.
 * These models have no text-output rate on that page, because they produce none.
 */
const IMAGE_TOKEN_RATES: Record<string, ImageTokenRate> = {
  'gpt-image-2.5-flare':    { textInput: 5.00, imageInput: 8.00, imageOutput: 30.00 },
  'gpt-image-2.5-sunburst': { textInput: 5.00, imageInput: 8.00, imageOutput: 30.00 },
  'gpt-image-2':            { textInput: 5.00, imageInput: 8.00, imageOutput: 30.00 },
}

/**
 * USD per image, used ONLY when a response carries no `usage` to price exactly.
 *
 * It is the image-output cost of one 1536x1024 image at the quality lib/content/imageModels.ts
 * sends each model, per the image generation guide
 * (https://developers.openai.com/api/docs/guides/image-generation#cost-and-latency):
 *   gpt-image-2    `medium`  1,372 output tokens x $30/1M = $0.041 (the guide's table says $0.041)
 *   gpt-image-2.5  `high`    1,372 output tokens x $30/1M = $0.041 (the guide's token calculator,
 *                            which gives Sunburst and Flare the same count)
 * The prompt's text-input tokens (a few hundred, a fraction of a cent) are not in it, so it is a
 * slight underestimate, and it goes stale the moment the size or quality sent changes.
 */
const IMAGE_RATES: Record<string, number> = {
  'gpt-image-2.5-flare':    0.041,
  'gpt-image-2.5-sunburst': 0.041,
  'gpt-image-2':            0.041,
}

function resolve<T>(table: Record<string, T>, model: string): T | null {
  const key = model.trim().toLowerCase()
  // Own keys only: `table['constructor']` is Object's, and would be "priced" as a rate.
  if (Object.prototype.hasOwnProperty.call(table, key)) return table[key]
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

/**
 * Per-image ESTIMATE of N generated images, or null when the model has no entry.
 * Only for a response without `usage` — priceImageUsage is the real figure.
 */
export function priceImages(model: string, count: number): number | null {
  const rate = resolve(IMAGE_RATES, model)
  if (rate == null) return null
  return Number((rate * count).toFixed(6))
}

/** The `usage` object an Images API response carries. Every field optional: none is guaranteed. */
export interface ImageUsage {
  input_tokens?:          number
  output_tokens?:         number
  input_tokens_details?:  { text_tokens?: number; image_tokens?: number } | null
  output_tokens_details?: { text_tokens?: number; image_tokens?: number } | null
}

const count = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null

/**
 * Cost of one Images API call from the token counts OpenAI reported, or null when the model has
 * no entry or the usage carries no counts to price.
 *
 * Input is split into text and image tokens where the response says how; a generation has no
 * input image, so input with no breakdown is priced as text. Output with no breakdown is priced as
 * image tokens, which is all these models produce.
 */
export function priceImageUsage(model: string, usage: ImageUsage | null | undefined): number | null {
  const rate = resolve(IMAGE_TOKEN_RATES, model)
  if (!rate || !usage) return null

  const input  = count(usage.input_tokens)
  const output = count(usage.output_tokens)
  if (input == null && output == null) return null

  const imageIn  = count(usage.input_tokens_details?.image_tokens) ?? 0
  const textIn   = count(usage.input_tokens_details?.text_tokens) ?? Math.max(0, (input ?? 0) - imageIn)
  const imageOut = count(usage.output_tokens_details?.image_tokens) ?? (output ?? 0)

  const cost = (textIn   / 1_000_000) * rate.textInput
             + (imageIn  / 1_000_000) * rate.imageInput
             + (imageOut / 1_000_000) * rate.imageOutput
  return Number(cost.toFixed(6))
}

/**
 * Every model we can price, for the settings panel's "rates in use" disclosure. Image models
 * report their text-input rate as `input`, their image-output rate as `output`, and the per-image
 * fallback estimate as `perImage`.
 */
export function knownRates(): { model: string; input?: number; output?: number; perImage?: number }[] {
  return [
    ...Object.entries(TOKEN_RATES).map(([model, r]) => ({ model, input: r.input, output: r.output })),
    ...Object.entries(IMAGE_TOKEN_RATES).map(([model, r]) => ({
      model, input: r.textInput, output: r.imageOutput, perImage: IMAGE_RATES[model],
    })),
  ]
}

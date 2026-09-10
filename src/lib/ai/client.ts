// ─────────────────────────────────────────────────────────────────────────────
// The one place an AI request is made.
//
// Before this, thirteen routes and libraries each hand-rolled the same fetch: the same
// provider branch, the same headers, the same `if (!res.ok) throw`, the same response
// unwrapping — and every one of them discarded the provider's `usage` block. That is why no
// AI spend was measurable.
//
// Centralising is what makes metering reliable rather than merely present. A per-call-site
// `recordAiUsage()` would be correct on the day it was written and wrong the first time
// somebody added a fourteenth call site; here, usage is recorded on the only path that can
// reach a provider, so a new caller is metered by construction.
//
// Recording is best-effort and deliberately NOT awaited into the caller's critical path — a
// ledger failure must never turn a successful generation into an error. See lib/ai/usage.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { recordAiUsage, type AiOperation } from '@/lib/ai/usage'
import { priceTokens } from '@/lib/ai/pricing'

export type AiProvider = 'anthropic' | 'openai'

export interface CompleteTextParams {
  provider:   AiProvider
  model:      string
  apiKey:     string
  system:     string
  user:       string
  maxTokens?: number
  /** What this call is FOR — drives the spend breakdown. */
  operation:  AiOperation
  /** Attribution for per-client cost reporting. Optional; spend is still recorded without it. */
  clientId?:  string | null
  postId?:    string | null
  signal?:    AbortSignal
}

export interface CompleteTextResult {
  text:         string
  inputTokens:  number
  outputTokens: number
  /** null when the model is absent from the pricing table — see lib/ai/pricing.ts. */
  costUsd:      number | null
}

/**
 * Issue one text completion and record what it cost.
 *
 * Throws on a non-2xx response, matching what every call site already did, so this is a
 * drop-in replacement for the inline fetches it supersedes.
 */
export async function completeText(p: CompleteTextParams): Promise<CompleteTextResult> {
  const maxTokens = p.maxTokens ?? 8192

  let text = ''
  let inputTokens = 0
  let outputTokens = 0

  if (p.provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         p.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      p.model,
        max_tokens: maxTokens,
        system:     p.system,
        messages:   [{ role: 'user', content: p.user }],
      }),
      signal: p.signal,
    })
    if (!res.ok) throw new Error(`AI API error: ${await res.text()}`)

    const data = await res.json()
    const block = data.content?.find((b: Record<string, unknown>) => b.type === 'text')
    text = block?.text || ''
    // Anthropic reports usage on the response envelope.
    inputTokens  = Number(data.usage?.input_tokens  ?? 0)
    outputTokens = Number(data.usage?.output_tokens ?? 0)
  } else {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` },
      body: JSON.stringify({
        model:    p.model,
        messages: [{ role: 'system', content: p.system }, { role: 'user', content: p.user }],
      }),
      signal: p.signal,
    })
    if (!res.ok) throw new Error(`AI API error: ${await res.text()}`)

    const data = await res.json()
    text = data.choices?.[0]?.message?.content || ''
    // OpenAI names the same numbers differently.
    inputTokens  = Number(data.usage?.prompt_tokens     ?? 0)
    outputTokens = Number(data.usage?.completion_tokens ?? 0)
  }

  // A completion that reports NO tokens is unpriceable, not free.
  //
  // priceTokens(model, 0, 0) returns 0 — a number — so a provider that omits or renames its
  // usage block produced a row recorded as a PRICED $0.00 call. Those then vanish into the
  // total instead of appearing in unpricedCalls, which is the one number the panel has for
  // saying "this figure is incomplete". Absent usage is exactly the case that count exists
  // for, so it is reported as null.
  const costUsd = (inputTokens === 0 && outputTokens === 0)
    ? null
    : priceTokens(p.model, inputTokens, outputTokens)

  // AWAITED, not fire-and-forget.
  //
  // A serverless instance can freeze the moment its handler resolves, dropping any promise
  // still in flight — and the manual generate path has no await at all between this call and
  // its response, so a full 16k-token article was billed by the provider and recorded
  // nowhere. Awaiting cannot fail the caller: recordAiUsage swallows its own errors, and one
  // insert is immaterial next to the multi-second model call that just finished.
  await recordAiUsage({
    provider: p.provider,
    model:    p.model,
    operation: p.operation,
    inputTokens,
    outputTokens,
    costUsd,
    clientId: p.clientId,
    postId:   p.postId,
  })

  return { text, inputTokens, outputTokens, costUsd }
}

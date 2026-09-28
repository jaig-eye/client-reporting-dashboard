// How a client's service areas are described to the writer.
//
// Its own module because three prompts need it — both article paths and topic selection — and a
// client's market has to mean the same thing in all of them. Hanging it off generateTopics would
// have made the article route import the topic generator to format a sentence.

/**
 * One context line naming where the business works, primary first.
 *
 * Service Areas is an ordered list, so the ordering is information: a business covering Los
 * Angeles, the Tri-County area and Southern California wants the first led and the rest
 * acknowledged, not all three treated as interchangeable. Before this, the prompt passed the raw
 * sentence and left the model to infer priority that was never stated.
 *
 * A single area reads exactly as it did before, and an empty value produces nothing rather than an
 * empty label.
 */
export function serviceAreaLine(geographicFocus: unknown): string | null {
  const areas = String(geographicFocus ?? '')
    .split(/[,;\n]+/)
    .map(v => v.trim())
    .filter(Boolean)

  if (areas.length === 0) return null
  if (areas.length === 1) return `Service area: ${areas[0]}`
  return `Service areas: ${areas[0]} (primary — lead with this), then ${areas.slice(1).join(', ')}`
}

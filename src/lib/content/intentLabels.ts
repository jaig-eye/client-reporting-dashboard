// Search intent, in the operator's words.
//
// DataForSEO classifies every keyword as informational / commercial / transactional /
// navigational. Those are SEO-tool terms; what an agency operator wants to know is what the
// searcher is trying to do. One mapping, used wherever intent is shown.

const LABELS: Record<string, string> = {
  informational: 'Research',
  commercial:    'Comparing',
  transactional: 'Ready to buy',
  navigational:  'Brand search',
  local:         'Near me',
}

/** "Ready to buy" for "transactional"; null when there is nothing to say. */
export function intentLabel(intent: string | null | undefined): string | null {
  if (!intent) return null
  const key = intent.toLowerCase().trim()
  return LABELS[key] ?? (key.charAt(0).toUpperCase() + key.slice(1))
}

/** A hover explanation of the label, for the first time someone sees it. */
export function intentHint(intent: string | null | undefined): string | undefined {
  switch ((intent ?? '').toLowerCase().trim()) {
    case 'informational': return 'Searchers want to learn something — a guide or explainer fits.'
    case 'commercial':    return 'Searchers are weighing options — comparisons and recommendations fit.'
    case 'transactional': return 'Searchers are ready to act — a service page or clear call to action fits.'
    case 'navigational':  return 'Searchers are looking for a specific business or brand by name.'
    case 'local':         return 'Searchers want someone nearby.'
    default:              return undefined
  }
}

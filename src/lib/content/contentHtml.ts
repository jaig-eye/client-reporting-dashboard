// Shared HTML post-processing for generated content.
//
// styleTables injects INLINE styles onto <table>/<th>/<td>. Inline styles are used
// (not a <style> block) because stripDangerousHtml removes <style> blocks, and because
// WordPress + most themes strip class-based CSS but preserve inline style attributes —
// so inline is what actually renders in the published post.

function addStyle(tag: string, attrs: string, style: string): string {
  // Respect an existing inline style (don't double up); otherwise inject ours.
  if (/\sstyle\s*=/i.test(attrs)) return `<${tag}${attrs}>`
  return `<${tag}${attrs} style="${style}">`
}

const TABLE_STYLE = 'border-collapse:collapse;width:100%;margin:1rem 0;'
const TH_STYLE    = 'border:1px solid #333;padding:8px 12px;text-align:left;background:#f2f2f2;font-weight:600;'
const TD_STYLE    = 'border:1px solid #333;padding:8px 12px;text-align:left;vertical-align:top;'

/**
 * Give generated tables visible cell borders + padding via inline styles so they render
 * as a real table in WordPress instead of a borderless block. No-op when there are no tables.
 */
export function styleTables(html: string): string {
  if (!/<table/i.test(html)) return html
  return html
    .replace(/<table(\s[^>]*)?>/gi, (_m, a) => addStyle('table', a || '', TABLE_STYLE))
    .replace(/<th(\s[^>]*)?>/gi,    (_m, a) => addStyle('th',    a || '', TH_STYLE))
    .replace(/<td(\s[^>]*)?>/gi,    (_m, a) => addStyle('td',    a || '', TD_STYLE))
}

/**
 * Remove the editorial HTML comments the writer prompt asks for, before the
 * article is pushed to a CMS.
 *
 * WRITER_QUALITY_RULES asks the model to mark original material with
 * `<!-- INSIGHT: ... -->` / `<!-- EXPERIENCE: ... -->`, and editorialStandards
 * asks for a `<!-- MEDIA: ... -->` brief. Those exist so a human editor can see
 * where the value is and what to shoot — they are working notes, not content.
 *
 * Nothing was stripping them, so every one was published verbatim into the
 * client's live page source, where anyone can View Source and read our internal
 * annotations (and a "MEDIA:" brief describing photos that do not exist yet).
 * Stripped at push time rather than at generation so the reviewer still sees
 * them in the dashboard.
 */
export function stripEditorialMarkers(html: string): string {
  if (!html) return html
  return html
    .replace(/<!--\s*(INSIGHT|EXPERIENCE|MEDIA)\s*:[\s\S]*?-->/gi, '')
    // Collapse the blank lines the removals leave behind.
    .replace(/\n{3,}/g, '\n\n')
}

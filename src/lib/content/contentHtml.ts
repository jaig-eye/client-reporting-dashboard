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

// Styled HTML email builders for content automation notifications.
// All styles are inline — required for broad email client compatibility.

function esc(s: string | null | undefined): string {
  if (!s) return ''
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

function wrapper(agencyName: string, clientName: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 16px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">

    <!-- Header -->
    <div style="background:#1e3a8a;padding:22px 28px;">
      <p style="margin:0 0 4px;color:#93c5fd;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;">${esc(agencyName)} &middot; Content</p>
      <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;line-height:1.3;">${esc(clientName)}</h1>
    </div>

    <!-- Body -->
    <div style="padding:28px;">
      ${body}
    </div>

    <!-- Footer -->
    <div style="padding:14px 28px;border-top:1px solid #e5e7eb;background:#f9fafb;">
      <p style="margin:0;color:#9ca3af;font-size:11px;">${esc(agencyName)} &middot; Content Automation</p>
    </div>

  </div>
</body>
</html>`
}

function tableRow(cells: string[], isAlt: boolean): string {
  const bg = isAlt ? '#f9fafb' : '#ffffff'
  return `<tr style="background:${bg};">${cells.map(c =>
    `<td style="padding:9px 12px;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6;">${c}</td>`
  ).join('')}</tr>`
}

function ctaButton(label: string, href: string): string {
  return `
    <table cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
      <tr>
        <td style="background:#2563eb;border-radius:6px;" align="center">
          <a href="${href}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
            ${label}
          </a>
        </td>
      </tr>
    </table>`
}

// ── Topics email ───────────────────────────────────────────────────────────────

export function buildTopicsEmail(opts: {
  agencyName:  string
  clientName:  string
  topics:      Array<{ topic: string; target_keyword: string | null; target_publish_date: string | null; keyword_opportunity?: string | null }>
  clientLink:  string
}): string {
  const { agencyName, clientName, topics, clientLink } = opts
  const count = topics.length

  // Group by publish date for the sub-heading
  const dates = Array.from(new Set(topics.map(t => t.target_publish_date).filter(Boolean)))
  const dateSummary = dates.length > 0
    ? `Generated for ${dates.length} upcoming publish date${dates.length !== 1 ? 's' : ''}.`
    : ''

  const tableRows = topics.map((t, i) => {
    const oppHint = t.keyword_opportunity
      ? `<div style="font-size:11px;color:#9ca3af;margin-top:3px;">${esc(t.keyword_opportunity)}</div>`
      : ''
    return tableRow([
      `<strong style="color:#111827;font-size:13px;">${esc(t.topic)}</strong>${oppHint}`,
      t.target_keyword
        ? `<span style="background:#eff6ff;color:#1d4ed8;padding:2px 7px;border-radius:4px;font-size:12px;font-weight:500;">${esc(t.target_keyword)}</span>`
        : '<span style="color:#9ca3af;">—</span>',
      `<span style="color:#6b7280;">${fmtDate(t.target_publish_date)}</span>`,
    ], i % 2 === 1)
  }).join('')

  const body = `
    <h2 style="margin:0 0 4px;font-size:17px;font-weight:700;color:#111827;">
      ${count} topic idea${count !== 1 ? 's' : ''} ready for your review
    </h2>
    <p style="margin:0 0 20px;font-size:14px;color:#6b7280;">${dateSummary}</p>

    <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
      <thead>
        <tr style="background:#f1f5f9;">
          <th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #e5e7eb;">Topic</th>
          <th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #e5e7eb;">Keyword</th>
          <th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #e5e7eb;">Publish Date</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>

    ${ctaButton('Review &amp; Approve Topics &rarr;', clientLink)}
  `

  return wrapper(agencyName, clientName, body)
}

// ── Posts email ────────────────────────────────────────────────────────────────

export function buildPostsEmail(opts: {
  agencyName:  string
  clientName:  string
  posts:       Array<{ title: string | null; targetKeyword: string | null; targetPublishDate: string | null }>
  clientLink:  string
}): string {
  const { agencyName, clientName, posts, clientLink } = opts
  const count = posts.length

  const tableRows = posts.map((p, i) => tableRow([
    `<strong style="color:#111827;">${esc(p.title) || '(untitled)'}</strong>`,
    p.targetKeyword
      ? `<span style="background:#eff6ff;color:#1d4ed8;padding:2px 7px;border-radius:4px;font-size:12px;font-weight:500;">${esc(p.targetKeyword)}</span>`
      : '<span style="color:#9ca3af;">—</span>',
    `<span style="color:#6b7280;">${fmtDate(p.targetPublishDate)}</span>`,
  ], i % 2 === 1)).join('')

  const body = `
    <h2 style="margin:0 0 4px;font-size:17px;font-weight:700;color:#111827;">
      ${count} post${count !== 1 ? 's' : ''} ready for your review
    </h2>
    <p style="margin:0 0 20px;font-size:14px;color:#6b7280;">
      ${count === 1 ? 'This post has' : 'These posts have'} been generated and are ready to review before publishing.
    </p>

    <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
      <thead>
        <tr style="background:#f1f5f9;">
          <th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #e5e7eb;">Title</th>
          <th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #e5e7eb;">Keyword</th>
          <th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #e5e7eb;">Publish Date</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>

    ${ctaButton('Review Posts &rarr;', clientLink)}
  `

  return wrapper(agencyName, clientName, body)
}

// ── Password reset email ───────────────────────────────────────────────────────

export function buildPasswordResetEmail(opts: {
  agencyName: string
  resetLink:  string
}): string {
  const { agencyName, resetLink } = opts

  const body = `
    <h2 style="margin:0 0 8px;font-size:17px;font-weight:700;color:#111827;">Reset your password</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#6b7280;">
      You requested a password reset. Click the button below — this link expires in <strong>1 hour</strong>.<br>
      If you did not request this, you can safely ignore this email.
    </p>
    ${ctaButton('Reset Password &rarr;', resetLink)}
  `

  return wrapper(agencyName, 'Password Reset', body)
}
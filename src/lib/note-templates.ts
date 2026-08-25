// ─────────────────────────────────────────────────────────────────────────────
// Note category templates.
//
// Each category renders its own small form; the answers land in
// client_notes.fields (JSONB) and the freeform body stays in client_notes.content.
// Adding a category here + to the CHECK in 199_note_categories.sql is all it takes.
//
// SECURITY NOTE on the credential categories (login, dns, hosting).
//
// Structured FIELDS — service, username, login URL, MFA method — are ordinary
// readable text. The PASSWORD goes in client_notes.secret_enc as AES-256-GCM
// ciphertext with the key held in the environment: never in the `fields` blob,
// never returned by a list endpoint, and readable only through the audited
// reveal route. src/lib/crypto/secrets.ts states the threat model plainly,
// including what it does not protect against.
//
// One credential per note, on purpose. A domain whose registrar and DNS host are
// different companies gets two notes rather than two passwords crammed into one,
// so "which password is this?" always has an answer.
// ─────────────────────────────────────────────────────────────────────────────

export type NoteFieldType = 'text' | 'textarea' | 'date' | 'select' | 'url' | 'number'

export interface NoteField {
  key:          string
  label:        string
  type:         NoteFieldType
  placeholder?: string
  options?:     string[]
  /** Rendered full-width instead of in the 2-col grid. */
  wide?:        boolean
}

export const NOTE_CATEGORIES = [
  'general', 'contact', 'login', 'dns', 'hosting',
  'access', 'billing', 'issue', 'change', 'preference',
] as const

export type NoteCategory = typeof NOTE_CATEGORIES[number]

export interface NoteTemplate {
  key:   NoteCategory
  label: string
  /** One-line hint shown under the category picker. */
  hint:  string
  /** Accent colour for the category chip. */
  color: string
  /** This category can hold an encrypted credential (client_notes.secret_enc). */
  hasSecret?: boolean
  /** Saving a note in this category stamps clients.last_contacted_at. */
  stampsContact?: boolean
  /** Label for the freeform body in this category. */
  bodyLabel: string
  fields: NoteField[]
}

export const NOTE_TEMPLATES: Record<NoteCategory, NoteTemplate> = {
  general: {
    key: 'general', label: 'General', hint: 'Plain note, no structure.',
    color: '#64748b', bodyLabel: 'Note',
    fields: [],
  },

  contact: {
    key: 'contact', label: 'Contact log', hint: 'Logs a touchpoint and updates Last contacted.',
    color: '#0ea5e9', bodyLabel: 'What was discussed', stampsContact: true,
    fields: [
      { key: 'channel',     label: 'Channel',       type: 'select', options: ['Call', 'Email', 'Text', 'Meeting', 'Video call', 'Other'] },
      { key: 'direction',   label: 'Direction',     type: 'select', options: ['Outbound', 'Inbound'] },
      { key: 'who',         label: 'Spoke with',    type: 'text',   placeholder: 'Name at the client' },
      { key: 'occurred_on', label: 'Date',          type: 'date' },
      { key: 'outcome',     label: 'Outcome',       type: 'select', options: ['Positive', 'Neutral', 'Concerned', 'No answer', 'Left voicemail'] },
      { key: 'next_step',   label: 'Next step',     type: 'text',   placeholder: 'What we owe them' },
      { key: 'next_due',    label: 'Next step due', type: 'date' },
    ],
  },

  login: {
    key: 'login', label: 'Login', hint: 'Credentials for a service. The password is encrypted at rest.',
    color: '#f59e0b', bodyLabel: 'Access notes', hasSecret: true,
    fields: [
      { key: 'service',    label: 'Service',        type: 'text', placeholder: 'WordPress admin, Cloudflare, ...' },
      { key: 'url',        label: 'Login URL',      type: 'url',  placeholder: 'https://.../wp-admin' },
      { key: 'username',   label: 'Username',       type: 'text' },
      { key: 'vault_item', label: 'Vault item',     type: 'text', placeholder: 'Optional — 1Password / Bitwarden item, if you keep one' },
      { key: 'mfa',        label: 'MFA',            type: 'select', options: ['None', 'TOTP app', 'SMS', 'Email', 'Hardware key', 'Backup codes in vault'] },
      { key: 'held_by',    label: 'Who has access', type: 'text' },
    ],
  },

  // Registrar and DNS host are frequently different companies with different
  // logins, so `login_for` says which account the stored credential opens.
  // A domain needing both gets two notes — one credential per note keeps
  // "which password is this?" unambiguous.
  dns: {
    key: 'dns', label: 'DNS', hint: 'Registrar, nameservers, records — and the login for them.',
    color: '#8b5cf6', bodyLabel: 'Records / notes', hasSecret: true,
    fields: [
      { key: 'domain',      label: 'Domain',         type: 'text', placeholder: 'example.com' },
      { key: 'registrar',   label: 'Registrar',      type: 'text', placeholder: 'GoDaddy, Namecheap, ...' },
      { key: 'dns_host',    label: 'DNS host',       type: 'text', placeholder: 'Cloudflare, registrar, ...' },
      { key: 'login_for',   label: 'Login is for',   type: 'select', options: ['Registrar', 'DNS host', 'Both (same account)'] },
      { key: 'login_url',   label: 'Login URL',      type: 'url',  placeholder: 'https://dash.cloudflare.com' },
      { key: 'username',    label: 'Username',       type: 'text' },
      { key: 'mfa',         label: 'MFA',            type: 'select', options: ['None', 'TOTP app', 'SMS', 'Email', 'Hardware key', 'Backup codes below'] },
      { key: 'nameservers', label: 'Nameservers',    type: 'textarea', wide: true, placeholder: 'ns1....\nns2....' },
      { key: 'expires_on',  label: 'Domain expires', type: 'date' },
      { key: 'auto_renew',  label: 'Auto-renew',     type: 'select', options: ['On', 'Off', 'Unknown'] },
    ],
  },

  // Same reasoning as DNS: a control-panel URL without somewhere to put the
  // password just sends people back to a spreadsheet.
  hosting: {
    key: 'hosting', label: 'Hosting', hint: 'Server, control panel, SSL — and the login for them.',
    color: '#14b8a6', bodyLabel: 'Notes', hasSecret: true,
    fields: [
      { key: 'provider',     label: 'Host',          type: 'text', placeholder: 'WP Engine, SiteGround, ...' },
      { key: 'plan',         label: 'Plan',          type: 'text' },
      { key: 'panel_url',    label: 'Control panel', type: 'url' },
      { key: 'username',     label: 'Username',      type: 'text' },
      { key: 'mfa',          label: 'MFA',           type: 'select', options: ['None', 'TOTP app', 'SMS', 'Email', 'Hardware key', 'Backup codes below'] },
      { key: 'php_version',  label: 'PHP version',   type: 'text' },
      { key: 'ssl_provider', label: 'SSL provider',  type: 'text' },
      { key: 'ssl_expires',  label: 'SSL expires',   type: 'date' },
      { key: 'backups',      label: 'Backups',       type: 'text', wide: true, placeholder: 'Where they live + cadence' },
    ],
  },

  access: {
    key: 'access', label: 'Platform access', hint: 'What we were granted, on which account.',
    color: '#3b82f6', bodyLabel: 'Notes',
    fields: [
      { key: 'platform',   label: 'Platform',     type: 'select', options: ['Google Analytics', 'Search Console', 'Google Ads', 'Meta Ads', 'Google Business Profile', 'Bing', 'TikTok', 'LinkedIn', 'Other'] },
      { key: 'account_id', label: 'Account ID',   type: 'text' },
      { key: 'level',      label: 'Access level', type: 'select', options: ['Admin', 'Edit', 'Standard', 'Read only'] },
      { key: 'granted_to', label: 'Granted to',   type: 'text', placeholder: 'Which of our accounts' },
      { key: 'granted_on', label: 'Granted on',   type: 'date' },
    ],
  },

  billing: {
    key: 'billing', label: 'Billing', hint: 'Plan, contract dates, payment.',
    color: '#22c55e', bodyLabel: 'Notes',
    fields: [
      { key: 'plan',           label: 'Plan',           type: 'text' },
      { key: 'mrr',            label: 'MRR',            type: 'number', placeholder: '1500' },
      { key: 'contract_start', label: 'Contract start', type: 'date' },
      { key: 'contract_end',   label: 'Contract end',   type: 'date' },
      { key: 'renewal',        label: 'Renews',         type: 'select', options: ['Monthly', 'Quarterly', 'Annually', 'Manual'] },
      { key: 'payment_method', label: 'Payment method', type: 'text', placeholder: 'Card on file, ACH, invoice' },
    ],
  },

  issue: {
    key: 'issue', label: 'Issue', hint: 'Something broke; track it to resolution.',
    color: '#ef4444', bodyLabel: 'Symptom & detail',
    fields: [
      { key: 'severity',    label: 'Severity',    type: 'select', options: ['Low', 'Medium', 'High', 'Critical'] },
      { key: 'reported_by', label: 'Reported by', type: 'text' },
      { key: 'reported_on', label: 'Reported on', type: 'date' },
      { key: 'state',       label: 'Status',      type: 'select', options: ['Open', 'Investigating', 'Waiting on client', 'Resolved', 'Will not fix'] },
      { key: 'resolution',  label: 'Resolution',  type: 'textarea', wide: true },
    ],
  },

  change: {
    key: 'change', label: 'Change log', hint: 'What we changed and how to undo it.',
    color: '#a855f7', bodyLabel: 'Detail',
    fields: [
      { key: 'what',       label: 'What changed',  type: 'text', wide: true },
      { key: 'reason',     label: 'Why',           type: 'text', wide: true },
      { key: 'changed_on', label: 'Changed on',    type: 'date' },
      { key: 'area',       label: 'Area',          type: 'select', options: ['Website', 'DNS', 'Hosting', 'Google Ads', 'Meta Ads', 'Tracking', 'Content', 'Other'] },
      { key: 'rollback',   label: 'Rollback plan', type: 'textarea', wide: true },
    ],
  },

  preference: {
    key: 'preference', label: 'Client preference', hint: 'Standing rules — brand voice, things to avoid.',
    color: '#ec4899', bodyLabel: 'Detail',
    fields: [
      { key: 'brand_voice',  label: 'Brand voice',        type: 'text', wide: true, placeholder: 'Friendly but not casual, no exclamation marks...' },
      { key: 'avoid',        label: 'Never mention',      type: 'textarea', wide: true, placeholder: 'Competitors, discontinued services, pricing...' },
      { key: 'approval',     label: 'Approval needed',    type: 'select', options: ['No - publish freely', 'Yes - every post', 'Yes - first of each month'] },
      { key: 'contact_pref', label: 'Prefers contact by', type: 'select', options: ['Email', 'Phone', 'Text', 'Whatever'] },
    ],
  },
}

export const NOTE_TEMPLATE_LIST: NoteTemplate[] = NOTE_CATEGORIES.map(c => NOTE_TEMPLATES[c])

export function isNoteCategory(v: unknown): v is NoteCategory {
  return typeof v === 'string' && (NOTE_CATEGORIES as readonly string[]).includes(v)
}

/** Categories whose notes update clients.last_contacted_at. */
export function categoryStampsContact(c: string): boolean {
  return isNoteCategory(c) && NOTE_TEMPLATES[c].stampsContact === true
}

/**
 * Drop unknown keys and blank answers so `fields` only ever holds values the
 * template actually declares. Keeps the JSONB from accumulating junk when a
 * template changes shape.
 */
export function sanitizeNoteFields(
  category: string,
  raw: unknown,
): Record<string, string> {
  if (!isNoteCategory(category) || raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const allowed = new Set(NOTE_TEMPLATES[category].fields.map(f => f.key))
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.has(k) || v == null) continue
    const s = String(v).trim()
    if (s) out[k] = s.slice(0, 2000)
  }
  return out
}

/**
 * Flatten a note into one lowercase haystack so the filter box matches on
 * structured answers as well as the title and body.
 */
export function noteSearchText(n: {
  title?:    string | null
  content?:  string | null
  category?: string | null
  fields?:   Record<string, unknown> | null
}): string {
  const cat = isNoteCategory(n.category ?? '') ? NOTE_TEMPLATES[n.category as NoteCategory].label : ''
  return [
    n.title ?? '',
    n.content ?? '',
    cat,
    ...Object.values(n.fields ?? {}).map(v => (v == null ? '' : String(v))),
  ].join(' ').toLowerCase()
}

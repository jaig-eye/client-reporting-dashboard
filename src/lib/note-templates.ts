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

/**
 * Where a field shows up in the composer.
 *
 * - (unset)  essential: always shown when the category is picked.
 * - 'more'   optional: tucked behind a "More details" disclosure.
 * - 'legacy' retired from the composer. It stays declared so notes that already
 *            hold a value still display it, the editor still shows it (only when
 *            it has a value), and the API still accepts and keeps it.
 *
 * Never delete a field outright: sanitizeNoteFields drops undeclared keys, so
 * removing a declaration would silently erase existing answers on the next edit.
 */
export type NoteFieldTier = 'more' | 'legacy'

export interface NoteField {
  key:          string
  label:        string
  type:         NoteFieldType
  placeholder?: string
  options?:     string[]
  /** Rendered full-width instead of in the 2-col grid. */
  wide?:        boolean
  tier?:        NoteFieldTier
}

export const NOTE_CATEGORIES = [
  'general', 'contact', 'login', 'dns', 'hosting',
  'access', 'billing', 'issue', 'change', 'preference',
  'client_update',
] as const

export type NoteCategory = typeof NOTE_CATEGORIES[number]

/** Theme tone for a category's pill; maps to design tokens in globals.css (.note-tone--*). */
export type NoteTone = 'neutral' | 'blue' | 'amber' | 'green' | 'red'

export interface NoteTemplate {
  key:   NoteCategory
  label: string
  /** One-line hint shown in the composer. */
  hint:  string
  tone:  NoteTone
  /** This category can hold an encrypted credential (client_notes.secret_enc). */
  hasSecret?: boolean
  /** Saving a note in this category stamps clients.last_contacted_at. */
  stampsContact?: boolean
  /**
   * Shown to the client on their dashboard (Overview, "From your team"). Only title, body,
   * the next_up field and the date are ever sent; never the author, other fields or a secret.
   */
  clientVisible?: boolean
  /** Placeholder for the freeform body in this category. */
  bodyLabel: string
  fields: NoteField[]
}

export const NOTE_TEMPLATES: Record<NoteCategory, NoteTemplate> = {
  general: {
    key: 'general', label: 'General', hint: 'Plain note, no structure.',
    tone: 'neutral', bodyLabel: 'Write a note',
    fields: [],
  },

  contact: {
    key: 'contact', label: 'Contact log', hint: 'Logs a touchpoint and updates Last contacted.',
    tone: 'blue', bodyLabel: 'What was discussed', stampsContact: true,
    fields: [
      { key: 'channel',     label: 'Channel',       type: 'select', options: ['Call', 'Email', 'Text', 'Meeting', 'Video call', 'Other'] },
      { key: 'who',         label: 'Spoke with',    type: 'text',   placeholder: 'Name at the client' },
      { key: 'occurred_on', label: 'Date',          type: 'date',   tier: 'more' },
      { key: 'outcome',     label: 'Outcome',       type: 'select', tier: 'more', options: ['Positive', 'Neutral', 'Concerned', 'No answer', 'Left voicemail'] },
      { key: 'next_step',   label: 'Next step',     type: 'text',   tier: 'more', placeholder: 'What we owe them' },
      { key: 'next_due',    label: 'Next step due', type: 'date',   tier: 'more' },
      { key: 'direction',   label: 'Direction',     type: 'select', tier: 'legacy', options: ['Outbound', 'Inbound'] },
    ],
  },

  login: {
    key: 'login', label: 'Login', hint: 'Credentials for a service. The password is encrypted at rest.',
    tone: 'amber', bodyLabel: 'Access notes', hasSecret: true,
    fields: [
      { key: 'service',    label: 'Service',        type: 'text', placeholder: 'WordPress admin, Cloudflare, ...' },
      { key: 'username',   label: 'Username',       type: 'text' },
      { key: 'url',        label: 'Login URL',      type: 'url',  wide: true, placeholder: 'https://.../wp-admin' },
      { key: 'mfa',        label: 'MFA',            type: 'select', tier: 'more', options: ['None', 'TOTP app', 'SMS', 'Email', 'Hardware key', 'Backup codes in vault'] },
      { key: 'vault_item', label: 'Vault item',     type: 'text', tier: 'more', placeholder: '1Password / Bitwarden item' },
      { key: 'held_by',    label: 'Who has access', type: 'text', tier: 'more' },
    ],
  },

  // Registrar and DNS host are frequently different companies with different
  // logins, so `login_for` says which account the stored credential opens.
  // A domain needing both gets two notes — one credential per note keeps
  // "which password is this?" unambiguous.
  dns: {
    key: 'dns', label: 'DNS', hint: 'Registrar and DNS login. The password is encrypted at rest.',
    tone: 'amber', bodyLabel: 'Records / notes', hasSecret: true,
    fields: [
      { key: 'domain',      label: 'Domain',         type: 'text', placeholder: 'example.com' },
      { key: 'registrar',   label: 'Registrar',      type: 'text', placeholder: 'GoDaddy, Namecheap, ...' },
      { key: 'username',    label: 'Username',       type: 'text' },
      { key: 'login_url',   label: 'Login URL',      type: 'url',  placeholder: 'https://dash.cloudflare.com' },
      { key: 'dns_host',    label: 'DNS host',       type: 'text', tier: 'more', placeholder: 'Cloudflare, registrar, ...' },
      { key: 'login_for',   label: 'Login is for',   type: 'select', tier: 'more', options: ['Registrar', 'DNS host', 'Both (same account)'] },
      { key: 'mfa',         label: 'MFA',            type: 'select', tier: 'more', options: ['None', 'TOTP app', 'SMS', 'Email', 'Hardware key', 'Backup codes below'] },
      { key: 'expires_on',  label: 'Domain expires', type: 'date',   tier: 'more' },
      { key: 'auto_renew',  label: 'Auto-renew',     type: 'select', tier: 'more', options: ['On', 'Off', 'Unknown'] },
      { key: 'nameservers', label: 'Nameservers',    type: 'textarea', tier: 'more', wide: true, placeholder: 'ns1....\nns2....' },
    ],
  },

  // Same reasoning as DNS: a control-panel URL without somewhere to put the
  // password just sends people back to a spreadsheet.
  hosting: {
    key: 'hosting', label: 'Hosting', hint: 'Host and control-panel login. The password is encrypted at rest.',
    tone: 'amber', bodyLabel: 'Notes', hasSecret: true,
    fields: [
      { key: 'provider',     label: 'Host',          type: 'text', placeholder: 'WP Engine, SiteGround, ...' },
      { key: 'username',     label: 'Username',      type: 'text' },
      { key: 'panel_url',    label: 'Control panel', type: 'url',  wide: true },
      { key: 'plan',         label: 'Plan',          type: 'text', tier: 'more' },
      { key: 'mfa',          label: 'MFA',           type: 'select', tier: 'more', options: ['None', 'TOTP app', 'SMS', 'Email', 'Hardware key', 'Backup codes below'] },
      { key: 'ssl_expires',  label: 'SSL expires',   type: 'date', tier: 'more' },
      { key: 'backups',      label: 'Backups',       type: 'text', tier: 'more', wide: true, placeholder: 'Where they live + cadence' },
      { key: 'php_version',  label: 'PHP version',   type: 'text', tier: 'legacy' },
      { key: 'ssl_provider', label: 'SSL provider',  type: 'text', tier: 'legacy' },
    ],
  },

  access: {
    key: 'access', label: 'Platform access', hint: 'What we were granted, on which account.',
    tone: 'blue', bodyLabel: 'Notes',
    fields: [
      { key: 'platform',   label: 'Platform',     type: 'select', options: ['Google Analytics', 'Search Console', 'Google Ads', 'Meta Ads', 'Google Business Profile', 'Bing', 'TikTok', 'LinkedIn', 'Other'] },
      { key: 'level',      label: 'Access level', type: 'select', options: ['Admin', 'Edit', 'Standard', 'Read only'] },
      { key: 'account_id', label: 'Account ID',   type: 'text', tier: 'more' },
      { key: 'granted_to', label: 'Granted to',   type: 'text', tier: 'more', placeholder: 'Which of our accounts' },
      { key: 'granted_on', label: 'Granted on',   type: 'date', tier: 'more' },
    ],
  },

  billing: {
    key: 'billing', label: 'Billing', hint: 'Plan, contract dates, payment.',
    tone: 'green', bodyLabel: 'Notes',
    fields: [
      { key: 'plan',           label: 'Plan',           type: 'text', tier: 'more' },
      { key: 'mrr',            label: 'MRR',            type: 'number', tier: 'more', placeholder: '1500' },
      { key: 'contract_end',   label: 'Contract end',   type: 'date', tier: 'more' },
      { key: 'renewal',        label: 'Renews',         type: 'select', tier: 'more', options: ['Monthly', 'Quarterly', 'Annually', 'Manual'] },
      { key: 'contract_start', label: 'Contract start', type: 'date', tier: 'legacy' },
      { key: 'payment_method', label: 'Payment method', type: 'text', tier: 'legacy', placeholder: 'Card on file, ACH, invoice' },
    ],
  },

  issue: {
    key: 'issue', label: 'Issue', hint: 'Something broke; track it to resolution.',
    tone: 'red', bodyLabel: 'What happened',
    fields: [
      { key: 'severity',    label: 'Severity',    type: 'select', options: ['Low', 'Medium', 'High', 'Critical'] },
      { key: 'state',       label: 'Status',      type: 'select', options: ['Open', 'Investigating', 'Waiting on client', 'Resolved', 'Will not fix'] },
      { key: 'resolution',  label: 'Resolution',  type: 'textarea', tier: 'more', wide: true },
      { key: 'reported_by', label: 'Reported by', type: 'text', tier: 'legacy' },
      { key: 'reported_on', label: 'Reported on', type: 'date', tier: 'legacy' },
    ],
  },

  change: {
    key: 'change', label: 'Change log', hint: 'What we changed and how to undo it.',
    tone: 'neutral', bodyLabel: 'What changed and why',
    fields: [
      { key: 'area',       label: 'Area',          type: 'select', options: ['Website', 'DNS', 'Hosting', 'Google Ads', 'Meta Ads', 'Tracking', 'Content', 'Other'] },
      { key: 'rollback',   label: 'Rollback plan', type: 'textarea', tier: 'more', wide: true },
      { key: 'changed_on', label: 'Changed on',    type: 'date', tier: 'legacy' },
      { key: 'what',       label: 'What changed',  type: 'text', tier: 'legacy', wide: true },
      { key: 'reason',     label: 'Why',           type: 'text', tier: 'legacy', wide: true },
    ],
  },

  preference: {
    key: 'preference', label: 'Preference', hint: 'Standing rules — brand voice, things to avoid.',
    tone: 'neutral', bodyLabel: 'The preference',
    fields: [
      { key: 'approval',     label: 'Approval needed',    type: 'select', tier: 'more', options: ['No - publish freely', 'Yes - every post', 'Yes - first of each month'] },
      { key: 'contact_pref', label: 'Prefers contact by', type: 'select', tier: 'more', options: ['Email', 'Phone', 'Text', 'Whatever'] },
      { key: 'brand_voice',  label: 'Brand voice',        type: 'text', tier: 'legacy', wide: true },
      { key: 'avoid',        label: 'Never mention',      type: 'textarea', tier: 'legacy', wide: true },
    ],
  },

  // The one category the client sees. Write it for them, in plain words: what we did and
  // what's next. Never a credential, an internal opinion or anything about pricing.
  client_update: {
    key: 'client_update', label: 'Client update',
    hint: "Shown to the client on their dashboard. Write it for them: what we did, and what's next.",
    tone: 'green', clientVisible: true,
    bodyLabel: 'What we did (one point per line, **bold** for emphasis)',
    fields: [
      { key: 'next_up', label: "What's next", type: 'textarea', wide: true, placeholder: 'One point per line' },
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
 * Whether this category is allowed to carry a stored credential.
 *
 * The UI only offers the secret field on login/dns/hosting, but the UI is not a
 * boundary: the API accepted `secret` on any category, so a credential could be
 * written onto (say) a billing note where nothing in the interface would ever
 * show it was there — invisible, undeletable through the app, and still
 * decryptable through the reveal endpoint.
 */
export function categoryHoldsSecret(c: string): boolean {
  return isNoteCategory(c) && NOTE_TEMPLATES[c].hasSecret === true
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

'use client'

// Campaign categories: the list, what each display mode shows, and adding or deleting one.
// Adding happens in a dialog; deleting asks first. Changes go through the categories API.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Tag } from '@phosphor-icons/react'
import type { CampaignCategory, CategoryDisplayMode } from '@/lib/types'
import PageHeader from '@/components/ui/PageHeader'
import Section from '@/components/ui/Section'
import Field from '@/components/ui/Field'
import StatusBadge from '@/components/ui/StatusBadge'
import EmptyState from '@/components/ui/EmptyState'
import Dialog, { ConfirmDialog } from '@/components/ui/Dialog'

const DISPLAY_MODES: { value: CategoryDisplayMode; label: string; shows: string }[] = [
  { value: 'lead_gen',   label: 'Lead gen',   shows: 'Cost per lead and the number of leads. No ROAS.'   },
  { value: 'ecommerce',  label: 'Ecommerce',  shows: 'ROAS, revenue and the number of purchases.'         },
  { value: 'awareness',  label: 'Awareness',  shows: 'Impressions, CPM, reach and frequency.'             },
  { value: 'engagement', label: 'Engagement', shows: 'Clicks, CTR and engagement rate.'                   },
  { value: 'custom',     label: 'Custom',     shows: 'The metrics you set up for it.'                     },
]

// Colours a category can be: data stored on the category, not styling.
const PRESET_COLORS = [
  { value: '#3b82f6', label: 'Blue' },   { value: '#10b981', label: 'Green' },
  { value: '#8b5cf6', label: 'Violet' }, { value: '#f59e0b', label: 'Amber' },
  { value: '#06b6d4', label: 'Cyan' },   { value: '#ef4444', label: 'Red' },
  { value: '#ec4899', label: 'Pink' },   { value: '#6b7280', label: 'Grey' },
]

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: n % 1 ? 2 : 0 })

interface Props {
  categories: CampaignCategory[]
}

const BLANK = { name: '', color: '#3b82f6', mode: 'lead_gen' as CategoryDisplayMode, label: 'Leads', value: '0' }

export default function CategoryEditor({ categories: initial }: Props) {
  const router = useRouter()
  // The list comes from the server on every refresh, so a category added here shows up. (Holding it
  // in state, as this used to, froze it at first load: an added category never appeared.) Only
  // deletions are remembered locally, to drop a row before the refresh lands.
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set())
  const categories = initial.filter(c => !removed.has(c.id))
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [addError, setAddError] = useState('')
  const [draft, setDraft] = useState(BLANK)
  const [deleting, setDeleting] = useState<CampaignCategory | null>(null)

  function openAdd() { setDraft(BLANK); setAddError(''); setAdding(true) }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!draft.name.trim()) return
    setSaving(true)
    setAddError('')
    try {
      const res = await fetch('/api/admin/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:                    draft.name.trim(),
          color:                   draft.color,
          display_mode:            draft.mode,
          conversion_label:        draft.label.trim() || 'Conversions',
          default_conversion_value: parseFloat(draft.value) || 0,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(d.error || 'The category wasn’t added. Try again.')
      }
      setAdding(false)
      router.refresh()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'The category wasn’t added. Try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleting) return
    const res = await fetch(`/api/admin/categories/${deleting.id}`, { method: 'DELETE' }).catch(() => null)
    // A failed delete used to vanish from the list anyway (only a network error was caught).
    if (!res) throw new Error('No answer from the server. Check your connection and try again.')
    if (!res.ok) {
      const d = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(d.error || `“${deleting.name}” wasn’t deleted.`)
    }
    setRemoved(prev => new Set(prev).add(deleting.id))
    setDeleting(null)
    router.refresh()
  }

  const addButton = <button type="button" className="btn btn-primary" onClick={openAdd}><Plus size={15} weight="bold" aria-hidden />Add category</button>
  const mode = DISPLAY_MODES.find(m => m.value === draft.mode)

  return (
    <div>
      <PageHeader
        back={{ href: '/admin/settings', label: 'Agency settings' }}
        title="Campaign categories"
        description="How campaigns are grouped across every client, and which numbers each group’s dashboard leads with."
        actions={addButton}
      />

      <div className="ui-stack">
      <Section title="Categories" flush={categories.length > 0}>
        {categories.length === 0 ? (
          <EmptyState icon={<Tag size={22} weight="duotone" />} title="No categories yet" actions={addButton}>
            Add one for each kind of campaign you run, such as lead generation or an online store.
          </EmptyState>
        ) : (
          categories.map(cat => {
            const m = DISPLAY_MODES.find(d => d.value === cat.display_mode)
            return (
              <div key={cat.id} className="ui-row">
                <span className="ui-tile" aria-hidden><span className="ui-dot" style={{ '--sw': cat.color, width: 12, height: 12 } as React.CSSProperties} /></span>
                <div className="ui-row-text">
                  <div className="ui-row-title">
                    <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{cat.name}</span>
                    {cat.is_default && <StatusBadge tone="info" dot={false}>Default</StatusBadge>}
                  </div>
                  <p className="ui-row-sub" style={{ margin: 0 }}>
                    {m?.label ?? cat.display_mode} · Counts {cat.conversion_label.toLowerCase()}
                    {cat.default_conversion_value > 0 && <> · Each worth {money(cat.default_conversion_value)}</>}
                  </p>
                </div>
                <div className="ui-row-actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDeleting(cat)}>Delete</button>
                </div>
              </div>
            )
          })
        )}
      </Section>

      <Section title="What each display mode shows" description="The mode decides which metrics a category’s campaigns lead with on client dashboards.">
        <dl className="ui-grid-2" style={{ margin: 0, gap: '14px 24px' }}>
          {DISPLAY_MODES.filter(m => m.value !== 'custom').map(m => (
            <div key={m.value}>
              <dt className="ui-setting-title" style={{ fontSize: '0.8125rem' }}>{m.label}</dt>
              <dd className="ui-setting-desc" style={{ margin: '2px 0 0' }}>{m.shows}</dd>
            </div>
          ))}
        </dl>
      </Section>
      </div>

      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a category"
        description="It’s available to every client’s campaigns straight away."
        busy={saving}
        footer={<>
          <button type="button" className="btn btn-secondary" onClick={() => setAdding(false)} disabled={saving}>Cancel</button>
          <button type="submit" form="cat-add" className="btn btn-primary" disabled={saving || !draft.name.trim()}>{saving ? 'Adding…' : 'Add category'}</button>
        </>}
      >
        <form id="cat-add" onSubmit={handleAdd} className="ui-fields">
          <Field label="Name" id="cat-name">
            <input id="cat-name" className="input" required placeholder="Lead generation" autoComplete="off"
              value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
          </Field>
          <Field label="Display mode" id="cat-mode" hint={mode ? `Shows ${mode.shows.charAt(0).toLowerCase()}${mode.shows.slice(1)}` : undefined}>
            <select id="cat-mode" className="input" aria-describedby="cat-mode-hint"
              value={draft.mode} onChange={e => setDraft(d => ({ ...d, mode: e.target.value as CategoryDisplayMode }))}>
              {DISPLAY_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
          <div className="ui-grid-2">
            <Field label="What a conversion is called" id="cat-label">
              <input id="cat-label" className="input" placeholder="Leads" autoComplete="off"
                value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} />
            </Field>
            <Field label="Value of one ($)" id="cat-value" hint="0 if it varies.">
              <input id="cat-value" className="input" type="number" min="0" step="0.01" aria-describedby="cat-value-hint"
                value={draft.value} onChange={e => setDraft(d => ({ ...d, value: e.target.value }))} />
            </Field>
          </div>
          <div className="ui-field">
            <span className="ui-field-label" id="cat-color-label">Color</span>
            <div className="ui-swatches" role="radiogroup" aria-labelledby="cat-color-label">
              {PRESET_COLORS.map(c => (
                <button key={c.value} type="button" role="radio" aria-checked={draft.color === c.value} aria-label={c.label} title={c.label}
                  className="ui-swatch" style={{ '--sw': c.value } as React.CSSProperties}
                  onClick={() => setDraft(d => ({ ...d, color: c.value }))} />
              ))}
              <input type="color" className="ui-swatch-custom" aria-label="Custom color" title="Custom color"
                value={draft.color} onChange={e => setDraft(d => ({ ...d, color: e.target.value }))} />
            </div>
          </div>
          {addError && <div className="ui-notice ui-notice--danger" role="alert" style={{ margin: 0 }}>{addError}</div>}
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.name ?? ''}”?`}
        confirmLabel="Delete category"
        busyLabel="Deleting…"
        tone="danger"
        onConfirm={handleDelete}
      >
        <p>Campaigns in it become uncategorized. This can’t be undone.</p>
      </ConfirmDialog>
    </div>
  )
}

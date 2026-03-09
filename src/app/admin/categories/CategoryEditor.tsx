'use client'

// Interactive category editor.
// Renders existing categories as editable rows + an "Add category" form.
// Changes are submitted via API routes.

import { useState } from 'react'
import type { CampaignCategory, CategoryDisplayMode } from '@/lib/types'
import { useRouter } from 'next/navigation'

const DISPLAY_MODES: { value: CategoryDisplayMode; label: string }[] = [
  { value: 'lead_gen',   label: 'Lead Gen'   },
  { value: 'ecommerce',  label: 'Ecommerce'  },
  { value: 'awareness',  label: 'Awareness'  },
  { value: 'engagement', label: 'Engagement' },
  { value: 'custom',     label: 'Custom'     },
]

const PRESET_COLORS = [
  '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b',
  '#06b6d4', '#ef4444', '#ec4899', '#6b7280',
]

interface Props {
  categories: CampaignCategory[]
}

export default function CategoryEditor({ categories: initial }: Props) {
  const router = useRouter()
  const [categories, setCategories] = useState(initial)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)

  // ── New category form state ──
  const [newName,    setNewName]    = useState('')
  const [newColor,   setNewColor]   = useState('#3b82f6')
  const [newMode,    setNewMode]    = useState<CategoryDisplayMode>('lead_gen')
  const [newLabel,   setNewLabel]   = useState('Leads')
  const [newValue,   setNewValue]   = useState('0')

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setSaving('new')
    try {
      const res = await fetch('/api/admin/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:                    newName.trim(),
          color:                   newColor,
          display_mode:            newMode,
          conversion_label:        newLabel.trim() || 'Conversions',
          default_conversion_value: parseFloat(newValue) || 0,
        }),
      })
      if (!res.ok) throw new Error('Failed')
      setAdding(false)
      setNewName(''); setNewColor('#3b82f6'); setNewMode('lead_gen'); setNewLabel('Leads'); setNewValue('0')
      router.refresh()
    } catch {
      alert('Failed to add category.')
    } finally {
      setSaving(null)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this category? Assigned campaigns will become uncategorized.')) return
    setSaving(id)
    try {
      await fetch(`/api/admin/categories/${id}`, { method: 'DELETE' })
      setCategories(prev => prev.filter(c => c.id !== id))
    } catch {
      alert('Failed to delete.')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div>
      {/* Existing categories */}
      <div className="card overflow-hidden mb-4">
        {categories.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              No categories yet. Add one below.
            </p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Display Mode</th>
                <th>Conversion Label</th>
                <th>Default Value</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {categories.map(cat => (
                <tr key={cat.id}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <div
                        className="h-3 w-3 rounded-full flex-shrink-0"
                        style={{ background: cat.color }}
                      />
                      <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                        {cat.name}
                      </span>
                      {cat.is_default && (
                        <span className="badge badge-blue" style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem' }}>
                          Default
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {DISPLAY_MODES.find(m => m.value === cat.display_mode)?.label ?? cat.display_mode}
                    </span>
                  </td>
                  <td>
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {cat.conversion_label}
                    </span>
                  </td>
                  <td>
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {cat.default_conversion_value > 0 ? `$${cat.default_conversion_value}` : '—'}
                    </span>
                  </td>
                  <td>
                    <button
                      onClick={() => handleDelete(cat.id)}
                      disabled={saving === cat.id}
                      className="btn btn-danger"
                      style={{ padding: '0.25rem 0.625rem', fontSize: '0.75rem' }}
                    >
                      {saving === cat.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add new category */}
      {!adding ? (
        <button onClick={() => setAdding(true)} className="btn btn-secondary">
          + Add Category
        </button>
      ) : (
        <form onSubmit={handleAdd} className="card p-5">
          <h3 className="section-title mb-4">New Category</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
                Name *
              </label>
              <input
                className="input"
                placeholder="e.g. Lead Generation"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
                Display Mode
              </label>
              <select
                className="input"
                value={newMode}
                onChange={e => setNewMode(e.target.value as CategoryDisplayMode)}
              >
                {DISPLAY_MODES.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
                Conversion Label
              </label>
              <input
                className="input"
                placeholder="e.g. Leads"
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
                Default Conversion Value ($)
              </label>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                placeholder="0"
                value={newValue}
                onChange={e => setNewValue(e.target.value)}
              />
            </div>
          </div>

          {/* Color picker */}
          <div className="mb-4">
            <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-muted)' }}>
              Color
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewColor(c)}
                  className="h-7 w-7 rounded-full transition-transform hover:scale-110"
                  style={{
                    background: c,
                    outline: newColor === c ? `3px solid ${c}` : 'none',
                    outlineOffset: '2px',
                  }}
                />
              ))}
              <input
                type="color"
                value={newColor}
                onChange={e => setNewColor(e.target.value)}
                className="h-7 w-10 rounded cursor-pointer border-0"
                title="Custom color"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button type="submit" className="btn btn-primary" disabled={saving === 'new'}>
              {saving === 'new' ? 'Adding…' : 'Add Category'}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="btn btn-ghost">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

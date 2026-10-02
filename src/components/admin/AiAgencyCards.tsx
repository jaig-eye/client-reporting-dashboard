'use client'

// Integrations → AI: the writing model and the featured-image key, connected once for the agency
// like every other service (they used to sit on their own Agency settings tab).
//
// Keys arrive masked (lib/secretMask), never in the clear: a client component's props are part of
// the page's HTML. Saving the untouched mask keeps the stored key; clearing the field removes it.

import { useState } from 'react'
import Link from 'next/link'
import { Sparkle, ImageSquare } from '@phosphor-icons/react'
import IntegrationCard  from '@/components/admin/IntegrationCard'
import IntegrationModal from '@/components/admin/IntegrationModal'
import Field from '@/components/ui/Field'
import { IMAGE_MODELS, DEFAULT_IMAGE_MODEL, resolveImageModel } from '@/lib/content/imageModels'

export default function AiAgencyCards({ initialProvider, initialModel, initialAiKey, initialImageKey, initialImageModel }: {
  initialProvider:   string
  initialModel:      string
  /** The mask when a key is stored, '' when not. */
  initialAiKey:      string
  initialImageKey:   string
  initialImageModel: string | null
}) {
  // What's saved
  const [provider,   setProvider]   = useState(initialProvider || 'anthropic')
  const [model,      setModel]      = useState(initialModel)
  const [aiKey,      setAiKey]      = useState(initialAiKey)
  const [imageKey,   setImageKey]   = useState(initialImageKey)
  const [imageModel, setImageModel] = useState<string>(resolveImageModel(initialImageModel))

  // The dialogs' drafts
  const [aiOpen,       setAiOpen]       = useState(false)
  const [draftProv,    setDraftProv]    = useState(provider)
  const [draftModel,   setDraftModel]   = useState(model)
  const [draftAiKey,   setDraftAiKey]   = useState(aiKey)
  const [aiJustSaved,  setAiJustSaved]  = useState(false)
  const [imgOpen,      setImgOpen]      = useState(false)
  const [draftImgKey,  setDraftImgKey]  = useState(imageKey)
  const [draftImgModel, setDraftImgModel] = useState(imageModel)
  const [imgJustSaved, setImgJustSaved] = useState(false)
  // The server's note when the key saved but the model could not (migration 227 not applied).
  const [imgWarning,   setImgWarning]   = useState('')

  function openAi()  { setDraftProv(provider); setDraftModel(model); setDraftAiKey(aiKey); setAiOpen(true) }
  function openImg() { setDraftImgKey(imageKey); setDraftImgModel(imageModel); setImgOpen(true) }

  async function saveAi() {
    const res = await fetch('/api/admin/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ai_provider: draftProv, ai_model: draftModel, ai_api_key: draftAiKey }),
    })
    if (!res.ok) { const d = await res.json().catch(() => ({})) as { error?: string }; throw new Error(d.error || 'Save failed') }
    setProvider(draftProv); setModel(draftModel); setAiKey(draftAiKey)
  }

  async function saveImg() {
    // The key is always sent: untouched it is still the mask ("keep"), cleared it is '' ("remove").
    // The model is sent only when it changed, so saving a key never depends on migration 227.
    const patch: Record<string, string> = { openai_api_key: draftImgKey }
    const modelChanged = draftImgModel !== imageModel
    if (modelChanged) patch.image_model = draftImgModel
    const res = await fetch('/api/admin/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const d = await res.json().catch(() => ({})) as { error?: string; warning?: string }
    if (!res.ok) throw new Error(d.error || 'Save failed')
    setImageKey(draftImgKey)
    if (modelChanged && !d.warning) setImageModel(draftImgModel)
    setImgWarning(d.warning ?? '')
  }

  return (
    <>
      <IntegrationCard
        icon={<Sparkle size={20} weight="duotone" />}
        name="Writing"
        description="The model that writes posts and suggests topics."
        isConnected={!!aiKey}
        connectedLabel={aiKey ? `${provider === 'openai' ? 'OpenAI' : 'Anthropic'}, ${model || 'default model'}` : undefined}
        onConfigure={openAi}
        justConnected={aiJustSaved}
      />
      <IntegrationCard
        icon={<ImageSquare size={20} weight="duotone" />}
        name="Featured images"
        description="An OpenAI key and image model, separate from the writing key."
        isConnected={!!imageKey}
        connectedLabel={imageKey ? `Key saved, ${IMAGE_MODELS[imageModel as keyof typeof IMAGE_MODELS]?.label ?? imageModel}` : undefined}
        onConfigure={openImg}
        justConnected={imgJustSaved}
      />
      {imgWarning && <div className="ui-notice ui-notice--warning" role="status" style={{ margin: '0 16px 12px' }}>{imgWarning}</div>}

      <IntegrationModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        onSaved={() => { setAiJustSaved(true); setTimeout(() => setAiJustSaved(false), 2000) }}
        title="Writing AI"
        icon={<Sparkle size={20} weight="duotone" />}
        isConnected={!!aiKey}
        howTo={
          <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
            <li><strong>OpenAI:</strong> in <strong>platform.openai.com → API keys</strong>, create a secret key (<code>sk-…</code>). Use the model <code>gpt-4o</code> or <code>gpt-4o-mini</code>.</li>
            <li><strong>Anthropic:</strong> in <strong>console.anthropic.com → API keys</strong>, create a key. Use the model <code>claude-sonnet-4-6</code>.</li>
            <li>The writing prompt itself is in <Link href="/admin/content/settings">Settings, Content</Link>.</li>
          </ol>
        }
        onSave={saveAi}
      >
        <Field label="Provider" id="ai-provider">
          <select id="ai-provider" className="input" value={draftProv} onChange={e => setDraftProv(e.target.value)}>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic (Claude)</option>
          </select>
        </Field>
        <Field label="Model" id="ai-model">
          <input id="ai-model" className="input" type="text" value={draftModel} onChange={e => setDraftModel(e.target.value)}
            placeholder={draftProv === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-6'} />
        </Field>
        <Field label="API key" id="ai-key" hint="Stored on the server and never shown to clients.">
          <input id="ai-key" className="input" type="password" value={draftAiKey} onChange={e => setDraftAiKey(e.target.value)}
            placeholder="Paste the key" autoComplete="off" aria-describedby="ai-key-hint" />
        </Field>
      </IntegrationModal>

      <IntegrationModal
        open={imgOpen}
        onClose={() => setImgOpen(false)}
        onSaved={() => { setImgJustSaved(true); setTimeout(() => setImgJustSaved(false), 2000) }}
        title="Featured images (OpenAI)"
        icon={<ImageSquare size={20} weight="duotone" />}
        isConnected={!!imageKey}
        howTo={
          <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
            <li>In <strong>platform.openai.com → API keys</strong>, create a secret key (<code>sk-…</code>).</li>
            <li>OpenAI may ask the organization to complete <strong>API Organization Verification</strong> before its GPT Image models can be used.</li>
            <li>This key is only used for featured images; it’s separate from the writing key.</li>
          </ol>
        }
        onSave={saveImg}
      >
        <Field
          label="OpenAI API key"
          id="img-openai-key"
          hint={imageKey ? 'Used only for featured images. Clear the field and save to remove the key.' : 'Used only for featured images.'}
        >
          <input id="img-openai-key" className="input" type="password" value={draftImgKey} onChange={e => setDraftImgKey(e.target.value)}
            placeholder="sk-…" autoComplete="off" aria-describedby="img-openai-key-hint" />
        </Field>
        <Field
          label="Model"
          id="img-model"
          hint="Each one is asked for the same 1536×1024 PNG, so switching needs nothing else changed. What it costs shows on the Usage page."
        >
          <select id="img-model" className="input" value={draftImgModel} onChange={e => setDraftImgModel(e.target.value)} aria-describedby="img-model-hint">
            {Object.entries(IMAGE_MODELS).map(([id, m]) => (
              <option key={id} value={id}>{m.label}{id === DEFAULT_IMAGE_MODEL ? ' (default)' : ''}</option>
            ))}
          </select>
        </Field>
      </IntegrationModal>
    </>
  )
}

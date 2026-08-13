'use client'

import { useState } from 'react'
import IntegrationCard  from '@/components/admin/IntegrationCard'
import IntegrationModal from '@/components/admin/IntegrationModal'

interface Props {
  initialBotToken:     string
  initialOpsChannelId: string
}

export default function DiscordAgencyCard({ initialBotToken, initialOpsChannelId }: Props) {
  const [open,          setOpen]          = useState(false)
  const [botToken,      setBotToken]      = useState(initialBotToken)
  const [opsChannelId,  setOpsChannelId]  = useState(initialOpsChannelId)
  const [isConnected,   setIsConnected]   = useState(!!initialBotToken)
  const [justSaved,     setJustSaved]     = useState(false)

  async function handleSave() {
    const res = await fetch('/api/admin/settings', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        discord_bot_token:      botToken.trim(),
        discord_ops_channel_id: opsChannelId.trim(),
      }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error((d as { error?: string }).error || 'Save failed')
    }
    setIsConnected(!!botToken.trim())
  }

  return (
    <>
      <IntegrationCard
        icon="🤖"
        name="Discord"
        description="Shared bot for all channel notifications. Each client's Channel ID is set in their Integrations tab."
        isConnected={isConnected}
        connectedLabel={isConnected ? 'Bot token configured' : undefined}
        onConfigure={() => setOpen(true)}
        justConnected={justSaved}
      />
      <IntegrationModal
        open={open}
        onClose={() => setOpen(false)}
        onSaved={() => { setJustSaved(true); setTimeout(() => setJustSaved(false), 2000) }}
        title="Discord"
        icon="🤖"
        isConnected={isConnected}
        howTo={
          <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
            <li>Go to <strong>discord.com/developers/applications</strong> and create a new application.</li>
            <li>Open the <strong>Bot</strong> section → click <strong>Add Bot</strong>.</li>
            <li>Under <strong>Token</strong>, click <strong>Reset Token</strong> and copy it.</li>
            <li>Invite the bot to your server via OAuth2 with the <strong>Send Messages</strong> and <strong>View Channels</strong> permissions.</li>
            <li>Each client&apos;s Channel ID is set in their Integrations tab (Discord card).</li>
          </ol>
        }
        onSave={handleSave}
      >
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>Bot Token</label>
          <input
            className="input"
            type="password"
            value={botToken}
            onChange={e => setBotToken(e.target.value)}
            placeholder="Bot token from Discord Developer Portal…"
            autoComplete="off"
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>
            Agency Ops Channel ID
          </label>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0 0 6px' }}>
            Internal channel that receives agency-side alerts (uptime, SSL, content review). Right-click the channel in Discord → Copy Channel ID.
          </p>
          <input
            className="input"
            type="text"
            value={opsChannelId}
            onChange={e => setOpsChannelId(e.target.value)}
            placeholder="e.g. 1234567890123456789"
            style={{ width: '100%' }}
          />
        </div>
      </IntegrationModal>
    </>
  )
}

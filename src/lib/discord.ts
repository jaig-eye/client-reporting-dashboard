export async function sendDiscordMessage(
  botToken: string | null | undefined,
  channelId: string | null | undefined,
  content: string,
): Promise<void> {
  if (!botToken || !channelId) return
  // Discord channel IDs are 17–20 digit snowflakes — reject anything else
  if (!/^\d{17,20}$/.test(channelId)) {
    console.warn(`[discord] Skipping message: invalid channel ID format "${channelId}"`)
    return
  }
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Discord API error ${res.status}: ${text}`)
  }
}

export async function sendDiscordMessage(
  botToken: string,
  channelId: string,
  content: string,
): Promise<void> {
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

// A post's site belongs to the post's client, always.
//
// content_posts.connection_id is a plain column the editor writes on every save. The publish
// routes already refuse a connection from another client, but nothing stopped one being SAVED:
// the monthly review handed the editor every client's sites and the editor, finding none for a
// client with no site yet, pre-selected the first BigCommerce store it saw — another client's —
// and the next save wrote it to the row. Every write of connection_id goes through this check.

import type { SupabaseClient } from '@supabase/supabase-js'

export const FOREIGN_CONNECTION_ERROR = 'That site belongs to a different client. Choose one of this client’s own sites.'

/**
 * Whether `connectionId` may be saved on post `postId`: null (no site) always may; a connection
 * only when it belongs to the post's client. False when the post or the connection can't be read.
 */
export async function connectionAllowedForPost(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  postId: string,
  connectionId: string | null,
): Promise<boolean> {
  if (!connectionId) return true
  const { data: post } = await db.from('content_posts').select('client_id').eq('id', postId).maybeSingle()
  const clientId = (post as { client_id?: string } | null)?.client_id
  if (!clientId) return false
  const { data: conn } = await db
    .from('client_connections')
    .select('id')
    .eq('id', connectionId)
    .eq('client_id', clientId)
    .maybeSingle()
  return conn != null
}

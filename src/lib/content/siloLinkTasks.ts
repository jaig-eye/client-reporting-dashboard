// ─────────────────────────────────────────────────────────────────────────────
// Silo linking, as advice.
//
// A silo with a main (hub) page only works when the pages link to each other. The new article
// already links to the main page and to the set's earlier live posts: the writer is told to, and a
// person reviews that article before it goes out. The other direction means editing pages that
// are already live, and that is left to a person who can see the page.
//
// So when an article from such a set goes live, this records what to add and where: a link from
// the main page to it, and one from the post before it in the set. They are stored on
// content_silos.pending_links, shown on the set's card, and ticked off there.
//
// This replaces the approve route appending a "Related … Resources" list to the bottom of the
// live main page on WordPress, which put the link where nobody chose to put it.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * One link a person should add by hand. Older entries hold only `url`, `title` and `added_at`,
 * meaning "link to this from the main page".
 */
export interface SiloLinkTask {
  /** 'hub': on the main page. 'previous': in the set's previous live post. */
  kind:       'hub' | 'previous'
  /** The page to edit. */
  from_url:   string
  from_title: string
  /** The page to link to: the article that just went live. */
  url:        string
  title:      string
  /** Suggested anchor text: the article's keyword, or its title when it has none. */
  anchor:     string
  post_id:    string
  added_at:   string
}

/**
 * Record the links to add for an article that has just gone live. Does nothing for an article
 * outside a set, or in a set without a main page — those posts stand alone by design.
 */
export async function recordSiloLinkTasks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  args: { siloId: string; postId: string; url: string; title: string; keyword?: string | null },
): Promise<SiloLinkTask[]> {
  const { data: silo, error } = await db
    .from('content_silos')
    .select('name, hub_page_url, hub_page_title')
    .eq('id', args.siloId)
    .maybeSingle()
  if (error) throw new Error(`silo read failed: ${error.message}`)
  const s = silo as { name: string; hub_page_url: string | null; hub_page_title: string | null } | null
  if (!s?.hub_page_url) return []

  const now    = new Date().toISOString()
  const title  = args.title.trim() || args.url
  const anchor = (args.keyword ?? '').trim() || title
  const tasks: SiloLinkTask[] = [{
    kind: 'hub', from_url: s.hub_page_url, from_title: s.hub_page_title?.trim() || s.name,
    url: args.url, title, anchor, post_id: args.postId, added_at: now,
  }]

  // The set's previous live article, so the posts read as a series rather than a list of spokes.
  const { data: prev, error: prevErr } = await db
    .from('content_posts')
    .select('id, title, published_url')
    .eq('silo_id', args.siloId)
    .neq('id', args.postId)
    .not('published_url', 'is', null)
    .order('last_pushed_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (prevErr) console.warn('[siloLinkTasks] previous post read failed:', prevErr.message)
  const p = prev as { id: string; title: string | null; published_url: string } | null
  if (p?.published_url && p.published_url !== args.url) {
    tasks.push({
      kind: 'previous', from_url: p.published_url, from_title: p.title?.trim() || p.published_url,
      url: args.url, title, anchor, post_id: args.postId, added_at: now,
    })
  }

  // One append per task: the RPC concatenates atomically, so two articles going live together
  // cannot overwrite each other's entries.
  for (const link of tasks) {
    const { error: appendErr } = await db.rpc('append_silo_pending_link', { silo_id: args.siloId, link })
    if (appendErr) throw new Error(`recording a link task failed: ${appendErr.message}`)
  }
  return tasks
}

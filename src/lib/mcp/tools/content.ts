import type { SupabaseClient } from '@supabase/supabase-js'
import type { Tool, ToolResult } from '../types'
import { ok, fail, fmt } from '../types'

export const tools: Tool[] = [
  {
    name: 'list_topics',
    description: 'List content topics with filters. Returns topic, keyword, status, publish date, content type, and whether a post has been generated.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id:    { type: 'string', description: 'Filter by client UUID' },
        status:       { type: 'string', description: 'Filter by status (e.g. approved, generated, scheduled)' },
        content_type: { type: 'string', description: 'Filter by content type (blog, service_area, etc.)' },
        silo_id:      { type: 'string', description: 'Filter by silo UUID' },
        limit:        { type: 'number', description: 'Max rows to return (default 50, max 200)' },
      },
    },
  },
  {
    name: 'get_topic',
    description: 'Get full details for a single content topic including rationale, keyword strategy, and cluster info.',
    inputSchema: {
      type: 'object',
      properties: {
        topic_id: { type: 'string', description: 'UUID of the topic' },
      },
      required: ['topic_id'],
    },
  },
  {
    name: 'update_topic',
    description: 'Update mutable fields on a content topic (status, target_publish_date, rationale, target_keyword, suggested_title).',
    inputSchema: {
      type: 'object',
      properties: {
        topic_id:            { type: 'string', description: 'UUID of the topic' },
        status:              { type: 'string', description: 'New status' },
        target_publish_date: { type: 'string', description: 'ISO date string (YYYY-MM-DD)' },
        rationale:           { type: 'string', description: 'Updated rationale text' },
        target_keyword:      { type: 'string', description: 'Updated target keyword' },
        suggested_title:     { type: 'string', description: 'Updated suggested title' },
      },
      required: ['topic_id'],
    },
  },
  {
    name: 'create_topic',
    description: 'Create a new content topic for a client.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id:           { type: 'string', description: 'UUID of the client' },
        topic:               { type: 'string', description: 'Topic text / working title' },
        target_keyword:      { type: 'string', description: 'Primary SEO keyword' },
        content_type:        { type: 'string', description: 'blog | service_area | custom', enum: ['blog', 'service_area', 'custom'] },
        target_publish_date: { type: 'string', description: 'ISO date string (YYYY-MM-DD)' },
        silo_id:             { type: 'string', description: 'UUID of the silo to assign this topic to' },
        rationale:           { type: 'string', description: 'Why this topic matters for the client' },
      },
      required: ['client_id', 'topic', 'target_keyword', 'content_type'],
    },
  },
  {
    name: 'list_posts',
    description: 'List generated content posts with filters. Returns title, keyword, status, publish date, WP/BC IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Filter by client UUID' },
        status:    { type: 'string', description: 'Filter by status (for_review, draft_saved, published, etc.)' },
        silo_id:   { type: 'string', description: 'Filter by silo UUID' },
        limit:     { type: 'number', description: 'Max rows to return (default 50, max 200)' },
      },
    },
  },
  {
    name: 'get_post',
    description: 'Get a content post with full generated content, SEO fields, and metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        post_id:        { type: 'string', description: 'UUID of the post' },
        include_content: { type: 'boolean', description: 'Include the full HTML content body (default false — content can be large)' },
      },
      required: ['post_id'],
    },
  },
  {
    name: 'list_silos',
    description: 'List content silos (topical authority clusters). Shows name, hub URL, entity, section, and post coverage counts.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Filter by client UUID' },
      },
    },
  },
  {
    name: 'get_silo',
    description: 'Get full details for a content silo including keyword map and page plan stats.',
    inputSchema: {
      type: 'object',
      properties: {
        silo_id: { type: 'string', description: 'UUID of the silo' },
      },
      required: ['silo_id'],
    },
  },
  {
    name: 'list_silo_keywords',
    description: 'List all keywords in a silo\'s keyword map with type, intent, search volume, score, and ranking data.',
    inputSchema: {
      type: 'object',
      properties: {
        silo_id:       { type: 'string', description: 'UUID of the silo' },
        keyword_type:  { type: 'string', description: 'Filter by type: top_level | secondary_top_level | supporting' },
        selected_only: { type: 'boolean', description: 'Only return keywords marked as selected' },
      },
      required: ['silo_id'],
    },
  },
  {
    name: 'list_silo_pages',
    description: 'List planned/generated/published pages in a silo\'s content plan.',
    inputSchema: {
      type: 'object',
      properties: {
        silo_id: { type: 'string', description: 'UUID of the silo' },
        status:  { type: 'string', description: 'Filter by status: planned | generated | for_review | published | archived' },
      },
      required: ['silo_id'],
    },
  },
  {
    name: 'get_optimization_brief',
    description: 'Get the optimization brief for a silo page or topic (AI-generated content blueprint with headings, terms, schema, EEAT).',
    inputSchema: {
      type: 'object',
      properties: {
        silo_page_id:     { type: 'string', description: 'UUID of the silo page' },
        content_topic_id: { type: 'string', description: 'UUID of the content topic' },
        brief_id:         { type: 'string', description: 'UUID of the brief (if known directly)' },
      },
    },
  },
]

const ALLOWED_TOPIC_FIELDS = new Set(['status', 'target_publish_date', 'rationale', 'target_keyword', 'suggested_title'])

export async function handle(name: string, args: Record<string, unknown>, db: SupabaseClient): Promise<ToolResult> {
  try {
    switch (name) {
      case 'list_topics': {
        const limit = Math.min(Number(args.limit ?? 50), 200)
        let q = db
          .from('content_topics')
          .select('id, client_id, topic, target_keyword, status, content_type, target_publish_date, silo_id, post_id, suggested_title, competition_level, created_at')
          .order('target_publish_date', { ascending: true, nullsFirst: false })
          .limit(limit)
        if (args.client_id)    q = q.eq('client_id', String(args.client_id))
        if (args.status)       q = q.eq('status', String(args.status))
        if (args.content_type) q = q.eq('content_type', String(args.content_type))
        if (args.silo_id)      q = q.eq('silo_id', String(args.silo_id))
        const { data, error } = await q
        if (error) throw error
        return ok(fmt(data))
      }

      case 'get_topic': {
        const { data, error } = await db
          .from('content_topics')
          .select('*')
          .eq('id', String(args.topic_id))
          .maybeSingle()
        if (error) throw error
        if (!data) return fail('Topic not found')
        return ok(fmt(data))
      }

      case 'update_topic': {
        const updates: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(args)) {
          if (k !== 'topic_id' && ALLOWED_TOPIC_FIELDS.has(k)) updates[k] = v
        }
        if (Object.keys(updates).length === 0) return fail('No updatable fields provided')
        updates.updated_at = new Date().toISOString()
        const { error } = await db
          .from('content_topics')
          .update(updates)
          .eq('id', String(args.topic_id))
        if (error) throw error
        return ok(`Topic ${String(args.topic_id)} updated: ${JSON.stringify(updates)}`)
      }

      case 'create_topic': {
        const insert: Record<string, unknown> = {
          client_id:      String(args.client_id),
          topic:          String(args.topic),
          target_keyword: String(args.target_keyword),
          content_type:   String(args.content_type),
          status:         'approved',
        }
        if (args.target_publish_date) insert.target_publish_date = args.target_publish_date
        if (args.silo_id)             insert.silo_id = args.silo_id
        if (args.rationale)           insert.rationale = args.rationale
        const { data, error } = await db.from('content_topics').insert(insert).select('id').maybeSingle()
        if (error) throw error
        if (!data) return fail('Insert returned no row')
        return ok(`Topic created with id: ${(data as { id: string }).id}`)
      }

      case 'list_posts': {
        const limit = Math.min(Number(args.limit ?? 50), 200)
        let q = db
          .from('content_posts')
          .select('id, client_id, title, target_keyword, status, content_type, target_publish_date, wp_post_id, bc_post_id, published_url, generated_at, silo_id, word_count')
          .order('target_publish_date', { ascending: true, nullsFirst: false })
          .limit(limit)
        if (args.client_id) q = q.eq('client_id', String(args.client_id))
        if (args.status)    q = q.eq('status', String(args.status))
        if (args.silo_id)   q = q.eq('silo_id', String(args.silo_id))
        const { data, error } = await q
        if (error) throw error
        return ok(fmt(data))
      }

      case 'get_post': {
        const cols = args.include_content
          ? '*'
          : 'id, client_id, title, target_keyword, status, content_type, seo_title, meta_description, slug, focus_topic, suggested_tags, target_publish_date, wp_post_id, bc_post_id, wp_site_url, published_url, generated_at, silo_id, word_count, topic_rationale'
        const { data, error } = await db
          .from('content_posts')
          .select(cols)
          .eq('id', String(args.post_id))
          .maybeSingle()
        if (error) throw error
        if (!data) return fail('Post not found')
        return ok(fmt(data))
      }

      case 'list_silos': {
        let q = db
          .from('content_silos')
          .select('id, client_id, name, hub_page_url, hub_page_title, central_entity, section, status, created_at')
          .neq('status', 'archived')
          .order('created_at', { ascending: true })
        if (args.client_id) q = q.eq('client_id', String(args.client_id))
        const { data, error } = await q
        if (error) throw error
        // Annotate with post counts
        const siloIds = (data as { id: string }[]).map(s => s.id)
        if (siloIds.length === 0) return ok('[]')
        const { data: postCounts } = await db
          .from('content_posts')
          .select('silo_id, status')
          .in('silo_id', siloIds)
          .limit(2000)
        const counts: Record<string, { total: number; published: number }> = {}
        for (const p of (postCounts ?? []) as { silo_id: string; status: string }[]) {
          if (!counts[p.silo_id]) counts[p.silo_id] = { total: 0, published: 0 }
          counts[p.silo_id].total++
          if (p.status === 'draft_saved' || p.status === 'published') counts[p.silo_id].published++
        }
        const enriched = (data as Record<string, unknown>[]).map(s => ({
          ...s,
          post_counts: counts[s.id as string] ?? { total: 0, published: 0 },
        }))
        return ok(fmt(enriched))
      }

      case 'get_silo': {
        const { data: silo, error } = await db
          .from('content_silos')
          .select('*')
          .eq('id', String(args.silo_id))
          .maybeSingle()
        if (error) throw error
        if (!silo) return fail('Silo not found')
        const [keywordsRes, pagesRes, topicsRes] = await Promise.all([
          db.from('content_silo_keywords').select('id, keyword, keyword_type, intent, keyword_score, selected').eq('silo_id', String(args.silo_id)),
          db.from('content_silo_pages').select('id, title, page_type, status, target_url, primary_keyword').eq('silo_id', String(args.silo_id)),
          db.from('content_topics').select('id, topic, status, target_publish_date').eq('silo_id', String(args.silo_id)),
        ])
        return ok(fmt({
          ...silo as Record<string, unknown>,
          keyword_count: keywordsRes.data?.length ?? 0,
          keywords:      keywordsRes.data ?? [],
          page_count:    pagesRes.data?.length ?? 0,
          pages:         pagesRes.data ?? [],
          topic_count:   topicsRes.data?.length ?? 0,
          topics:        topicsRes.data ?? [],
        }))
      }

      case 'list_silo_keywords': {
        let q = db
          .from('content_silo_keywords')
          .select('id, keyword, keyword_type, intent, monthly_searches_low, monthly_searches_high, keyword_score, trust_authority_score, current_ranking_position, selected, page_category')
          .eq('silo_id', String(args.silo_id))
          .order('keyword_type')
          .order('created_at')
        if (args.keyword_type)  q = q.eq('keyword_type', String(args.keyword_type))
        if (args.selected_only) q = q.eq('selected', true)
        const { data, error } = await q
        if (error) throw error
        return ok(fmt(data))
      }

      case 'list_silo_pages': {
        let q = db
          .from('content_silo_pages')
          .select('id, title, page_type, status, target_url, primary_keyword, content_post_id, content_topic_id, created_at')
          .eq('silo_id', String(args.silo_id))
          .order('created_at')
        if (args.status) q = q.eq('status', String(args.status))
        const { data, error } = await q
        if (error) throw error
        return ok(fmt(data))
      }

      case 'get_optimization_brief': {
        let q = db.from('content_optimization_briefs').select('*')
        if (args.brief_id)         q = q.eq('id', String(args.brief_id))
        else if (args.silo_page_id)     q = q.eq('silo_page_id', String(args.silo_page_id))
        else if (args.content_topic_id) q = q.eq('content_topic_id', String(args.content_topic_id))
        else return fail('Provide brief_id, silo_page_id, or content_topic_id')
        const { data, error } = await q.maybeSingle()
        if (error) throw error
        if (!data) return fail('No optimization brief found')
        return ok(fmt(data))
      }

      default:
        return fail(`Unknown tool: ${name}`)
    }
  } catch (e) {
    return fail(`Error: ${e instanceof Error ? e.message : String(e)}`)
  }
}

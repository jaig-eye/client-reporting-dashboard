// POST /api/admin/content/topics/[id]/regenerate
// Replaces the idea on an existing topic row with a freshly AI-generated one,
// preserving the topic's ID and target_publish_date.

import { NextRequest, NextResponse } from 'next/server'
import { cookies }                   from 'next/headers'
import { createAdminClient }         from '@/lib/supabase/server'
import { isAdminAuthed }             from '@/lib/auth'
import { generateTopicsForClient }   from '@/lib/content/generateTopics'

export const maxDuration = 120

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const db = createAdminClient()

  // Fetch original topic
  const { data: original, error: fetchErr } = await db
    .from('content_topics')
    .select('id, client_id, target_publish_date, silo_id')
    .eq('id', id)
    .maybeSingle()

  if (fetchErr || !original) {
    return NextResponse.json({ error: 'Topic not found' }, { status: 404 })
  }

  // Generate 1 new topic idea for the same publish date, preserving silo context
  const result = await generateTopicsForClient(
    db,
    original.client_id as string,
    1,
    original.target_publish_date as string | undefined,
    { siloId: (original.silo_id as string | null) ?? undefined },
  )

  if (result.error || result.topics.length === 0) {
    return NextResponse.json({ error: result.error ?? 'No topics generated' }, { status: 500 })
  }

  const newId = result.topics[0].id

  // Read the freshly inserted row
  const { data: newRow } = await db
    .from('content_topics')
    .select('topic, target_keyword, search_intent, secondary_keywords, rationale, keyword_opportunity, ranking_strategy, audience_intent, why_now, competition_level')
    .eq('id', newId)
    .maybeSingle()

  if (!newRow) {
    return NextResponse.json({ error: 'Failed to read generated topic' }, { status: 500 })
  }

  // Update original row in-place; delete the throwaway row
  const [{ data: updated }, ] = await Promise.all([
    db.from('content_topics')
      .update({
        topic:               newRow.topic,
        target_keyword:      newRow.target_keyword,
        search_intent:       newRow.search_intent,
        secondary_keywords:  newRow.secondary_keywords,
        rationale:           newRow.rationale,
        keyword_opportunity: newRow.keyword_opportunity,
        ranking_strategy:    newRow.ranking_strategy,
        audience_intent:     newRow.audience_intent,
        why_now:             newRow.why_now,
        competition_level:   newRow.competition_level,
        status:              'pending',
        seo_brief:           null,
      })
      .eq('id', id)
      .select()
      .maybeSingle(),
    db.from('content_topics').delete().eq('id', newId),
  ])

  return NextResponse.json(updated)
}

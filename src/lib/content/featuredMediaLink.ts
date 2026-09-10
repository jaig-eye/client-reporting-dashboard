import type { SupabaseClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────────────────────
// Releasing the client-media attachment link when the featured image changes.
//
// content_posts.wp_featured_media_id tells the publish path "this image is already an
// attachment on their site — reference it by id rather than uploading a copy". That is only
// true for the image it was recorded against. Leave it set after the image CHANGES and
// approve keeps sending the old id, so the client's live post shows the first library image
// the reviewer ever picked regardless of what the drawer displays. A stale optimisation that
// publishes the wrong picture is worse than no optimisation at all.
//
// So every writer of featured_image_url must clear it, and there are four of them: the stock
// apply, the upload, AI generation, and the drawer's own save.
//
// The retry exists because the columns arrive in migration 214, migrations here are applied
// by hand, and naming a column PostgREST does not know fails the WHOLE statement — an UPDATE
// no less than a SELECT. Without the fallback, adding this release would break image
// changing outright until someone ran the migration, which is precisely the failure migration
// 212 already caused on this branch.
// ─────────────────────────────────────────────────────────────────────────────

/** Set on every update that replaces the featured image. */
export const RELEASE_MEDIA_LINK = {
  wp_featured_media_id:            null,
  wp_featured_media_connection_id: null,
} as const

/**
 * Metadata that described the OLD picture and must not outlive it.
 *
 * image_alt_text has exactly one writer — AI generation — so a post whose generated image was
 * later swapped for a library photo or an upload kept an alt describing the discarded picture.
 * That alt was then sent to the client's live site as the NEW file's alt text, and made the
 * "Image alt w/ keyword" row green for an image nobody had described.
 *
 * Cleared on both paths below, not just the one with the 214 columns, and always overridable:
 * a caller that has real alt text for the new picture passes it and wins.
 */
export const RELEASE_IMAGE_METADATA = {
  image_alt_text: null,
} as const

/**
 * Update a post, releasing the attachment link, and fall back to the same update WITHOUT the
 * link columns if they do not exist yet.
 *
 * Returns the final error, if any, so callers keep whatever handling they already had.
 */
export async function updatePostReleasingMediaLink(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  postId: string,
  update: Record<string, unknown>,
): Promise<{ error: { message: string } | null }> {
  // RELEASE_IMAGE_METADATA first, so a caller supplying alt text for the NEW picture overrides
  // the clear rather than being overridden by it.
  const base = { ...RELEASE_IMAGE_METADATA, ...update }

  const { error } = await db
    .from('content_posts')
    .update({ ...base, ...RELEASE_MEDIA_LINK })
    .eq('id', postId)

  if (error && /wp_featured_media/i.test(error.message)) {
    console.warn(
      '[featuredMediaLink] wp_featured_media_* missing (apply migration 214) — '
      + 'image updated without releasing the attachment link',
    )
    const retry = await db.from('content_posts').update(base).eq('id', postId)
    return { error: retry.error }
  }

  return { error }
}

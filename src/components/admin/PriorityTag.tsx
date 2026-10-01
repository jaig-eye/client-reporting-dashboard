// "This came from a set someone added by hand" — on a topic or a post's own card.
//
// One small tag for every place a post's provenance shows: the Pipeline's topic rows, its review
// cards once the article exists, and the Monthly Review. They used to say "silo: X" in a violet hex
// that stayed the same in dark mode, and the review card said nothing at all — the label vanished the
// moment the post was written, which is exactly when someone who didn't add the set first sees it.
//
// It reads "Priority · {set}" with a flag, named the way the Pipeline's Priority topics section is,
// and says "requested by the team, not an automatic pick" on hover. Neutral colours, so it sits
// beside the status pill without competing with it. Server-safe: no hooks, no client code.

export default function PriorityTag({ setName, keyword, size = 'md' }: {
  setName:  string
  /** The keyword from the set this one was written for, when known. */
  keyword?: string | null
  size?:    'sm' | 'md'
}) {
  const title = keyword
    ? `Requested by the team in Priority topics (set “${setName}”), not an automatic pick. Written for “${keyword}”.`
    : `Requested by the team in Priority topics (set “${setName}”), not an automatic pick.`
  return (
    <span className={`pt-tag${size === 'sm' ? ' pt-tag--sm' : ''}`} title={title}>
      <span className="pt-tag-chip">
        <svg className="pt-tag-flag" width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M5 2a1 1 0 0 1 1 1v1h11.4a1 1 0 0 1 .8 1.6L15.6 9l2.6 3.4a1 1 0 0 1-.8 1.6H6v7a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1Z" />
        </svg>
        <span className="pt-tag-label">Priority</span>
        <span className="pt-tag-sep" aria-hidden>·</span>
        <span className="pt-tag-name">{setName}</span>
      </span>
      {keyword && <span className="pt-tag-kw">for “{keyword}”</span>}
      <span className="sr-only"> — requested by the team, not an automatic pick</span>
    </span>
  )
}

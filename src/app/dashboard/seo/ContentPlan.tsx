// The blog work, and the reasoning behind it.
//
// A list of post titles tells a client we wrote things. What they actually want to know is why
// each one exists — which search it is going after, how much of that search there is, and what it
// is meant to do for the rest of the site. So every post carries its own short brief, broken into
// facts rather than delivered as a paragraph of strategy nobody reads.
//
// Only work the client has signed off appears here: published posts, and approved ones still on
// the way. Drafts, rejected ideas and anything pending are ours, not theirs.

import { ArrowSquareOut, MagnifyingGlass, ArrowBendUpRight } from '@phosphor-icons/react/dist/ssr'

export interface ContentPost {
  id:              string
  title:           string
  /** 'published' — live on their site. 'approved' — signed off, not yet up. */
  status:          string
  url:             string | null
  image:           string | null
  /** True when the image came off the live page rather than our own record. */
  image_from_site: boolean
  published_at:    string | null
  due_at:          string | null
  word_count:      number | null
  keyword:         string | null
  searches:        number | null
  difficulty:      number | null
  /** Why this topic, in our own words. Short by design. */
  reason:          string | null
  supports:        string | null
}

/** Google's difficulty score, said the way a client would say it. */
function competition(kd: number | null): string | null {
  if (kd == null) return null
  if (kd <= 20) return 'not much competition'
  if (kd <= 40) return 'moderate competition'
  return 'a competitive search'
}

const prettyDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/** A post with no image is still a post. This is a cover, not an apology. */
function CoverFallback({ keyword, title }: { keyword: string | null; title: string }) {
  const words = (keyword || title).split(/\s+/).slice(0, 4).join(' ')
  return (
    <div className="cp__cover cp__cover--none" aria-hidden>
      <span className="cp__cover-word">{words}</span>
    </div>
  )
}

function PostCard({ post }: { post: ContentPost }) {
  const live  = post.status === 'published' && !!post.url
  const comp  = competition(post.difficulty)

  return (
    <article className="cp__post">
      {post.image
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={post.image} alt="" className="cp__cover" loading="lazy" />
        : <CoverFallback keyword={post.keyword} title={post.title} />}

      <div className="cp__body">
        <div className="cp__head">
          <span className="cp__state" data-state={live ? 'live' : 'ready'}>
            {live ? 'Live on your site' : 'Approved, publishing soon'}
          </span>
          {post.published_at && live && (
            <time className="cp__when" dateTime={post.published_at.slice(0, 10)}>
              {prettyDate(post.published_at)}
            </time>
          )}
          {!live && post.due_at && (
            <time className="cp__when" dateTime={post.due_at.slice(0, 10)}>
              Due {prettyDate(post.due_at)}
            </time>
          )}
        </div>

        <h3 className="cp__title">
          {live
            ? <a href={post.url as string} target="_blank" rel="noopener noreferrer">{post.title}</a>
            : post.title}
        </h3>

        {post.keyword && (
          <p className="cp__target">
            <MagnifyingGlass size={13} weight="bold" aria-hidden />
            <span className="cp__kw">{post.keyword}</span>
            {post.searches != null && post.searches > 0 && (
              <span className="cp__muted">
                {post.searches.toLocaleString()} searches a month
                {comp && <>, {comp}</>}
              </span>
            )}
          </p>
        )}

        {post.reason && (
          <p className="cp__reason"><span className="cp__reason-label">Why this one:</span> {post.reason}</p>
        )}

        <footer className="cp__foot">
          {post.supports && (
            <span className="cp__supports">
              <ArrowBendUpRight size={12} weight="bold" aria-hidden />
              Points readers to {post.supports}
            </span>
          )}
          {post.word_count != null && post.word_count > 0 && (
            <span className="cp__words">{post.word_count.toLocaleString()} words</span>
          )}
          {!post.image && (
            <span className="cp__nocover">
              {live ? 'Image added on the site' : 'No image yet'}
            </span>
          )}
          {post.image_from_site && <span className="cp__nocover">Image added on the site</span>}
          {live && (
            <a className="cp__read" href={post.url as string} target="_blank" rel="noopener noreferrer">
              Read it<ArrowSquareOut size={11} weight="bold" aria-hidden />
            </a>
          )}
        </footer>
      </div>
    </article>
  )
}

export default function ContentPlan({
  published, upcoming, periodLabel,
}: {
  published: ContentPost[]
  upcoming:  ContentPost[]
  periodLabel: string
}) {
  return (
    <div className="seo-stack">
      <section className="card seo-panel">
        <div className="seo-panel__head">
          <h3 className="section-title">Blog posts we published</h3>
          <p className="section-desc">
            {published.length > 0
              ? published.length === 1
                ? <>1 post went live {periodLabel}, written for a search people are already making.</>
                : <>{published.length} posts went live {periodLabel}, each one written for a search
                    people are already making.</>
              : <>Nothing went live between these dates. Widen the range to see earlier posts.</>}
          </p>
        </div>
        {published.length > 0 && (
          <div className="seo-panel__body">
            <div className="cp">
              {published.map(p => <PostCard key={p.id} post={p} />)}
            </div>
          </div>
        )}
      </section>

      {upcoming.length > 0 && (
        <section className="card seo-panel">
          <div className="seo-panel__head">
            <h3 className="section-title">Approved and on the way</h3>
            <p className="section-desc">
              Written and signed off, waiting to go up on your site.
            </p>
          </div>
          <div className="seo-panel__body">
            <div className="cp">
              {upcoming.map(p => <PostCard key={p.id} post={p} />)}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

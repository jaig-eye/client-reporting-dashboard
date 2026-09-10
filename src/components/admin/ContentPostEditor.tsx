'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Books, ArrowCircleRight, ArrowClockwise } from '@phosphor-icons/react'
import CollapsibleSection from '@/components/admin/CollapsibleSection'
import { viewLiveUrl, isPublicPermalink, isOnSite as postIsOnSite } from '@/lib/content/postLinks'
import RegenerateDialog, { type RegenerateRequest } from '@/components/admin/RegenerateDialog'
import QualityFindings from '@/components/admin/QualityFindings'
import PostSiteLinks from '@/components/admin/PostSiteLinks'
import type { PostLinkInput } from '@/lib/content/postLinks'
import ConfirmActionDialog from '@/components/admin/ConfirmActionDialog'
import ImageDirectionDialog from '@/components/admin/ImageDirectionDialog'
import ImageLibraryModal from '@/components/admin/ImageLibraryModal'
import StockImageLightbox from '@/components/admin/StockImageLightbox'
import ClientImage from '@/components/admin/ClientImage'
import { proxiedImageSrc } from '@/lib/content/imageProxy'
import type { StockImageCandidate } from '@/lib/content/stockImages'
/** Keyed on the normalised `source`, not `provider` — provider carries the UPSTREAM
 *  host Openverse aggregated from ('flickr', 'museumsvictoria'), which surfaced raw. */

interface Site {
  connectionId:  string
  siteUrl:       string
  siteName:      string
  clientId:      string
  clientName:    string
  connectorType?: string
}

interface UpdatedPost {
  id:            string
  status:        string
  title:         string | null
  targetKeyword: string | null
  wordCount:     number | null
  headingCount:  number | null
  internalLinks: number | null
  publishedUrl:  string | null
  wpPostId?:     number | null
  wpSiteUrl?:    string | null
}

interface Props {
  postId:              string
  defaultConnectionId: string | null
  sites:               Site[]
  onClose:             () => void
  onUpdate:            (post: UpdatedPost) => void
  /**
   * Fired after a successful Save while the drawer STAYS OPEN, so the list behind it can
   * resync. Distinct from onUpdate, which every consumer treats as "finished — close and
   * reload"; without it a save flashed "Saved ✓" and told nobody, so the card behind kept
   * showing the old title and thumbnail until a full page reload.
   */
  onSaved?:            (post: UpdatedPost) => void
  onRegenerateStart?:   () => void
  onRegenerateDone?:    (post: Partial<UpdatedPost>) => void
  onRegenerateError?:   () => void
  onMonthlyApprove?:    () => void
  onMonthlyDiscard?:    () => void
  onMonthlyRegenerate?: () => void
  autoScanLinks?:       boolean  // auto-trigger link scan on mount (e.g. when opened from monthly review)
  topicBreakdown?:      TopicBreakdown | null
}

interface PostDetail {
  id:               string
  clientId:         string
  status:           string
  contentType:      string
  targetKeyword:    string | null
  title:            string | null
  seoTitle:         string | null
  content:          string | null
  metaDescription:  string | null
  slug:             string | null
  suggestedTags:    string[]
  wordCount:        number | null
  headingCount:     number | null
  internalLinks:    number | null
  publishedUrl:     string | null
  wpAuthorId:       number | null
  wpCategoryIds:    number[] | null
  wpPostId:         number | null
  wpSiteUrl:        string | null
  bcPostId:         number | null
  bcStoreHash:      string | null
  featuredImageUrl:          string | null
  imageAltText:              string | null
  lastPushedAt:              string | null
  updatedAt:                 string | null
  imageCandidates?:          StockImageCandidate[]
  targetPublishDate:         string | null
  topicId:                   string | null
  postConnectionId:          string | null
  scheduleDefaultAuthorId:   number | null
  schedulePublishMode:       string | null
  scheduleBcAuthor:          string | null
  bcAuthorName:              string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  qualityReport:             any | null
}

interface Author {
  id:   number
  name: string
}

interface WpTag {
  id:   number
  name: string
  slug: string
}

interface WpCategory {
  id:   number
  name: string
}

interface CategorySuggestion {
  id:    number | null  // null = doesn't exist yet in WP, will be created at publish
  name:  string
  isNew: boolean
}

type WpPublishStatus = 'draft' | 'publish' | 'future'

// ─── SEO check helpers ────────────────────────────────────────────────────────

function seoCheck(field: string | null, keyword: string): boolean {
  if (!field || !keyword) return false
  const f = field.toLowerCase()
  const k = keyword.toLowerCase()
  if (f.includes(k)) return true
  // Word-level match so tiny tokens ("in", "fl") can't inflate the score via
  // substring hits. A keyword word (≥3 chars) counts when a field token equals it,
  // or bridges an abbreviation — one being a short prefix of the other (fl ↔ florida).
  const fieldTokens = f.split(/[^a-z0-9]+/).filter(Boolean)
  // Substantive words only. Counting "what", "does" and "for" as terms the field had to
  // contain is what made a correct H1 fail its own keyword: six of the nine words in
  // "what does a downpipe do on an EcoBoost engine" carry no meaning, and no honest headline
  // repeats them.
  let kwWords = k.split(/\s+/).filter(w => w.length >= 3 && !KEYWORD_STOP_WORDS.has(w))
  // A keyword made entirely of filler still has to match on something.
  if (kwWords.length === 0) kwWords = k.split(/\s+/).filter(w => w.length >= 3)
  if (kwWords.length === 0) return false

  // Enough morphology to bridge the variation an editor writes without thinking.
  //
  // "repair → repairs" was already handled by the prefix test, but "battery → batteries" was
  // not, and the -ies plural is LONGER than its singular — so it was disproportionately likely
  // to be picked as the mandatory term below and then be the one term that could not match.
  // A keyword like "best atv batteries 2026" turned four checklist rows red on an article
  // carrying every word of it.
  const norm = (v: string): string => {
    let x = v
    if (x.length > 4 && x.endsWith('ies'))                        x = `${x.slice(0, -3)}y`
    else if (x.length > 3 && x.endsWith('s') && !x.endsWith('ss')) x = x.slice(0, -1)
    if (x.length > 5 && x.endsWith('ing'))                        x = x.slice(0, -3)
    return x
  }

  const bridges = (w: string, t: string): boolean => {
    const nw = norm(w), nt = norm(t)
    return nt === nw
      || (nw.length >= 4 && nt.startsWith(nw))                       // repair → repairs
      || (nt.length >= 2 && nw.startsWith(nt) && nw.length - nt.length <= 5)  // fl → florida
  }

  // A hyphenated term is carried when all of its PARTS are.
  //
  // Field tokens are split on every non-alphanumeric, so none of them can contain a hyphen —
  // while keyword terms are split on whitespace and keep theirs. Comparing the two directly
  // made "pre-owned" unmatchable against a field literally reading "Pre-Owned", and via
  // keywordInSlug (which hands the slug over with its hyphens turned to spaces) it made the
  // slug check unsatisfiable for any hyphenated keyword: no spelling of the slug could clear
  // it. Matching part-by-part keeps the compound a single unit without that dead end.
  const hit = (w: string): boolean => {
    const parts = w.split(/[^a-z0-9]+/).filter(Boolean)
    if (parts.length > 1) return parts.every(part => fieldTokens.some(t => bridges(part, t)))
    return fieldTokens.some(t => bridges(w, t))
  }

  // One class of term is not optional: anything carrying a hyphen or a digit. That shape is
  // almost always a brand, a model or a year — "can-am defender review" is not satisfied by a
  // slug about a Yamaha Wolverine, however many of the other words line up.
  //
  // An earlier version also made the LONGEST term mandatory, on the theory that it stands in
  // for the most specific one. It does not, reliably: for "e-bike battery range" the longest
  // term is "battery", so a correct "E-Bike Range: What to Expect" went red for dropping a
  // word it had no need of. Length is not distinctiveness, and this checklist sits next to the
  // H1 it is judging — a reviewer can see what it cannot. Erring loose is the right side to
  // err on here, and it is the specific complaint these checks were rewritten to answer.
  const mandatory = kwWords.filter(w => /[-\d]/.test(w))
  if (!mandatory.every(hit)) return false

  // Two thirds. A field carrying "downpipe" and "ecoboost" carries that keyword, and demanding
  // "engine" as well fails correct work.
  return kwWords.filter(hit).length / kwWords.length >= 0.66
}

function countWords(html: string): number {
  return html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
}

function countHeadings(html: string): number {
  return (html.match(/<h[2-4][^>]*>/gi) || []).length
}

function countInternalLinks(html: string): number {
  return (html.match(/<a [^>]+>/gi) || []).filter(l => !l.match(/href=["']https?:\/\//i)).length
}

function countExternalLinks(html: string): number {
  return (html.match(/<a [^>]*href=["']https?:\/\//gi) || []).length
}

function keywordInSubheadings(html: string, keyword: string): boolean {
  if (!keyword) return false
  const headings = html.match(/<h[2-4][^>]*>[\s\S]*?<\/h[2-4]>/gi) || []
  // Fuzzy word-level match (same as title checks) so natural variations count, not just the exact phrase.
  return headings.some(h => seoCheck(h.replace(/<[^>]+>/g, ' '), keyword))
}

/**
 * Grammar and question words.
 *
 * These are the reason the keyword checks were failing good work. A long-tail keyword like
 * "what does a downpipe do on an EcoBoost engine" is mostly filler: only "downpipe",
 * "ecoboost" and "engine" carry meaning, and an H1 that covers two of the three genuinely
 * covers the keyword. Weighting "what" and "does" equally with "downpipe" made the bar
 * unreachable for exactly the long-tail phrasing these articles target.
 */
const KEYWORD_STOP_WORDS = new Set([
  'a','an','the','of','for','and','to','in','on','with','your','you','is','are','was','were',
  'be','do','does','did','how','what','why','when','which','who','from','that','this','it',
  'its','at','as','by','or','vs','versus','my','our','their','can','should','will','about',
])

/**
 * Does the slug carry the keyword?
 *
 * It used to require the whole keyword, hyphenated, verbatim — so the CORRECT slug
 * "what-does-downpipe-do-ecoboost" failed against the keyword "what does a downpipe do on an
 * EcoBoost engine", because it had dropped "a", "on", "an" and "engine". Shortening a slug by
 * removing filler is standard practice and something we deliberately do, so the check marked
 * good work red and could not be satisfied without writing a worse slug.
 *
 * It now asks the question that matters: are the keyword's SUBSTANTIVE words in there.
 *
 * The rule is seoCheck's, deliberately — this had its own parallel implementation and drifted
 * from it in a way that mattered: it tested `slugText.includes(term)` against the whole slug
 * string, so "car insurance" passed "carpet-cleaning-insurance-claims" on two substring hits
 * inside unrelated words. Delegating means the slug is tokenised on its hyphens like any other
 * field, and the two checks can no longer disagree about what carrying a keyword means.
 */
function keywordInSlug(slug: string, keyword: string): boolean {
  if (!slug || !keyword) return false
  // Hyphens are the slug's word separators; seoCheck splits on non-alphanumerics anyway, but
  // this keeps the intent visible at the call site.
  return seoCheck(slug.toLowerCase().replace(/-/g, ' '), keyword)
}

/**
 * Keyword density.
 *
 * Measured on the keyword's longest substantive term rather than the verbatim phrase.
 *
 * The exact-phrase count reported 0.0% for essentially every long-tail keyword, because
 * nobody writes "what does a downpipe do on an EcoBoost engine" repeatedly in prose — and
 * an article that DID would be the kind of keyword-stuffed writing the rest of these checks
 * exist to prevent. So the check was red on good articles and would only go green on bad
 * ones, which is worse than not having it.
 *
 * The longest substantive term is a stand-in for the one the piece is about — not a perfect
 * one ("what is the difference between a downpipe and a catback" picks "difference"), which is
 * why this is a density reading and not a verdict.
 *
 * Both counts are taken and the HIGHER wins. Returning early on the exact phrase inverted the
 * whole check: an article that mentioned the phrase once — normal, correct practice — reported
 * 0.11% and went red, while deleting that one sentence made the same article report 1.09% and
 * go green. The check was paying for keyword stuffing and penalising good writing, which is the
 * failure it was rewritten to fix.
 */
function computeKeywordDensity(html: string, keyword: string): number {
  if (!keyword || !html) return 0
  // Collapse whitespace (tags become spaces) so a phrase split across tag boundaries still matches.
  const text  = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase()
  const words = text.split(' ').filter(Boolean).length
  if (words === 0) return 0

  const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, m => "\\" + m)
  const kw  = keyword.toLowerCase().replace(/\s+/g, ' ').trim()

  const exact    = (text.match(new RegExp(esc(kw), 'g')) || []).length
  const exactPct = (exact / words) * 100

  const head = kw.split(' ')
    .filter(w => w.length >= 3 && !KEYWORD_STOP_WORDS.has(w))
    .sort((a, b) => b.length - a.length)[0]
  if (!head) return exactPct

  const hits    = (text.match(new RegExp("\\b" + esc(head), "g")) || []).length
  const headPct = (hits / words) * 100

  return Math.max(exactPct, headPct)
}

function hasImageWithKeywordAlt(html: string, keyword: string): boolean {
  if (!keyword) return false
  const imgs = html.match(/<img [^>]+>/gi) || []
  return imgs.some(img => {
    const m = img.match(/alt=["']([^"']*)["']/i)
    // Fuzzy match so "powersports financing" alt counts for keyword "Canada Powersports Financing".
    return m ? seoCheck(m[1], keyword) : false
  })
}

// ─── Tier 1 on-page checks (writer-quality bar) ─────────────────────────────────
// A "Key Takeaways" H2/H3 immediately reinforced by a list — the summary box the
// writer prompt now requires after the intro.
function hasKeyTakeaways(html: string): boolean {
  // Allow optional inline tags/entities between the heading tag and the text, e.g.
  // <h2><strong>Key Takeaways</strong></h2>.
  return /<h[23][^>]*>(?:\s|<[^>]+>|&nbsp;)*key\s*takeaways/i.test(html)
}

// No skipped heading levels. The post title is the H1, so body headings should start
// at H2 and never jump deeper by more than one level (H2→H4 is a skip). Returns true
// when there is at least one heading and the sequence is clean.
function headingHierarchyClean(html: string): boolean {
  const levels = (html.match(/<h([1-6])[^>]*>/gi) || [])
    .map(h => parseInt(h.match(/<h([1-6])/i)![1], 10))
  if (levels.length === 0) return false
  if (levels.filter(l => l === 1).length > 1) return false  // multiple H1s in body
  let prev = 1  // the title is the H1 baseline
  for (const l of levels) {
    if (l > prev + 1) return false
    prev = l
  }
  return true
}

// 'to'/'you'/'your' deliberately excluded: they appear in perfectly clean slugs
// (how-to-clean-gutters, protect-your-home) and flagging them is noise.
const URL_STOP_WORDS = new Set(['the','and','of','a','an','in','for','with','on','at','by','or','is','are'])
// Clean, keyword-friendly slug: lowercase, hyphen-delimited, ≤6 words, no stop words,
// no 4-digit year. Mirrors the URL-structure guidance in docs/reference/claude-blog-seo.md.
function slugQualityClean(slug: string): boolean {
  if (!slug) return false
  if (slug !== slug.toLowerCase()) return false
  if (/\b(19|20)\d{2}\b/.test(slug)) return false
  const words = slug.split('-').filter(Boolean)
  if (words.length === 0 || words.length > 6) return false
  if (words.some(w => URL_STOP_WORDS.has(w))) return false
  return true
}

// ─── Category auto-suggestion ───────────────────────────────────────────────────
// Word-level matching (exact or shared prefix, ≥4 chars, stopwords removed) so a
// laptop-repair post doesn't match "Business Phone Systems" just because 'business'
// contains 'in' and 'phone' contains 'on'. Precision over recall — a bad guess is
// worse than falling back to a Blog category the user can override.
const CATEGORY_STOPWORDS = new Set([
  'the','and','for','with','your','you','our','are','was','how','why','what','when','where','who',
  'will','from','into','out','off','not','but','all','any','has','have','had','get','got','this',
  'that','these','those','before','after','about','over','than','then','they','them','been','does',
  'done','just','like','more','most','some','such','only','also','very','much','many','each','every',
  'their','there','here','would','could','should','while','which','shop','call','calling','turn','need',
])

function tokenizeForCategory(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length >= 4 && !CATEGORY_STOPWORDS.has(w))
}

// Both inputs are already ≥4 chars: match on equality or a shared prefix
// (handles system/systems, repair/repairs, cyber/cybersecurity).
function categoryWordsOverlap(a: string, b: string): boolean {
  if (a === b) return true
  // Only treat a shared prefix as a match when both words are long enough that it's
  // very likely the same term (systems↔system), not a coincidence (care↔career, plan↔planet).
  return Math.min(a.length, b.length) >= 6 && (a.startsWith(b) || b.startsWith(a))
}

function suggestCategory(
  cats: WpCategory[],
  keyword: string | null | undefined,
  title: string | null | undefined,
): CategorySuggestion {
  const kwWords    = tokenizeForCategory([keyword, title].filter(Boolean).join(' '))
  const nonDefault = cats.filter(c => c.name.toLowerCase() !== 'uncategorized')
  const scored = nonDefault
    .map(c => ({ c, score: tokenizeForCategory(c.name).filter(cw => kwWords.some(kw => categoryWordsOverlap(cw, kw))).length }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)

  if (scored.length > 0) {
    return { id: scored[0].c.id, name: scored[0].c.name, isNew: false }
  }
  // No meaningful keyword match — fall back to a Blog category rather than guessing.
  const blogCat = nonDefault.find(c => ['blog', 'articles', 'news', 'posts'].includes(c.name.toLowerCase()))
  return blogCat ? { id: blogCat.id, name: blogCat.name, isNew: false } : { id: null, name: 'Blog', isNew: true }
}

// ─── Component ────────────────────────────────────────────────────────────────

type SectionId = 'content' | 'images' | 'seo' | 'publish'

interface TopicBreakdown {
  keyword_opportunity?:    string | null
  ranking_strategy?:       string | null
  audience_intent?:        string | null
  why_now?:                string | null
  competition_level?:      string | null
  page_to_support?:        string | null
  competitors_researched?: string[] | null
}

export default function ContentPostEditor({ postId, defaultConnectionId, sites, onClose, onUpdate, onSaved, onRegenerateStart, onRegenerateDone, onRegenerateError, onMonthlyApprove, onMonthlyDiscard, onMonthlyRegenerate, autoScanLinks, topicBreakdown }: Props) {
  const [post,            setPost]            = useState<PostDetail | null>(null)
  const [loading,         setLoading]         = useState(true)
  const [saving,          setSaving]          = useState(false)
  const [savedFlash,      setSavedFlash]      = useState(false)
  const [regenerating,      setRegenerating]      = useState(false)
  const [fullRegenerating,  setFullRegenerating]  = useState(false)
  // The old inline confirm + direction toggles are gone; the shared RegenerateDialog
  // owns scope, direction and keyword now, so the editor only tracks whether it is open.
  const [regenDialogOpen, setRegenDialogOpen] = useState(false)
  const [approving,       setApproving]       = useState(false)
  const [retrying,        setRetrying]        = useState(false)
  const [error,           setError]           = useState('')
  const [isDirty,         setIsDirty]         = useState(false)
  const [fetchedBreakdown, setFetchedBreakdown] = useState<TopicBreakdown | null>(null)

  // Two-pane tabless layout: collapsible right-column sections + header strategy panel
  // Content only. All three used to open together, so the drawer landed on roughly 1,600px
  // of scroll and a first-time reviewer met the whole data model at once instead of the
  // article they came to read.
  //
  // The order matches what a review actually is: read the piece, check how it will rank,
  // decide where it goes. Only the first is needed to form an opinion, so only the first is
  // open — and because Publish holds the one prerequisite Approve can fail on, that section
  // opens itself when it does. Progressive disclosure that hid a blocker would be worse than
  // no disclosure at all.
  const [openSections, setOpenSections] = useState<Set<SectionId>>(new Set<SectionId>(['content']))
  const toggleSection = (id: SectionId) =>
    setOpenSections(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  const openSection = (id: SectionId) =>
    setOpenSections(prev => new Set(prev).add(id))
  const [showStrategy, setShowStrategy] = useState(false)
  const [isNarrow,     setIsNarrow]     = useState(false)

  // Image generation
  const [generatingImage,   setGeneratingImage]   = useState(false)
  const [imageUploadingMsg, setImageUploadingMsg] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Post fields
  const [title,           setTitle]           = useState('')
  const [seoTitle,        setSeoTitle]        = useState('')
  const [targetKeyword,   setTargetKeyword]   = useState('')
  const [content,         setContent]         = useState('')
  const [metaDescription, setMetaDescription] = useState('')
  const [slug,            setSlug]            = useState('')
  const [tags,            setTags]            = useState<string[]>([])
  const [tagInput,        setTagInput]        = useState('')

  // WP settings
  const [wpStatus,      setWpStatus]      = useState<WpPublishStatus>('draft')
  const [authorId,      setAuthorId]      = useState<number | null>(null)
  const [bcAuthorName,  setBcAuthorName]  = useState('')
  const [connectionId,  setConnectionId]  = useState<string>(defaultConnectionId ?? '')

  // Featured image
  const [featuredImageUrl, setFeaturedImageUrl] = useState('')
  // Openverse suggestions stored on the post at generation time. Empty is the normal
  // result for specialised topics — see lib/content/stockImages.ts.
  const [imageCandidates, setImageCandidates] = useState<StockImageCandidate[]>([])
  const [applyingStockId, setApplyingStockId] = useState<string | null>(null)
  /** The candidate being previewed full-size before it is applied. */
  const [lightboxCandidate, setLightboxCandidate] = useState<StockImageCandidate | null>(null)
  // Held separately from the drawer-wide error banner, which renders at the top of the edit
  // column -- far above the Images section, so it was never in view when an apply failed.
  const [stockApplyError, setStockApplyError] = useState<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [qualityReport, setQualityReport] = useState<any | null>(null)
  // Which confirmation is open, if any. Approve and Reject both reach the client's live site,
  // so neither fires on a bare click any more.
  const [confirming, setConfirming] = useState<null | 'approve' | 'reject' | 'discard'>(null)
  const [imageDialogOpen, setImageDialogOpen] = useState(false)
  const [libraryOpen,     setLibraryOpen]     = useState(false)
  const [findingStock,    setFindingStock]    = useState(false)
  /** Inline, non-error outcome of a stock search ("nothing new matched"). */
  const [stockNote,       setStockNote]       = useState('')

  // AI re-edit
  const [editNotes,     setEditNotes]     = useState('')
  const [showEditNotes, setShowEditNotes] = useState(false)

  // Authors + WP tags + categories
  const [authors,        setAuthors]        = useState<Author[]>([])
  const [authorsLoading, setAuthorsLoading] = useState(false)
  const [defaultAuthorId, setDefaultAuthorId] = useState<number | null>(null)
  const [wpTags,         setWpTags]         = useState<WpTag[]>([])
  const [categories,        setCategories]        = useState<WpCategory[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(false)
  const [categoryIds,       setCategoryIds]       = useState<number[]>([])
  const [categorySuggestion, setCategorySuggestion] = useState<CategorySuggestion | null>(null)
  const [newCategoryName,   setNewCategoryName]   = useState('')
  const [creatingCategory,  setCreatingCategory]  = useState(false)

  // Preview
  const [showPreview, setShowPreview] = useState(false)

  // Current keyword rank (DataForSEO datastream) — null until loaded, then possibly still null.
  const [keywordRank, setKeywordRank] = useState<{ current_position: number | null; previous_position: number | null; position_delta: number | null; movement?: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/content/keyword-rankings?post_id=${postId}`)
      .then(r => r.ok ? r.json() : { rank: null })
      .then(d => { if (!cancelled) setKeywordRank(d.rank ?? null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [postId])

  // Link health scan
  type LinkScanResult = {
    links:  { url: string; status: number | null; ok: boolean; redirected: boolean; finalUrl: string | null; error?: string }[]
    phones: { raw: string; digits: string; valid: boolean }[]
    scannedAt: string
  }
  const [linkScan,        setLinkScan]        = useState<LinkScanResult | 'scanning' | null>(null)

  /**
   * Did something change the ROW since the last push, without going through the editor?
   *
   * post.updatedAt is a snapshot taken when the drawer opened and nothing refreshes it, so
   * comparing it against last_pushed_at could only ever see changes that predated the drawer.
   * Saving, applying an image and regenerating all write server-side and leave isDirty false —
   * which is exactly the state the push button was being disabled in. This is set by those
   * handlers and cleared by a successful push.
   */
  const [changedSincePush, setChangedSincePush] = useState(false)

  const contentTextareaRef = useRef<HTMLTextAreaElement>(null)

  // Responsive: below 880px the panes stack and the left preview collapses to the overlay
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 880px)')
    const on = () => setIsNarrow(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  // Mark dirty on any field change after initial load
  const loadedRef = useRef(false)

  function markDirty() {
    if (loadedRef.current) setIsDirty(true)
  }

  // ── Load post detail ────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true)
      loadedRef.current = false
      try {
        const res = await fetch(`/api/admin/content/post?id=${postId}`)
        if (!res.ok) throw new Error('Failed to load post')
        const data: PostDetail = await res.json()
        setPost(data)
        setTitle(data.title ?? '')
        setSeoTitle(data.seoTitle ?? data.title ?? '')
        setTargetKeyword(data.targetKeyword ?? '')
        setContent(data.content ?? '')
        setMetaDescription(data.metaDescription ?? '')
        setSlug(data.slug ?? '')
        setTags(data.suggestedTags ?? [])
        setAuthorId(data.wpAuthorId ?? data.scheduleDefaultAuthorId ?? null)
        // The post's own byline wins over the client default, so a name typed here survives
        // a reload instead of being reset to the schedule setting on every open.
        setBcAuthorName(data.bcAuthorName ?? data.scheduleBcAuthor ?? '')
        setQualityReport(data.qualityReport ?? null)
        setCategoryIds(data.wpCategoryIds ?? [])
        setFeaturedImageUrl(data.featuredImageUrl ?? '')
        setImageCandidates(data.imageCandidates ?? [])
        // Seed connection: post's stored connection > schedule default > first BC site > first any site
        const autoSite = sites.find(s => s.connectorType === 'bigcommerce') ?? sites[0]
        setConnectionId(data.postConnectionId ?? defaultConnectionId ?? autoSite?.connectionId ?? '')

        // Default publish status: draft_only mode always overrides; otherwise use target date
        if (data.schedulePublishMode === 'draft_only') {
          setWpStatus('draft')
        } else if (data.targetPublishDate) {
          const publishDate = new Date(data.targetPublishDate + 'T00:00:00')
          setWpStatus(publishDate > new Date() ? 'future' : 'publish')
        } else if (data.schedulePublishMode) {
          setWpStatus('future')
        }

        // Auto-fetch topic breakdown when not passed as prop (e.g. monthly review context)
        if (topicBreakdown === undefined && data.topicId) {
          fetch(`/api/admin/content/topics/${data.topicId}`)
            .then(r => r.ok ? r.json() : null)
            .then((bd: TopicBreakdown | null) => { if (bd) setFetchedBreakdown(bd) })
            .catch(() => {})
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        setLoading(false)
        setTimeout(() => { loadedRef.current = true }, 100)
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId])

  // Poll every 10 s while a full-regenerate background job is running so the editor
  // unlocks and notifies the user as soon as the new content lands.
  useEffect(() => {
    if (post?.status !== 'generating') return
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/admin/content/post?id=${postId}`)
        if (!res.ok) return
        const updated: PostDetail = await res.json()
        if (updated.status !== 'generating') {
          setPost(updated)
          setTitle(updated.title ?? '')
          setContent(updated.content ?? '')
          clearInterval(timer)
          onRegenerateDone?.({ title: updated.title })
        }
      } catch { /* network blip — will retry */ }
    }, 10_000)
    return () => clearInterval(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.status, postId])

  // ── Load authors + WP tags when connectionId changes ───────────────────────
  const loadSiteData = useCallback(async (connId: string) => {
    if (!connId) return
    setAuthorsLoading(true)
    try {
      const [authRes, tagRes, catRes, settingsRes] = await Promise.all([
        fetch(`/api/admin/wordpress/authors?connection_id=${connId}`),
        fetch(`/api/admin/wordpress/tags?connection_id=${connId}`),
        fetch(`/api/admin/wordpress/categories?connection_id=${connId}`),
        post ? fetch(`/api/admin/content/settings?client_id=${post.clientId}`) : Promise.resolve(null),
      ])
      if (authRes.ok) setAuthors((await authRes.json()).authors ?? [])
      if (tagRes.ok)  setWpTags((await tagRes.json()).tags ?? [])
      if (catRes.ok) {
        const fetchedCats: WpCategory[] = (await catRes.json()).categories ?? []
        setCategories(fetchedCats)
        // Only suggest if the post has no explicit category selected yet
        if (!post?.wpCategoryIds || post.wpCategoryIds.length === 0) {
          setCategorySuggestion(suggestCategory(fetchedCats, post?.targetKeyword, post?.title))
        }
      }
      if (settingsRes?.ok) {
        const s = await settingsRes.json()
        const defId = s?.default_author_id ?? null
        setDefaultAuthorId(defId)
        // Auto-select default author if none chosen yet
        if (defId) setAuthorId(cur => cur ?? defId)
      }
    } catch {
      // silently ignore — optional data
    } finally {
      setAuthorsLoading(false)
    }
  }, [post])

  useEffect(() => {
    if (connectionId) loadSiteData(connectionId)
  }, [connectionId, loadSiteData])

  /**
   * Create a category on the client's WordPress site and select it here.
   *
   * Selecting it immediately is the point — the reviewer typed the name because they want
   * this post in it, so making them find it in the list afterwards would be a pointless
   * second step. An existing category of the same name is returned by the API rather than
   * erroring, so retyping a name that already exists just selects it.
   */
  const handleCreateCategory = useCallback(async () => {
    const name = newCategoryName.trim()
    if (!connectionId || name.length < 2) return
    setCreatingCategory(true)
    setError('')
    try {
      const res = await fetch('/api/admin/wordpress/categories', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ connection_id: connectionId, name }),
      })
      const data = await res.json() as { category?: WpCategory & { existed?: boolean }; error?: string }
      if (!res.ok || data.error || !data.category) throw new Error(data.error ?? 'Could not create the category')

      const created = data.category
      setCategories(prev => (prev.some(c => c.id === created.id) ? prev : [...prev, created]))
      setCategoryIds(prev => (prev.includes(created.id) ? prev : [...prev, created.id]))
      setNewCategoryName('')
      markDirty()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the category')
    } finally {
      setCreatingCategory(false)
    }
    // markDirty is a stable closure over a ref-guarded setter; including it would churn
    // this callback on every render without changing behaviour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, newCategoryName])

  const refreshCategories = useCallback(async () => {
    if (!connectionId) return
    setCategoriesLoading(true)
    try {
      const res = await fetch(`/api/admin/wordpress/categories?connection_id=${connectionId}`)
      if (!res.ok) return
      const fetchedCats: WpCategory[] = (await res.json()).categories ?? []
      setCategories(fetchedCats)
      // Re-run suggestion only if the user hasn't pinned a category
      if (categoryIds.length === 0) {
        setCategorySuggestion(suggestCategory(fetchedCats, post?.targetKeyword, post?.title))
      }
    } catch { /* non-fatal */ } finally {
      setCategoriesLoading(false)
    }
  }, [connectionId, categoryIds, post?.targetKeyword, post?.title])

  // Auto-scan links on mount when opened from a context that requests it (e.g. monthly review)
  useEffect(() => {
    if (autoScanLinks) handleScanLinks()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Live SEO computations ───────────────────────────────────────────────────
  const liveWordCount      = content ? countWords(content) : 0
  const liveHeadings       = content ? countHeadings(content) : 0
  const liveIntLinks       = content ? countInternalLinks(content) : 0
  const liveExtLinks       = content ? countExternalLinks(content) : 0
  const liveMetaLen        = (metaDescription ?? '').length
  const keywordInTitle     = seoCheck(title, targetKeyword)
  const keywordInSeoTitle  = seoCheck(seoTitle, targetKeyword)
  const keywordInMeta      = seoCheck(metaDescription, targetKeyword)
  const keywordSlug        = keywordInSlug(slug, targetKeyword)
  const slugLenOk          = slug.length > 0 && slug.length < 130
  const keywordInFirst     = targetKeyword && content
    ? seoCheck(content.replace(/<[^>]+>/g, ' ').slice(0, 500), targetKeyword)
    : false
  const keywordInSubhd     = content ? keywordInSubheadings(content, targetKeyword) : false
  const densityPct         = computeKeywordDensity(content, targetKeyword)
  const densityOk          = densityPct >= 0.5 && densityPct <= 2.0
  // The FEATURED image counts, not just images inside the article body.
  //
  // This judged the body alone, and the featured image is not in the body — so on a post whose
  // only picture is the generated featured one, the row was permanently red and no edit a
  // reviewer could make would clear it. That is the check the alt-text work exists to satisfy,
  // and it was the half that was never wired up.
  const imgAltKw           = (targetKeyword && post?.imageAltText ? seoCheck(post.imageAltText, targetKeyword) : false)
    || (content ? hasImageWithKeywordAlt(content, targetKeyword) : false)
  const metaLenOk          = liveMetaLen >= 150 && liveMetaLen <= 160
  const seoTitleLenOk      = seoTitle.length > 0 && seoTitle.length <= 60
  const isBlogPost         = (post?.contentType ?? 'blog') === 'blog'
  const hasTakeaways       = content ? hasKeyTakeaways(content) : false
  const headingHierOk      = content ? headingHierarchyClean(content) : false
  const slugClean          = slugQualityClean(slug)

  // ── Tag helpers ─────────────────────────────────────────────────────────────
  function addTag(name: string) {
    const trimmed = name.trim()
    if (trimmed && !tags.includes(trimmed)) { setTags(prev => [...prev, trimmed]); markDirty() }
  }

  function removeTag(name: string) {
    setTags(prev => prev.filter(t => t !== name)); markDirty()
  }

  function handleTagInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
      e.preventDefault()
      addTag(tagInput)
      setTagInput('')
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      setTags(prev => prev.slice(0, -1))
    }
  }

  // ── Jump to broken link in content textarea ─────────────────────────────────
  function jumpToLink(url: string) {
    const textarea = contentTextareaRef.current
    if (!textarea || !content) return
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const hrefMatch = new RegExp(`href=["']${escaped}["']`, 'i').exec(content)
    if (!hrefMatch) return
    const tagStart = content.lastIndexOf('<a', hrefMatch.index)
    const tagEnd   = content.indexOf('>', hrefMatch.index) + 1
    const selStart = tagStart >= 0 ? tagStart : hrefMatch.index
    const selEnd   = tagEnd > selStart ? tagEnd : selStart + url.length
    openSection('content')
    // setTimeout(50) gives the section-open re-render time to complete.
    // HTML has very few newlines so line-counting is unreliable — use a character-position
    // proportion against scrollHeight to center the match in the visible viewport.
    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(selStart, selEnd)
      const ratio = selStart / Math.max(content.length, 1)
      textarea.scrollTop = Math.max(0, ratio * textarea.scrollHeight - textarea.clientHeight / 3)
    }, 50)
  }

  // ── Jump to a phone number in the content textarea ──────────────────────────
  // Matched as literal text rather than through an href, because the scan finds numbers
  // both ways — inside a tel: link and as bare text in a paragraph — and a plain indexOf
  // is what covers both. The needle is the raw string the scan itself reported, so when a
  // number was found it is present in the body verbatim.
  function jumpToPhone(raw: string) {
    const textarea = contentTextareaRef.current
    if (!textarea || !content || !raw) return
    const idx = content.indexOf(raw)
    if (idx < 0) return
    openSection('content')
    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(idx, idx + raw.length)
      const ratio = idx / Math.max(content.length, 1)
      textarea.scrollTop = Math.max(0, ratio * textarea.scrollHeight - textarea.clientHeight / 3)
    }, 50)
  }

  // ── Save Changes ────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/content/posts/${postId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          title, seoTitle, content, metaDescription, slug,
          targetKeyword, suggestedTags: tags,
          featuredImageUrl: featuredImageUrl || null,
          wpStatus, authorId, categoryIds: categoryIds.length > 0 ? categoryIds : null,
          bcAuthorName: bcAuthorName || null,
          connectionId: connectionId || null,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to save')
      setIsDirty(false)
      // Saved to the row, not to the site. The live article is now behind this.
      setChangedSincePush(true)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
      // Tell the list behind us, without closing.
      onSaved?.({
        id: postId, status: post?.status ?? 'for_review',
        title: title || null, targetKeyword: targetKeyword || null,
        wordCount: liveWordCount, headingCount: liveHeadings, internalLinks: liveIntLinks,
        publishedUrl: post?.publishedUrl ?? null,
      })
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
      return false
    } finally {
      setSaving(false)
    }
  }

  // ── Monthly Review actions ───────────────────────────────────────────────────
  /**
   * Runs only after the reviewer has answered the confirmation.
   *
   * @param withEdits true  -> save the drawer first, so the push carries the current edits
   *                  false -> push what is already stored, discarding unsaved edits
   * A clean drawer never asks; the two are identical there.
   */
  async function performApprove(withEdits: boolean) {
    if (isDirty && withEdits) {
      // STOP if the save failed. handleSave reports failure by setting `error` and returning
      // normally, so simply awaiting it told the caller nothing: a failed save fell straight
      // through to the push, "Push with my changes" quietly became "push without them", and
      // the drawer closed over the error explaining why. That is the exact silent-save
      // failure this confirmation was added to prevent, reintroduced one level down.
      const saved = await handleSave()
      if (!saved) return
    }
    // Monthly review owns the push lifecycle (polling, live-post handling, the card badge),
    // so delegate there. Standalone, the drawer pushes for itself — which is the path the
    // calendar uses, and the one that had no confirmation at all.
    if (onMonthlyApprove) {
      onMonthlyApprove()
      onClose()
      return
    }
    await handleApprove(withEdits)
  }

  /** Both footers' Approve. Opens the confirmation; performApprove does the work. */
  function handleMonthlyApprove() { setConfirming('approve') }

  function handleMonthlyDiscard() {
    onMonthlyDiscard?.()
    onClose()
  }

  // ── Approve ─────────────────────────────────────────────────────────────────
  /**
   * @param persistEdits false when the reviewer chose "Push without my changes".
   *
   * This PATCHed the whole drawer unconditionally, so the discard choice was honoured one
   * level up and then undone here — the silent save-then-push the confirmation exists to
   * prevent, surviving inside the very function the confirmation calls.
   */
  async function handleApprove(persistEdits = true) {
    setApproving(true)
    setError('')
    try {
      const activeSite    = connectionId ? sites.find(s => s.connectionId === connectionId) : null
      const isBigCommerce = activeSite?.connectorType === 'bigcommerce'

      if (!activeSite) {
        // Open the section that holds the fix and say where it is. The old copy named a
        // "Settings tab", which this drawer has never had — the control is in Publish, below.
        openSection('publish')
        setError('Choose a site connection under Publish below, then approve.')
        setApproving(false)
        return
      }
      // No confirm here any more. handleApprove is now reached ONLY through
      // ConfirmActionDialog, which already states what pushing will do and, on a dirty
      // drawer, offers the with-edits/without-edits choice this native prompt cannot. Keeping
      // both meant two confirmations for one action, the second one cruder than the first.

      // Discarding edits does not mean discarding WHERE the post goes.
      //
      // The route below is chosen from the drawer's local connectionId, while the push route
      // reads connection_id from the ROW — so skipping the save entirely let the two disagree:
      // the browser would call the BigCommerce endpoint while the server resolved a WordPress
      // connection, or push to whichever site the row still remembered. connectionId is a
      // routing decision, not content, so it is persisted either way.
      const body = persistEdits
        ? {
            title, seoTitle, content, metaDescription, slug,
            targetKeyword, suggestedTags: tags,
            featuredImageUrl: featuredImageUrl || null,
            wpStatus, authorId, categoryIds: categoryIds.length > 0 ? categoryIds : null,
            connectionId,
          }
        : { connectionId }

      const saveRes = await fetch(`/api/admin/content/posts/${postId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      if (!saveRes.ok) throw new Error((await saveRes.json()).error || 'Failed to save edits')

      const route = isBigCommerce
        ? `/api/admin/content/posts/${postId}/publish-bigcommerce`
        : `/api/admin/content/posts/${postId}/approve`
      const pushRes = await fetch(route, { method: 'POST' })
      if (!pushRes.ok) {
        const body = await pushRes.json().catch(() => ({ error: 'Push failed' }))
        throw new Error(body.error || `Push failed (${pushRes.status})`)
      }
      const pushData = await pushRes.json().catch(() => ({}))

      onUpdate({
        id: postId, status: 'draft_saved',
        title: title || null, targetKeyword: targetKeyword || null,
        wordCount: liveWordCount, headingCount: liveHeadings, internalLinks: liveIntLinks,
        publishedUrl: (pushData.published_url as string | null) ?? post?.publishedUrl ?? null,
        wpPostId:  (pushData.wp_post_id  as number | null) ?? null,
        wpSiteUrl: (pushData.wp_site_url as string | null) ?? null,
      })
      setApproving(false)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve')
      setApproving(false)
    }
  }

  function handleReject() { setConfirming('reject') }

  async function performReject() {
    setError('')
    try {
      const res = await fetch('/api/admin/content/status', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ post_id: postId, status: 'rejected' }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      onUpdate({ id: postId, status: 'rejected', title: title || null, targetKeyword: targetKeyword || null, wordCount: liveWordCount, headingCount: liveHeadings, internalLinks: liveIntLinks, publishedUrl: post?.publishedUrl ?? null })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject')
    }
  }

  async function handleRetry() {
    if (!connectionId) {
      openSection('publish')
      setError('Choose a site connection under Publish below first.')
      return
    }
    setRetrying(true); setError('')
    try {
      // Save all editor state (including connectionId) before pushing — same as handleApprove
      const saveRes = await fetch(`/api/admin/content/posts/${postId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          title, seoTitle, content, metaDescription, slug,
          targetKeyword, suggestedTags: tags,
          featuredImageUrl: featuredImageUrl || null,
          wpStatus, authorId, bcAuthorName: bcAuthorName || null, connectionId,
        }),
      })
      if (!saveRes.ok) throw new Error((await saveRes.json().catch(() => ({}))).error || 'Failed to save')

      const activeSite = sites.find(s => s.connectionId === connectionId)
      if (!activeSite) throw new Error('Selected connection not found — refresh and try again')

      const isBigCommerce = activeSite.connectorType === 'bigcommerce'
      const route = isBigCommerce
        ? `/api/admin/content/posts/${postId}/publish-bigcommerce`
        : `/api/admin/content/posts/${postId}/approve`
      const pushRes = await fetch(route, { method: 'POST' })
      if (!pushRes.ok) {
        const body = await pushRes.json().catch(() => ({ error: 'Push failed' }))
        throw new Error(body.error || `Push failed (${pushRes.status})`)
      }
      const pushData = await pushRes.json().catch(() => ({}))
      onUpdate({
        id: postId, status: 'draft_saved',
        title: title || null, targetKeyword: targetKeyword || null,
        wordCount: liveWordCount, headingCount: liveHeadings, internalLinks: liveIntLinks,
        publishedUrl: (pushData.published_url as string | null) ?? post?.publishedUrl ?? null,
        wpPostId:  (pushData.wp_post_id  as number | null) ?? null,
        wpSiteUrl: (pushData.wp_site_url as string | null) ?? null,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed')
    } finally {
      setRetrying(false)
    }
  }

  async function handleRegenerate(notes?: string) {
    const direction = (notes ?? editNotes).trim()
    setRegenerating(true)
    setError('')
    onRegenerateStart?.()
    try {
      const res = await fetch('/api/admin/content/regenerate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ post_id: postId, edit_notes: direction || undefined }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to regenerate')
      const data = await res.json()
      setTitle(data.title ?? title)
      setSeoTitle(data.seoTitle ?? data.title ?? seoTitle)
      setContent(data.content ?? content)
      setMetaDescription(data.metaDescription ?? metaDescription)
      setSlug(data.slug ?? slug)
      if (data.focusKeyword) setTargetKeyword(data.focusKeyword)
      if (Array.isArray(data.suggestedTags) && data.suggestedTags.length > 0) setTags(data.suggestedTags)
      setEditNotes('')
      setShowEditNotes(false)
      setIsDirty(true)
      onRegenerateDone?.({ title: data.title ?? title })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate')
      onRegenerateError?.()
    } finally {
      setRegenerating(false)
    }
  }

  // Full-regenerate: picks a brand-new topic + keyword, generates fresh content.
  // Runs async in the background — the post status flips to 'generating' immediately.
  /** Routes the dialog's choice to the endpoint that actually does that thing. */
  async function handleRegenerateRequest(req: RegenerateRequest) {
    if (req.scope === 'rewrite') {
      await handleRegenerate(req.notes)
      return
    }
    await handleFullRegenerate(req.notes, req.steerKeyword)
  }

  async function handleFullRegenerate(notes?: string, steerKeyword?: string) {
    setFullRegenerating(true)
    setError('')
    onRegenerateStart?.()
    try {
      const res = await fetch(`/api/admin/content/posts/${postId}/full-regenerate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          edit_notes:    (notes ?? editNotes).trim() || undefined,
          // Steers WHICH topic is chosen — the content prompt would be too late.
          steer_keyword: steerKeyword?.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to start regeneration')
      // Reload post to pick up status='generating' for the polling effect
      const postRes = await fetch(`/api/admin/content/post?id=${postId}`)
      if (postRes.ok) setPost(await postRes.json())
      setEditNotes('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start regeneration')
      onRegenerateError?.()
    } finally {
      setFullRegenerating(false)
    }
  }

  async function handleScanLinks() {
    setLinkScan('scanning')
    try {
      const res = await fetch(`/api/admin/content/posts/${postId}/scan-links`, { method: 'POST' })
      if (!res.ok) throw new Error('Scan failed')
      const data = await res.json() as LinkScanResult
      setLinkScan(data)
    } catch {
      setLinkScan(null)
    }
  }

  // ── Stock image refetch ────────────────────────────────────────────────────
  // Re-runs the post's own topic against all three libraries. The only action here that
  // spends API quota, which is why it is a deliberate button and never automatic.
  async function handleFindStockImages() {
    setFindingStock(true)
    setError('')
    setStockNote('')
    try {
      const res = await fetch(`/api/admin/content/posts/${postId}/find-stock-images`, { method: 'POST' })
      const data = await res.json() as { candidates?: StockImageCandidate[]; message?: string; error?: string }
      if (!res.ok || data.error) throw new Error(data.error ?? 'Search failed')
      // An empty result leaves the existing set alone — the server declines to persist
      // one too, so clearing here would hide images the post still holds.
      if (data.candidates && data.candidates.length > 0) {
        setImageCandidates(data.candidates)
        setStockNote('')
      } else {
        // Finding nothing is expected on a narrow topic — the route calls it "a
        // legitimate, common answer rather than a failure" — so it is a note, not an
        // error, and it renders next to the button rather than in the banner at the top
        // of a panel the reviewer has scrolled past.
        setStockNote(data.message ?? 'No new images matched this topic.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not search for free images')
    } finally {
      setFindingStock(false)
    }
  }

  // ── Stock image selection ───────────────────────────────────────────────────
  // The server copies the chosen file into our own storage and writes
  // featured_image_url itself, so this does NOT markDirty — the change is already
  // persisted, and flagging the form dirty would invite a save that overwrites the
  // freshly-stored URL with whatever the editor had before.
  async function handleSelectStockImage(candidateId: string) {
    setApplyingStockId(candidateId)
    setError('')
    try {
      const res = await fetch(`/api/admin/content/posts/${postId}/select-stock-image`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        // Client-library picks carry the connection and attachment id, because they are not
        // in the post's stored candidate list — the server re-resolves them against that
        // site's own API rather than trusting a URL from here. Stock picks send neither and
        // resolve from the stored list exactly as before.
        body: JSON.stringify(
          candidateId.startsWith('wp-')
            ? { candidateId, connectionId, mediaId: Number(candidateId.slice(3)) }
            : { candidateId },
        ),
      })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || data.error) throw new Error(data.error ?? 'Could not apply that image')
      setFeaturedImageUrl(data.url ?? '')
      // Persisted server-side and deliberately not dirty — but the live article still has the
      // old picture, so the push button must stay reachable.
      setChangedSincePush(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply that image')
      // RETHROW. The modal awaits this and closes on resolve, so swallowing the error
      // here made a failed apply look identical to a success — the modal shut and the
      // only signal was an error banner at the top of a scrolled-down panel, reading as
      // "my click didn't register". Failures are real: a dead provider CDN 502s, a slow
      // one times out, a stale candidate id 400s. The modal catches this and stays open.
      throw err
    } finally {
      setApplyingStockId(null)
    }
  }

  // ── Image generation ────────────────────────────────────────────────────────
  /** Opens the steering dialog; the request itself is performGenerateImage. */
  function handleGenerateImage() { setImageDialogOpen(true) }

  async function performGenerateImage(req: { direction: string; notes: string }) {
    setGeneratingImage(true)
    setImageUploadingMsg('')
    setError('')
    try {
      const res = await fetch(`/api/admin/content/posts/${postId}/generate-image`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ direction: req.direction, notes: req.notes || undefined }),
      })
      const data = await res.json() as { url?: string; error?: string; candidates?: StockImageCandidate[] }
      // Generating also REWRITES the stored candidates as a side effect, so adopt the
      // returned list even when generation failed. Without this the strip keeps showing
      // tiles that no longer exist server-side, and each one 400s on click.
      if (data.candidates) { setImageCandidates(data.candidates) }
      if (!res.ok || data.error) throw new Error(data.error ?? 'Image generation failed')
      setFeaturedImageUrl(data.url ?? '')
      setIsDirty(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image generation failed')
    } finally {
      setGeneratingImage(false)
    }
  }

  async function handleImageFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImageUploadingMsg('Uploading…')
    setError('')
    try {
      const form = new FormData()
      form.append('image', file)
      const res = await fetch(`/api/admin/content/posts/${postId}/upload-image`, { method: 'POST', body: form })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || data.error) throw new Error(data.error ?? 'Upload failed')
      setFeaturedImageUrl(data.url ?? '')
      setIsDirty(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setImageUploadingMsg('')
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // ── Styles ──────────────────────────────────────────────────────────────────
  const Check = ({ ok, warn }: { ok: boolean; warn?: boolean }) => (
    <span style={{ color: ok ? 'var(--green)' : warn ? 'var(--amber, #f59e0b)' : 'var(--red)', fontWeight: 600, marginRight: 4, fontSize: '0.75rem' }}>
      {ok ? '✓' : '✗'}
    </span>
  )

  const inputStyle = {
    width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.875rem',
    border: '1px solid var(--border)', borderRadius: 6,
    background: 'var(--bg-surface)', color: 'var(--text-primary)',
    boxSizing: 'border-box' as const,
  }

  const labelStyle = {
    display: 'block', fontSize: '0.75rem', fontWeight: 600 as const,
    color: 'var(--text-muted)', marginBottom: '0.25rem',
  }

  // "Is there an article on the client's site" — a platform id OR a status that only exists
  // once something was pushed. Both, because either one alone is wrong.
  //
  // Status alone got it wrong in the place it matters most: regenerating a live post with
  // "replace" deliberately KEEPS wp_post_id — that is what makes the next push overwrite in
  // place — while setting status back to 'for_review'. The drawer then decided the post was
  // not on site, the On Site banner vanished, the button reverted to "Approve", and the
  // confirmation promised to publish something new at the exact moment it was about to
  // overwrite something already public.
  //
  // Shared with the pipeline and monthly-review cards rather than reimplemented here, which is
  // how the two definitions drifted apart in the first place.
  const isOnSite = post ? postIsOnSite(post) : false
  const isBc = (connectionId ? sites.find(s => s.connectionId === connectionId) : null)?.connectorType === 'bigcommerce'

  /**
   * Is the live article behind what this row holds?
   *
   * "Not dirty" was being used to mean "the site already has this", and it does not. A
   * replace-regenerate rewrites the post server-side and keeps the platform ids; applying an
   * image from the client's library is persisted server-side too. Both leave the editor clean
   * while the live article is now out of date — and those are precisely the cases where the
   * push button was greyed out with a tooltip insisting the live article already matched.
   *
   * So this reads the timestamps instead. It FAILS OPEN in every uncertain case — no push
   * recorded, no updated_at, unparseable dates — because a redundant push is one round trip
   * that overwrites an article with identical content, while a push that cannot be made leaves
   * the wrong article on a client's site with nothing in the UI admitting it.
   *
   * The two-second tolerance is slack, not a fix for a known skew: the updated_at trigger and
   * last_pushed_at are written in the same statement and land equal, so nothing depends on it.
   * It is there so a clock or replication wobble cannot make a just-pushed post read as stale.
   */
  const liveIsStale = (() => {
    if (changedSincePush) return true
    if (!post?.lastPushedAt) return true
    if (!post?.updatedAt)    return true
    const pushed  = new Date(post.lastPushedAt).getTime()
    const written = new Date(post.updatedAt).getTime()
    if (!Number.isFinite(pushed) || !Number.isFinite(written)) return true
    return written > pushed + 2000
  })()

  /** Nothing to send: it is on the site, unedited here, and the site has this version. */
  const nothingToPush = isOnSite && !isDirty && !liveIsStale

  // Live-post links (built once from the loaded post) — see lib/content/postLinks.ts
  const liveUrl        = post ? viewLiveUrl(post) : null
  const showLiveLink   = isPublicPermalink(liveUrl)

  /**
   * Is the article actually VISIBLE to the public, as opposed to merely on the site?
   *
   * "On site" covers a saved draft too, and a draft has no visitors and no rankings — so the
   * push confirmation has to tell the two apart before it promises anything about either.
   *
   * A public permalink alone does not settle it. BigCommerce is pushed unpublished but is still
   * given its public storefront URL, so every BC post looked live by that test. The status is
   * what the push actually recorded, so it decides, and the permalink is only consulted for
   * WordPress where it genuinely distinguishes a draft from a published post.
   */
  const isPubliclyLive = post?.status === 'published' || (!isBc && showLiveLink)

  // The featured image goes through the proxy here too, but this is a raw HTML string rather
  // than a ClientImage — so the fall-back-to-the-direct-URL behaviour the five React surfaces
  // get for free has to be written onto the tag. Without it a proxy refusal would leave both
  // preview panes showing a broken picture that renders fine in the panel beside them.
  // Prepared here rather than inline: this is a raw HTML string, and an attribute holding a URL
  // inside a template literal inside JSX is three levels of quoting to get wrong at once.
  const previewImgSrc      = proxiedImageSrc(featuredImageUrl, connectionId).replace(/"/g, '&quot;')
  const previewImgFallback = featuredImageUrl.replace(/"/g, '&quot;')
  const previewSrcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:Georgia,serif;max-width:780px;margin:2rem auto;padding:0 1.5rem;line-height:1.8;color:#1a1a1a;background:#fff}
    h1{font-size:2rem;line-height:1.3;margin-bottom:.5rem;color:#111}
    h2{font-size:1.5rem;margin-top:2rem;color:#111}
    h3{font-size:1.25rem;margin-top:1.5rem;color:#222}
    h4{font-size:1.1rem;margin-top:1.25rem;color:#333}
    p{margin-bottom:1.2rem}ul,ol{margin-bottom:1.2rem;padding-left:1.5rem}
    li{margin-bottom:.4rem}strong{font-weight:700}a{color:#2563eb;text-decoration:underline}
    img{max-width:100%;height:auto;border-radius:4px}
    blockquote{border-left:4px solid #e5e7eb;margin:1.5rem 0;padding:.75rem 1rem;color:#555;font-style:italic}
  </style></head><body>${featuredImageUrl ? `<img src="${previewImgSrc}" onerror="this.onerror=null;this.src=&quot;${previewImgFallback}&quot;" alt="" style="width:100%;border-radius:8px;margin-bottom:1.5rem" />` : ''}<h1>${title.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h1>${content}</body></html>`

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 50 }} />

      {/* Preview overlay */}
      {showPreview && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 53, background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1, fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>Preview — {title || 'Untitled'}</span>
            <button type="button" onClick={() => setShowPreview(false)} className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}>
              ✕ Close Preview
            </button>
          </div>
          <iframe srcDoc={previewSrcdoc} title="Post Preview" style={{ flex: 1, border: 'none', width: '100%' }} />
        </div>
      )}

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(1120px, 100vw)',
        background: 'var(--bg-surface)',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
        zIndex: 51, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 style={{ flex: 1, fontSize: '1rem', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
            Review Post
          </h2>
          {isDirty && (
            <span style={{ fontSize: '0.7rem', color: 'var(--amber, #f59e0b)', fontWeight: 500 }}>
              ● Unsaved changes
            </span>
          )}
          {post && (
            <span className={`badge ${post.status === 'for_review' ? 'badge-amber' : post.status === 'approved' ? 'badge-blue' : post.status === 'published' ? 'badge-green' : post.status === 'draft_saved' ? 'badge-blue' : 'badge-gray'}`} style={{ fontSize: '0.6875rem' }}>
              {post.status === 'draft_saved' ? 'Scheduled' : post.status === 'for_review' ? 'For Review' : post.status}
            </span>
          )}
          {(topicBreakdown ?? fetchedBreakdown) && (
            <button type="button" onClick={() => setShowStrategy(v => !v)} className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}>
              Strategy {showStrategy ? '▴' : '▾'}
            </button>
          )}
          {isNarrow && (
            <button type="button" onClick={() => setShowPreview(true)} className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}>
              Preview
            </button>
          )}
          {isOnSite && !post?.wpPostId && !post?.bcPostId && (
            <button type="button" onClick={handleRetry} disabled={retrying} className="btn btn-primary" style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}>
              {retrying ? 'Pushing…' : 'Retry Push'}
            </button>
          )}
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }} aria-label="Close">
            ✕
          </button>
        </div>

        {/* Strategy context — collapsible header panel */}
        {!loading && showStrategy && (topicBreakdown ?? fetchedBreakdown) && (
          <div style={{ borderBottom: '1px solid var(--border)', padding: '0.75rem 1.25rem', maxHeight: 260, overflowY: 'auto', background: 'var(--bg-subtle)' }}>
            {(() => {
              const bd = topicBreakdown ?? fetchedBreakdown
              if (!bd) return null
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {([
                    { key: 'keyword_opportunity', label: 'Keyword Opportunity', color: '#2563eb', bg: '#eff6ff' },
                    { key: 'ranking_strategy',    label: 'Ranking Strategy',    color: '#7c3aed', bg: '#f5f3ff' },
                    { key: 'audience_intent',     label: 'Audience Intent',     color: '#059669', bg: '#ecfdf5' },
                    { key: 'why_now',             label: 'Why Now',             color: '#d97706', bg: '#fffbeb' },
                    { key: 'competition_level',   label: 'Competition',         color: '#dc2626', bg: '#fef2f2' },
                  ] as Array<{ key: keyof TopicBreakdown; label: string; color: string; bg: string }>).map(({ key, label, color, bg }) => {
                    const val = bd[key]
                    if (!val || typeof val !== 'string') return null
                    return (
                      <div key={key} style={{ borderRadius: 8, border: `1px solid ${color}30`, background: bg, padding: '0.625rem 0.875rem' }}>
                        <div style={{ fontSize: '0.6875rem', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
                        <div style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', lineHeight: 1.6 }}>{val}</div>
                      </div>
                    )
                  })}
                  {bd.page_to_support && (
                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', padding: '0 0.25rem' }}>
                      <strong>Page to support:</strong>{' '}
                      <a href={bd.page_to_support} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>{bd.page_to_support}</a>
                    </div>
                  )}
                  {bd.competitors_researched && bd.competitors_researched.length > 0 && (
                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', padding: '0 0.25rem' }}>
                      <strong>Competitors researched:</strong>{' '}
                      {bd.competitors_researched.join(', ')}
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        )}

        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {/* Left: live rendered preview (wide screens only) */}
            {!isNarrow && (
              <div style={{ flex: '1 1 55%', borderRight: '1px solid var(--border)', minWidth: 0, background: '#fff' }}>
                <iframe srcDoc={previewSrcdoc} title="Live preview" style={{ width: '100%', height: '100%', border: 'none' }} />
              </div>
            )}

            {/* Right: single-scroll collapsible edit column */}
            <div style={{ flex: isNarrow ? '1 1 100%' : '1 1 45%', overflowY: 'auto', padding: '1.25rem', minWidth: 0 }}>
            {error && (
              <p className="text-xs mb-3" style={{ color: 'var(--red)', background: 'rgba(220,38,38,0.06)', padding: '0.5rem 0.75rem', borderRadius: 6 }}>
                {error}
              </p>
            )}

            {/* On Site banner */}
            {isOnSite && (
              <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid var(--green)', borderRadius: 6, padding: '0.5rem 0.75rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--green)', fontWeight: 600, fontSize: '0.8125rem' }}>✓ On Site</span>
                  {post && <PostSiteLinks post={post as unknown as PostLinkInput} fontSize={13} />}
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
                  {showLiveLink && liveUrl
                    ? 'This post is published on the client’s site. Edits here do not change the live article until you push them.'
                    : 'This post is saved to the client’s site as a draft. Nothing is visible to visitors until it is published.'}
                </p>
              </div>
            )}

            {/* ── SECTION: Content ──────────────────────────────────────────── */}
            <CollapsibleSection title="Content" open={openSections.has('content')} onToggle={() => toggleSection('content')}>
              {/* H1 Title */}
              <div className="mb-4">
                <label style={labelStyle}>H1 Title</label>
                <input type="text" value={title} onChange={e => { setTitle(e.target.value); markDirty() }} style={inputStyle} placeholder="Post H1 title" />
              </div>

              {/* Content */}
              <div className="mb-4">
                <label style={labelStyle}>Content (HTML)</label>
                <textarea ref={contentTextareaRef} value={content} onChange={e => { setContent(e.target.value); markDirty() }} style={{ ...inputStyle, minHeight: 280, fontFamily: 'monospace', fontSize: '0.8125rem', resize: 'vertical' }} placeholder="<h2>Introduction</h2><p>…</p>" />
              </div>

              {/* Content checks — links, phone numbers, and the quality note.
                  All three ask the same question about the body copy sitting directly above,
                  so they answer it in one place instead of being scattered down the drawer.
                  The phone readout comes off the same scan as the links and is the reason the
                  scan is worth running on a local-business post at all: a mistyped number
                  costs a call, which is the thing the article was written to earn. */}
              <div style={{ marginBottom: '1rem', marginTop: -4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minHeight: 24 }}>
                  {(linkScan === null || linkScan === 'scanning') ? (
                    <button
                      type="button"
                      onClick={handleScanLinks}
                      disabled={linkScan === 'scanning'}
                      style={{ fontSize: '0.72rem', padding: '3px 10px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, cursor: linkScan === 'scanning' ? 'default' : 'pointer', color: 'var(--text-muted)', opacity: linkScan === 'scanning' ? 0.65 : 1 }}
                    >
                      {linkScan === 'scanning' ? '⟳ Scanning…' : '🔗 Scan links & phone numbers'}
                    </button>
                  ) : (() => {
                    const brokenCount = linkScan.links.filter(l => !l.ok).length
                    const phones      = linkScan.phones ?? []
                    const badPhones   = phones.filter(p => !p.valid).length
                    return (
                      <>
                        {/* An article with no links is neutral, not a pass — "✓ All 0 links OK"
                            reads as a check that ran and succeeded, when nothing was checked.
                            Same treatment the phone readout gets below. */}
                        <span style={{ fontSize: '0.72rem', color: linkScan.links.length === 0 ? 'var(--text-faint)' : brokenCount > 0 ? '#dc2626' : '#16a34a' }}>
                          {linkScan.links.length === 0
                            ? 'No links'
                            : brokenCount === 0
                              ? `✓ All ${linkScan.links.length} link${linkScan.links.length !== 1 ? 's' : ''} OK`
                              : `⚠ ${brokenCount} broken link${brokenCount !== 1 ? 's' : ''} — see below`}
                        </span>
                        {/* Finding none is neutral, not a pass. Plenty of posts legitimately
                            carry no number, and colouring that green would claim a check
                            that never had anything to check. */}
                        <span style={{ fontSize: '0.72rem', color: phones.length === 0 ? 'var(--text-faint)' : badPhones > 0 ? '#b45309' : '#16a34a' }}>
                          {phones.length === 0
                            ? 'No phone numbers'
                            : badPhones === 0
                              ? `✓ ${phones.length} phone number${phones.length !== 1 ? 's' : ''} valid`
                              : `⚠ ${badPhones} of ${phones.length} phone number${phones.length !== 1 ? 's' : ''} to check — see below`}
                        </span>
                        <button type="button" onClick={handleScanLinks} style={{ fontSize: '0.68rem', padding: '1px 6px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', color: 'var(--text-faint)' }}>re-scan</button>
                      </>
                    )
                  })()}
                </div>
                {/* Full width on its own line: the pill opens into a list of findings, and at
                    the end of a flex row that list would unfold into a narrow column. */}
                <QualityFindings report={qualityReport} />
              </div>

              {/* Broken links — inline panel below content HTML */}
              {linkScan !== null && linkScan !== 'scanning' && (() => {
                const broken = linkScan.links.filter(l => !l.ok)
                if (broken.length === 0) return null
                return (
                  <div className="mb-4" style={{ border: '1px solid #fca5a5', borderRadius: 6, background: '#fff1f2', padding: '0.625rem 0.75rem' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#dc2626', marginBottom: '0.375rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      🔗 {broken.length} broken link{broken.length !== 1 ? 's' : ''} — click to jump
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {broken.map((l, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ flex: 1, fontSize: '0.75rem', color: l.redirected ? '#b45309' : '#dc2626', wordBreak: 'break-all' }}>
                            {l.redirected ? '↪' : '✗'} {l.url}{l.status ? ` (${l.status})` : l.error ? ` (${l.error})` : ''}
                          </span>
                          <button
                            type="button"
                            onClick={() => jumpToLink(l.url)}
                            style={{ fontSize: '0.7rem', padding: '2px 7px', background: '#fff', border: '1px solid #fca5a5', borderRadius: 4, cursor: 'pointer', color: '#dc2626', flexShrink: 0, whiteSpace: 'nowrap' }}
                          >
                            Jump ↓
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}

              {/* Phone numbers that do not parse as dialable — the same treatment as a
                  broken link, in amber rather than red because a number can be unusual
                  without being wrong, and the reviewer is the one who knows which. */}
              {linkScan !== null && linkScan !== 'scanning' && (() => {
                const bad = (linkScan.phones ?? []).filter(p => !p.valid)
                if (bad.length === 0) return null
                return (
                  <div className="mb-4" style={{ border: '1px solid #fcd34d', borderRadius: 6, background: '#fffbeb', padding: '0.625rem 0.75rem' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#b45309', marginBottom: '0.375rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {bad.length} phone number{bad.length !== 1 ? 's' : ''} to check — click to jump
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {bad.map((p, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ flex: 1, fontSize: '0.75rem', color: '#b45309', wordBreak: 'break-all' }}>
                            ✗ {p.raw} ({p.digits.length} digit{p.digits.length !== 1 ? 's' : ''})
                          </span>
                          <button
                            type="button"
                            onClick={() => jumpToPhone(p.raw)}
                            style={{ fontSize: '0.7rem', padding: '2px 7px', background: '#fff', border: '1px solid #fcd34d', borderRadius: 4, cursor: 'pointer', color: '#b45309', flexShrink: 0, whiteSpace: 'nowrap' }}
                          >
                            Jump ↓
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}

            </CollapsibleSection>

            {/* ── SECTION: Images ──────────────────────────────────────────────
                Its own section, because it was the only part of the review that had no home:
                it sat at the bottom of Content, under the article body, as a label and three
                buttons and a raw storage URL — and the picture, the thing actually being
                judged, came fourth in reading order.

                So the image leads and the controls sit beneath it, which is also the order a
                reviewer works in: look, then decide whether to change it. The URL field went
                entirely — pasting a storage URL into a review panel is not a standard worth
                setting, and every real source (library, generate, upload) has a button.

                The section is collapsed on open along with the others; only Content starts
                expanded, because a reviewer's first question is about the words. */}
            <CollapsibleSection title="Images" open={openSections.has('images')} onToggle={() => toggleSection('images')}>
              {featuredImageUrl ? (
                <>
                  {/* Once one of the client's own pictures is applied, featured_image_url
                      points at THEIR server — the file is referenced by attachment id rather
                      than copied, deliberately, so pushing it back does not duplicate it. That
                      makes this the one image on the page their host can refuse, so it goes
                      through the proxy. Anything we generated or uploaded is already ours and
                      is left alone. */}
                  <ClientImage
                    src={featuredImageUrl}
                    alt="Featured image"
                    connectionId={connectionId || null}
                    style={{
                      width: '100%', aspectRatio: '16 / 9', objectFit: 'cover',
                      borderRadius: 8, border: '1px solid var(--border)', display: 'block',
                      background: 'var(--bg-subtle)',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                    <button
                      type="button" onClick={() => setLibraryOpen(true)} className="btn btn-primary"
                      style={{ fontSize: '0.8125rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <Books size={14} weight="bold" />
                      Image library
                    </button>
                    <button type="button" onClick={handleGenerateImage} disabled={generatingImage} className="btn btn-secondary" style={{ fontSize: '0.8125rem' }}>
                      {generatingImage ? 'Generating…' : '✦ Generate with AI'}
                    </button>
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="btn btn-secondary" style={{ fontSize: '0.8125rem' }}>
                      {imageUploadingMsg || 'Upload'}
                    </button>
                    <div style={{ flex: 1 }} />
                    <button
                      type="button" onClick={() => { setFeaturedImageUrl(''); markDirty() }}
                      className="btn btn-secondary" style={{ fontSize: '0.8125rem', color: 'var(--red)' }}
                    >
                      Remove
                    </button>
                  </div>
                </>
              ) : (
                /* Empty state carries the primary action rather than a row of equals. */
                <div style={{
                  border: '1px dashed var(--border)', borderRadius: 8, padding: '28px 16px',
                  textAlign: 'center', background: 'var(--bg-subtle)',
                }}>
                  <p style={{ margin: '0 0 12px', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                    No featured image yet.
                  </p>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button
                      type="button" onClick={() => setLibraryOpen(true)} className="btn btn-primary"
                      style={{ fontSize: '0.8125rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <Books size={14} weight="bold" />
                      Open image library{imageCandidates.length > 0 ? ` · ${imageCandidates.length}` : ''}
                    </button>
                    <button type="button" onClick={handleGenerateImage} disabled={generatingImage} className="btn btn-secondary" style={{ fontSize: '0.8125rem' }}>
                      {generatingImage ? 'Generating…' : '✦ Generate with AI'}
                    </button>
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="btn btn-secondary" style={{ fontSize: '0.8125rem' }}>
                      {imageUploadingMsg || 'Upload'}
                    </button>
                  </div>
                </div>
              )}

              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageFileChange} style={{ display: 'none' }} />

            </CollapsibleSection>

            {/* ── SECTION: SEO & Meta ───────────────────────────────────────── */}
            <CollapsibleSection title="SEO & Meta" open={openSections.has('seo')} onToggle={() => toggleSection('seo')}>
              {/* SEO Title */}
              <div className="mb-4">
                <label style={labelStyle}>
                  SEO Title
                  <span style={{ fontWeight: 400, marginLeft: 6, color: seoTitle.length > 60 ? 'var(--amber, #f59e0b)' : seoTitle.length > 0 ? 'var(--green)' : 'var(--text-faint)' }}>
                    {seoTitle.length}/60
                  </span>
                </label>
                <input type="text" value={seoTitle} onChange={e => { setSeoTitle(e.target.value); markDirty() }} style={inputStyle} placeholder="SEO title (60 chars, includes focus keyword)" />
              </div>

              {/* Focus Keyword + URL Slug */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }} className="mb-4">
                <div>
                  <label style={labelStyle}>Focus Keyword</label>
                  <input type="text" value={targetKeyword} onChange={e => { setTargetKeyword(e.target.value); markDirty() }} style={inputStyle} placeholder="Primary keyword" />
                </div>
                <div>
                  <label style={labelStyle}>
                    URL Slug
                    {slug && <span style={{ fontWeight: 400, marginLeft: 6, color: slug.length > 130 ? 'var(--red)' : 'var(--text-faint)' }}>{slug.length} chars</span>}
                  </label>
                  <input type="text" value={slug} onChange={e => { setSlug(e.target.value); markDirty() }} style={inputStyle} placeholder="url-friendly-slug" />
                </div>
              </div>

              {/* Tags */}
              <div className="mb-4">
                <label style={labelStyle}>Tags</label>
                <div style={{
                  display: 'flex', flexWrap: 'wrap', gap: '0.375rem',
                  padding: '0.375rem 0.5rem', border: '1px solid var(--border)', borderRadius: 6,
                  background: 'var(--bg-surface)', minHeight: 38, cursor: 'text',
                }}
                  onClick={() => (document.getElementById('tag-input') as HTMLInputElement)?.focus()}
                >
                  {tags.map(tag => (
                    <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', fontWeight: 500, padding: '0.1rem 0.5rem', borderRadius: 4, background: 'var(--bg-muted)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                      {tag}
                      <button type="button" onClick={() => removeTag(tag)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: '0.75rem', padding: 0, lineHeight: 1 }}>×</button>
                    </span>
                  ))}
                  <input id="tag-input" type="text" value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={handleTagInputKeyDown} placeholder={tags.length === 0 ? 'Type tag, press Enter…' : ''} style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: '0.8125rem', color: 'var(--text-primary)', minWidth: 120, flex: 1 }} />
                </div>
                {wpTags.length > 0 && (
                  <div style={{ marginTop: '0.375rem', display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                    {wpTags.filter(t => !tags.includes(t.name)).slice(0, 12).map(t => (
                      <button key={t.id} type="button" onClick={() => addTag(t.name)} style={{ fontSize: '0.6875rem', padding: '0.1rem 0.4rem', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
                        + {t.name}
                      </button>
                    ))}
                  </div>
                )}
                <p style={{ fontSize: '0.6875rem', color: 'var(--text-faint)', marginTop: '0.25rem' }}>
                  Add/remove before publishing. Press Enter or comma to add a custom tag.
                </p>
              </div>

              {/* Meta description */}
              <div className="mb-4">
                <label style={labelStyle}>
                  Meta Description
                  <span style={{ fontWeight: 400, marginLeft: 6, color: liveMetaLen > 160 ? 'var(--amber, #f59e0b)' : liveMetaLen >= 150 ? 'var(--green)' : 'var(--text-faint)' }}>
                    {liveMetaLen}/160
                  </span>
                </label>
                <textarea value={metaDescription} onChange={e => { setMetaDescription(e.target.value); markDirty() }} rows={2} style={{ ...inputStyle, resize: 'vertical' }} placeholder="SEO meta description (150–160 characters)" />
              </div>

              {/* SEO checklist */}
              <div className="card mb-4" style={{ padding: '0.875rem 1rem', background: 'var(--bg-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: '0.5rem' }}>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: 'var(--text-faint)', margin: 0 }}>SEO Checklist</p>
                  {keywordRank?.current_position != null ? (
                    <span
                      title="Current keyword rank (DataForSEO)"
                      style={{
                        fontSize: '0.7rem', fontWeight: 700, padding: '1px 8px', borderRadius: 999,
                        background: keywordRank.current_position <= 3 ? '#dcfce7' : keywordRank.current_position <= 10 ? '#fef3c7' : 'var(--bg-muted)',
                        color: keywordRank.current_position <= 3 ? '#166534' : keywordRank.current_position <= 10 ? '#92400e' : 'var(--text-muted)',
                      }}
                    >
                      Rank #{keywordRank.current_position}
                      {keywordRank.position_delta ? (keywordRank.position_delta > 0 ? ` ▲${Math.abs(keywordRank.position_delta)}` : ` ▼${Math.abs(keywordRank.position_delta)}`) : ''}
                    </span>
                  ) : keywordRank?.movement === 'dropped' ? (
                    <span
                      title={`Dropped out of the tracked results${keywordRank.previous_position != null ? ` (was #${keywordRank.previous_position})` : ''} (DataForSEO)`}
                      style={{ fontSize: '0.7rem', fontWeight: 700, padding: '1px 8px', borderRadius: 999, background: 'var(--red-subtle)', color: 'var(--red)' }}
                    >
                      Rank dropped
                    </span>
                  ) : null}
                </div>
                {/* Data-driven so the list can be SORTED and SUMMARISED.
                    Eighteen checks in source order, all styled alike, made a reviewer scan
                    every row to find the two that were red — and offered no answer to the
                    only question being asked, which is "is this ready". Failures rise to the
                    top; the count says how much is left. */}
                {(() => {
                  const checks: { ok: boolean; warn?: boolean; label: string }[] = [
                    { ok: keywordInTitle,    label: 'Keyword in H1' },
                    { ok: keywordInSeoTitle, label: 'Keyword in SEO title' },
                    { ok: keywordInMeta,     label: 'Keyword in meta desc' },
                    { ok: !!keywordInFirst,  label: 'Keyword in opening' },
                    { ok: keywordInSubhd,    label: 'Keyword in subheading' },
                    { ok: densityOk,   warn: densityPct > 0 && !densityOk, label: `${densityPct.toFixed(1)}% density` },
                    { ok: liveWordCount >= 600, label: `${liveWordCount.toLocaleString()} words` },
                    { ok: liveHeadings >= 2,    label: `${liveHeadings} headings` },
                    { ok: metaLenOk,   warn: liveMetaLen > 0 && !metaLenOk, label: `Meta ${liveMetaLen}/160` },
                    { ok: liveIntLinks >= 1, label: `${liveIntLinks} internal link${liveIntLinks !== 1 ? 's' : ''}` },
                    { ok: liveExtLinks >= 1, label: `${liveExtLinks} external link${liveExtLinks !== 1 ? 's' : ''}` },
                    { ok: imgAltKw,    label: 'Image alt w/ keyword' },
                    { ok: keywordSlug, label: 'Keyword in slug' },
                    { ok: slugLenOk,   label: slug.length > 0 ? `Slug ${slug.length} chars` : 'No slug' },
                    { ok: seoTitleLenOk, label: 'SEO title ≤60 chars' },
                    ...(isBlogPost ? [{ ok: hasTakeaways, label: 'Key Takeaways box' }] : []),
                    { ok: headingHierOk, warn: liveHeadings > 0 && !headingHierOk, label: 'Heading hierarchy' },
                    { ok: slugClean,     warn: slug.length > 0 && !slugClean,      label: 'Clean URL slug' },
                  ]
                  const failed = checks.filter(c => !c.ok)
                  const passed = checks.filter(c => c.ok)
                  const ordered = [...failed, ...passed]

                  return (
                    <>
                      {/* One status line: the count, and how much of it is left.
                          The quality note used to sit on the right of this row. It is a
                          judgement about the ARTICLE rather than about the SEO fields, so it
                          now sits under the content it is judging, beside the link and phone
                          scan — the other two readouts that answer "is this sound to send". */}
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.6rem',
                        flexWrap: 'wrap',
                        fontSize: '0.775rem', fontWeight: 600,
                        color: failed.length === 0 ? 'var(--green)' : 'var(--text-secondary)',
                      }}>
                        <span>{passed.length}/{checks.length} passed</span>
                        {failed.length > 0 && (
                          <span style={{ color: 'var(--amber, #b45309)', fontWeight: 700 }}>
                            · {failed.length} to look at
                          </span>
                        )}
                      </div>
                      {/* auto-fit, not three fixed columns.
                          At the drawer's width three columns are ~150px each, which is
                          narrower than "Image alt w/ keyword" — so half the labels wrapped
                          mid-phrase and the tick drifted away from the words it marks. This
                          reflows to two columns when narrow and three when there is room, and
                          each row is a flex line so the mark stays with its label. */}
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))',
                        gap: '0.35rem 0.9rem', fontSize: '0.775rem', color: 'var(--text-muted)',
                      }}>
                        {ordered.map(c => (
                          <div
                            key={c.label}
                            style={{
                              display: 'flex', alignItems: 'baseline', gap: 5, lineHeight: 1.45,
                              ...(c.ok ? {} : { color: 'var(--text-secondary)', fontWeight: 500 }),
                            }}
                          >
                            <Check ok={c.ok} warn={c.warn} />
                            <span>{c.label}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )
                })()}

                {/* Link health lives under the Content field, not here.
                    Two readouts of the same scan, in two sections, is one too many — and
                    the useful place is beside the HTML whose links are being reported, not
                    at the bottom of a checklist about keywords. */}
              </div>
            </CollapsibleSection>

            {/* ── SECTION: Publish ──────────────────────────────────────────── */}
            <CollapsibleSection title="Publish" open={openSections.has('publish')} onToggle={() => toggleSection('publish')}>
              {/* Site connection selector */}
              <div className="mb-4">
                <label style={labelStyle}>Site Connection</label>
                <select value={connectionId} onChange={e => { setConnectionId(e.target.value); markDirty() }} style={inputStyle}>
                  <option value="">— Select a site —</option>
                  {sites.map(s => <option key={s.connectionId} value={s.connectionId}>{s.siteName} ({s.clientName})</option>)}
                </select>
              </div>

              {/* Author + publish status */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }} className="mb-4">
                <div>
                  <label style={labelStyle}>{isBc ? 'Author Name' : 'WP Author'}</label>
                  {isBc ? (
                    <input
                      type="text"
                      value={bcAuthorName}
                      onChange={e => { setBcAuthorName(e.target.value); markDirty() }}
                      placeholder="Author name displayed on the post"
                      style={inputStyle}
                    />
                  ) : (
                    <select value={authorId ?? ''} onChange={e => { setAuthorId(e.target.value ? Number(e.target.value) : null); markDirty() }} style={inputStyle} disabled={authorsLoading}>
                      <option value="">{authorsLoading ? 'Loading…' : '— Default —'}</option>
                      {authors.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.name}{a.id === defaultAuthorId ? ' (Default)' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div>
                  <label style={labelStyle}>Publish as</label>
                  <select value={wpStatus} onChange={e => { setWpStatus(e.target.value as WpPublishStatus); markDirty() }} style={inputStyle}>
                    <option value="future">Scheduled Published - Draft</option>
                    <option value="draft">Draft</option>
                    <option value="publish">Published</option>
                  </select>
                </div>
              </div>

              {/* WP Categories */}
              {categories.length > 0 && (
                <div className="mb-4">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>WP Categories</label>
                    <button
                      type="button"
                      onClick={refreshCategories}
                      disabled={categoriesLoading}
                      style={{ fontSize: '0.6875rem', padding: '0.125rem 0.5rem', borderRadius: '0.25rem', border: '1px solid var(--border)', background: 'var(--surface)', cursor: categoriesLoading ? 'default' : 'pointer', color: 'var(--text-muted)', opacity: categoriesLoading ? 0.6 : 1 }}
                    >
                      {categoriesLoading ? '⟳ Refreshing…' : '↻ Refresh'}
                    </button>
                  </div>

                  {/* Create a category without leaving the post. Previously the list was
                      read-only, so needing a category that did not exist meant going to
                      wp-admin, creating it there, coming back and re-opening the post —
                      and the auto-suggestion above can say "(will create)" for a category
                      there was no way to create from here. */}
                  <div style={{ display: 'flex', gap: 6, marginBottom: '0.375rem' }}>
                    <input
                      value={newCategoryName}
                      onChange={e => setNewCategoryName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleCreateCategory() } }}
                      placeholder="New category name…"
                      maxLength={200}
                      disabled={creatingCategory}
                      style={{ ...inputStyle, flex: 1, fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                    />
                    <button
                      type="button"
                      onClick={() => void handleCreateCategory()}
                      disabled={creatingCategory || newCategoryName.trim().length < 2}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.6875rem', padding: '0.125rem 0.625rem', whiteSpace: 'nowrap' }}
                      title="Create this category on the client's WordPress site and select it"
                    >
                      {creatingCategory ? 'Creating…' : '+ Add'}
                    </button>
                  </div>
                  {/* Auto-category suggestion — shown when no category is explicitly selected */}
                  {categorySuggestion && categoryIds.length === 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.375rem', fontSize: '0.75rem', padding: '0.25rem 0.5rem', borderRadius: '0.25rem', background: categorySuggestion.isNew ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)', border: `1px solid ${categorySuggestion.isNew ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.3)'}` }}>
                      <span style={{ color: 'var(--text-muted)' }}>Auto:</span>
                      <strong>{categorySuggestion.name}</strong>
                      <span style={{ color: categorySuggestion.isNew ? '#f59e0b' : '#10b981' }}>
                        {categorySuggestion.isNew ? '(will create)' : '(existing)'}
                      </span>
                      {!categorySuggestion.isNew && categorySuggestion.id && (
                        <button
                          type="button"
                          onClick={() => { setCategoryIds([categorySuggestion.id!]); markDirty() }}
                          style={{ marginLeft: 'auto', fontSize: '0.6875rem', padding: '0.125rem 0.375rem', borderRadius: '0.25rem', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}
                        >
                          Apply
                        </button>
                      )}
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', maxHeight: '8rem', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '0.375rem', padding: '0.375rem 0.5rem' }}>
                    {categories.map(c => {
                      const selected = categoryIds.includes(c.id)
                      return (
                        <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => {
                              setCategoryIds(cur => selected ? cur.filter(id => id !== c.id) : [...cur, c.id])
                              markDirty()
                            }}
                          />
                          {c.name}
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}

            </CollapsibleSection>
            </div>
          </div>
        )}

        {/* Footer actions */}
        {!loading && (
          onMonthlyApprove ? (
            <div style={{ padding: '0.875rem 1.25rem', borderTop: '1px solid var(--border)', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !isDirty}
                className="btn btn-secondary"
                style={{ fontSize: '0.8125rem', opacity: isDirty ? 1 : 0.5 }}
              >
                {saving ? 'Saving…' : savedFlash ? 'Saved ✓' : 'Save Changes'}
              </button>
              <div style={{ flex: 1 }} />
              {/* In monthly review the session owns the regeneration lifecycle (polling,
                  live-post handling), so delegate to it there. Standalone, the editor
                  opens the same dialog itself — otherwise removing the block under
                  publish would have left no way to regenerate from the queue at all. */}
              <button
                type="button"
                title="Regenerate — rewrite the article, or pick a new topic"
                aria-label="Regenerate this post"
                onClick={() => (onMonthlyRegenerate ? onMonthlyRegenerate() : setRegenDialogOpen(true))}
                className="btn btn-sm"
                disabled={saving || regenerating || fullRegenerating}
                style={{ padding: '4px 8px', display: 'inline-flex', alignItems: 'center' }}
              >
                <ArrowClockwise size={13} weight="bold" />
              </button>
              <button
                type="button"
                onClick={handleMonthlyDiscard}
                disabled={saving}
                className="btn btn-sm"
                style={{ background: '#7f1d1d', borderColor: '#7f1d1d', color: '#fff' }}
              >
                Discard
              </button>
              <button
                type="button"
                onClick={handleMonthlyApprove}
                // Nothing to push when the article is already live and unchanged. Leaving it
                // enabled invited a pointless round trip to the client's site, and leaving it
                // labelled "Approve" asked for an approval that had already happened.
                disabled={saving || nothingToPush}
                title={isOnSite
                  ? (isDirty
                      ? 'Send your changes to the live article'
                      : liveIsStale
                        ? 'This version has not been sent to the site yet — push it'
                        : 'The live article already matches this — edit something to push an update')
                  : undefined}
                className="btn btn-sm btn-primary"
                style={{
                  background: saving ? undefined : '#16a34a', borderColor: '#16a34a',
                  opacity: nothingToPush ? 0.55 : 1,
                }}
              >
                {saving ? '…' : isOnSite ? 'Push update' : 'Approve →'}
              </button>
            </div>
          ) : (
            <div style={{ padding: '0.875rem 1.25rem', borderTop: '1px solid var(--border)', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {/* Save Changes */}
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !isDirty}
                className="btn btn-secondary"
                style={{ fontSize: '0.8125rem', opacity: isDirty ? 1 : 0.5 }}
              >
                {saving ? 'Saving…' : savedFlash ? 'Saved ✓' : 'Save Changes'}
              </button>

              {/* Approve, or push an update to the article already on the site. */}
              <button
                type="button"
                onClick={handleMonthlyApprove}
                disabled={approving || nothingToPush}
                title={isOnSite
                  ? (isDirty
                      ? 'Send your changes to the live article'
                      : liveIsStale
                        ? 'This version has not been sent to the site yet — push it'
                        : 'The live article already matches this — edit something to push an update')
                  : undefined}
                className="btn btn-primary"
                style={{
                  fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: 5,
                  opacity: nothingToPush ? 0.55 : 1,
                }}
              >
                <ArrowCircleRight size={15} weight="bold" />
                {approving ? 'Saving…' : isOnSite ? 'Push update' : 'Approve'}
              </button>

              <div style={{ flex: 1 }} />
              <button
                type="button"
                title="Regenerate — rewrite the article, or pick a new topic"
                aria-label="Regenerate this post"
                onClick={() => setRegenDialogOpen(true)}
                className="btn btn-secondary"
                disabled={saving || regenerating || fullRegenerating}
                style={{ fontSize: '0.8125rem', display: 'inline-flex', alignItems: 'center', gap: 5 }}
              >
                <ArrowClockwise size={14} weight="bold" />
                Regenerate
              </button>
              <button type="button" onClick={handleReject} className="btn btn-secondary" style={{ fontSize: '0.8125rem', color: 'var(--red)' }}>
                Reject
              </button>
            </div>
          )
        )}
      </div>

      {lightboxCandidate && (
        <StockImageLightbox
          candidate={lightboxCandidate}
          busy={applyingStockId === lightboxCandidate.id}
          currentImageUrl={featuredImageUrl || null}
          connectionId={connectionId || null}
          error={stockApplyError}
          onClose={() => { setLightboxCandidate(null); setStockApplyError(null) }}
          onApply={() => {
            const id = lightboxCandidate.id
            setStockApplyError(null)
            // Close only on success — a failed apply leaves the preview up with the reason
            // shown in the dialog, rather than dismissing as though it had worked.
            void handleSelectStockImage(id)
              .then(() => { setLightboxCandidate(null); setStockApplyError(null) })
              .catch(err => setStockApplyError(
                err instanceof Error ? err.message : 'Could not apply this image. Please try again.',
              ))
          }}
        />
      )}
      {libraryOpen && (
        <ImageLibraryModal
          postTitle={title || post?.title || null}
          connectionId={connectionId || null}
          stockCandidates={imageCandidates}
          currentImageUrl={featuredImageUrl || null}
          applyingId={applyingStockId}
          applyError={stockApplyError}
          refreshingStock={findingStock}
          stockNote={stockNote}
          onRefreshStock={handleFindStockImages}
          onClose={() => { setLibraryOpen(false); setStockApplyError(null) }}
          onPreview={c => setLightboxCandidate(c)}
          onApply={(c: StockImageCandidate) => {
            setStockApplyError(null)
            // Closes only on success, so a failure keeps the grid and the selection on
            // screen with the reason in the footer, rather than dismissing as though it
            // had worked.
            void handleSelectStockImage(c.id)
              .then(() => { setLibraryOpen(false); setStockApplyError(null) })
              .catch(err => setStockApplyError(
                err instanceof Error ? err.message : 'Could not apply that image. Please try again.',
              ))
          }}
        />
      )}

      {imageDialogOpen && (
        <ImageDirectionDialog
          postTitle={title || post?.title || null}
          busy={generatingImage}
          onCancel={() => setImageDialogOpen(false)}
          onConfirm={req => { setImageDialogOpen(false); void performGenerateImage(req) }}
        />
      )}

      {confirming === 'approve' && (
        <ConfirmActionDialog
          // "On site" covers a saved DRAFT as well as a published article, and a draft has
          // neither visitors nor rankings — promising that "existing links and rankings stay
          // with it" described something that does not exist yet. showLiveLink is the same
          // signal the On Site banner uses to tell those two apart.
          title={isOnSite
            ? (isPubliclyLive ? 'Push your changes to the live article' : 'Push your changes to the saved draft')
            : 'Approve and push to the site'}
          subtitle={title || post?.title || null}
          body={
            isOnSite
              ? (isPubliclyLive
                  ? 'This overwrites the article already on the client’s site with what is in this drawer. The URL does not change, so existing links and rankings stay with it.'
                  : 'This overwrites the draft already saved on the client’s site with what is in this drawer. Nothing is visible to visitors until someone publishes it there.')
              : wpStatus === 'future'
                ? 'This pushes the article to the client’s site as a scheduled post. The site publishes it on its scheduled date; if that date has already passed it goes live immediately.'
                : wpStatus === 'publish'
                  ? 'This pushes the article to the client’s site and it goes live immediately.'
                  : 'This pushes the article to the client’s site as a draft. Nothing is visible to visitors until someone publishes it there.'
          }
          choices={
            isDirty
              ? [
                  { id: 'save',    label: 'Push with my changes',      hint: 'Saves the edits in this drawer first' },
                  { id: 'discard', label: 'Push without my changes',   hint: 'Unsaved edits in this drawer are lost' },
                ]
              : [{ id: 'save', label: isOnSite ? 'Push update' : 'Approve and push' }]
          }
          busy={saving || approving}
          onCancel={() => setConfirming(null)}
          onChoose={id => { setConfirming(null); void performApprove(id === 'save') }}
        />
      )}

      {confirming === 'reject' && (
        <ConfirmActionDialog
          title="Reject this post"
          subtitle={title || post?.title || null}
          body={'The post is taken out of the plan and its subject is added to the avoid-list, so it is not suggested again. The date stays filled, so nothing regenerates into it. This can be undone by restoring the post.'}
          choices={[{ id: 'reject', label: 'Reject', tone: 'destructive' }]}
          onCancel={() => setConfirming(null)}
          onChoose={() => { setConfirming(null); void performReject() }}
        />
      )}

      {regenDialogOpen && (
        <RegenerateDialog
          postTitle={title || post?.title || null}
          busy={regenerating || fullRegenerating}
          onCancel={() => setRegenDialogOpen(false)}
          onConfirm={req => { setRegenDialogOpen(false); void handleRegenerateRequest(req) }}
        />
      )}
    </>
  )
}

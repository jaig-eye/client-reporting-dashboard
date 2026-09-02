# What's New — preview/full-feature

> **Branch:** `preview/full-feature` | **Base:** `main` | **Commits ahead:** 13 | **Files changed:** 48 | **Date:** July 2026

---

## 1. Ad Library — Shareable Client Ad Gallery

**The big one.** Clients can now be sent a private link to a branded, no-login page showing all of their active and recent Meta and Google ads.

### What clients see
- A grid of ad cards, each showing the creative (image or video thumbnail), ad name, campaign → ad set hierarchy, headline + body copy (expandable if long), and a metric strip: **Spend · Impressions · CTR · Conversions**.
- Active/Paused status badge, platform badge (Meta / Google), and Google ad type (Display, Demand Gen, PMax).
- **Lightbox** — click any image or video to open it full-screen.
- **Filters:** All / Meta / Google platform toggle, Active / Paused status toggle.
- **Sort:** by Spend, Impressions, or CTR.

### How access works
- Access is via the client's existing `dashboard_token` — no new credentials needed.
- URL format: `/share/ads?token=<dashboard_token>`
- Admin side: a one-click **"Ad Library Link"** button on the client detail page copies the share URL to the clipboard.

### What's covered
- Meta and Google ads active in the **last 30 days**; creative metadata pulled from a 90-day window so images appear even on older ongoing ads.
- Deleted/removed ads excluded automatically.
- Google PMax (Performance Max) ads resolve images from the asset group table when no image is stored on the ad record.

### Meta image proxy — public auth
The `/api/proxy/meta-image` endpoint (used to safely stream ad images through the server) now accepts `?token=<dashboard_token>` as authentication in addition to the existing admin/client session cookies. Without this, the public Ad Library page would have had no way to load proxy images. The token is validated against the `clients` table before any image is served.

---

## 2. Meta Ad Image Sync — 3-Pass Creative Fetch Overhaul

The system that fetches creative images during the hourly Meta ad sync was rebuilt to be smarter about image quality and to fix the root cause of blank ad cards.

### The three passes (always ran — now fixed)

**Pass 1** — Batch-fetches creative data for all ad IDs (50 at a time). Sets the initial `image_url` from `creative.image_url`, falling back to `object_story_spec.link_data.picture` (OSS image). Also queues any ad with a real Facebook/Instagram post ID for Pass 2.

**Pass 2** — Fetches the Facebook/Instagram `full_picture` for post-backed ads. This gives a much higher quality image than the creative thumbnail. If Pass 2 finds a `full_picture`, the ad is marked as resolved so Pass 3 won't overwrite it.

**Pass 3** — Previously only ran for ads with absolutely no image. Now runs for any ad that doesn't have a direct `creative.image_url` — including ads that only had a low-res OSS thumbnail from Pass 1. Fetches a 1080px thumbnail from the creative object. Skips ads already resolved by Pass 2.

**Key fix:** The old code had `else if` between Pass 2 and Pass 3, meaning an ad queued for Pass 2 was never queued for Pass 3. With `else if`, ads where Pass 2 returned an empty or missing `full_picture` were left with a tiny OSS thumbnail. Changed to independent `if` blocks — now Pass 3 acts as a true safety net for any ad without a high-quality image, regardless of whether Pass 2 ran.

### Live enrichment (display-time backfill)
When the Ad Library page loads, any Meta ad that still has a null `image_url` is immediately enriched: a batch Meta Graph API call (50 ads per request) fetches the missing image, displays it right away, and writes it back to the database permanently so every future load shows it instantly.

---

## 3. Silo Optimization Engine

A full internal tool for building and managing SEO content silos. Adds five tabs inside the silo detail view:

### Keyword Map
AI generates a ranked list of primary, secondary, and supporting keywords for the silo's core topic — each with a search volume estimate, intent label (Informational / Commercial / Transactional / Navigational / Local), and keyword score. Admins can reassign types, toggle keywords on/off, or delete them.

### Content Plan
A structured list of every planned page (hub, supporting articles, guides, FAQs, comparisons) with status tracking: **Planned → Generated → For Review → Published**. Stats bar at top shows counts per status.

### Internal Link Recommender
Scans all planned pages and generates a linking plan: hub-to-supporting, supporting-to-hub, and cross-supporting opportunities. Each recommendation includes source → target, suggested anchor text, and a reason. Admins mark links as **Inserted / Ignored / Recommended**. Re-running is safe — already-linked pairs are skipped.

### Optimization Brief
Per-page AI briefs covering: target word count range, required H2/H3 headings, required terms + LSI terms with per-term frequency targets, Google entities, related questions (FAQ schema), schema type recommendations, E-E-A-T signals. Accepts up to 5 competitor URLs — content is fetched server-side, stripped to plain text, and factored into the brief.

### Content Audit
Fully deterministic (no AI call at runtime). Scores live page text against its brief across 9 weighted dimensions:

| Dimension | What it checks |
|---|---|
| Exact keyword | Primary keyword usage and placement |
| Keyword variations | Synonym and natural variation coverage |
| LSI terms | Latent semantic term coverage |
| Google entities | Named entities from the brief |
| Word count | Whether the page hits the target range |
| Page structure | H2s, H3s, bold, images, lists, tables |
| Schema | JSON-LD schema type presence |
| E-E-A-T | Author bio, citations, trust signals |
| Internal links | Compliance with the link plan |

Weighted composite score (0–100) saved with per-finding recommendations.

### One-click Build Plan
Generates the complete keyword map, planned pages list, and initial internal link plan in a single AI call.

### Technical notes
- Supports both **Anthropic (Claude)** and **OpenAI**.
- All AI calls fail gracefully — a bad response never blocks content publishing.
- Built on a **reverse silo / pillar-cluster strategy**: hub targets the broadest keyword, supporting pages target narrower terms and all link back.
- Silo names on the content overview page now link directly to the silo detail view ("View authority planner →").

---

## 4. Content Silo System — New Fields and Priority

Silos gained several new properties that unlock smarter automation:

### Content type
Each silo now has a `content_type`: `blog`, `service_page`, or `regular_page`. This lets the scheduler and cron jobs treat different types of content separately.

### Target keyword + Hub-first logic
A silo can store a `target_keyword` (the keyword for the hub/pillar page). When `target_exists = false`, the cron knows the hub page hasn't been created yet and forces the **first generated topic to target that hub keyword**. Once the hub topic is generated, `target_exists` is automatically flipped to `true`.

### Cluster keyword seeding
Each silo stores a `cluster_keywords` array — a planned keyword list with priorities. When the cron generates topics for a silo, it injects the top planned keywords (up to 12, sorted by priority) into the AI prompt so the AI prioritizes covering those specific terms rather than picking freely.

### Silo priority
Each silo has a `priority` number (25 = High, 100 = Medium, 175 = Low). The cron's auto-selection now picks the silo with the lowest priority number first — and within the same priority tier, picks the least-covered silo. Previously it just picked the least-covered silo regardless.

### Atomic pending_links append
A new database RPC (`append_silo_pending_link`) appends to the silo's `pending_links` array atomically. This prevents a race condition that could occur when two cluster posts from the same silo are WordPress-pushed in the same cron batch — both writing to the JSONB array at the same time.

### Content-type-filtered scheduling
Two new schedule settings — `generate_service_pages` and `generate_regular_pages` — control which content types the cron generates for a given client. When disabled, the cron filters out service page and regular page silos entirely.

---

## 5. Content Generation — Optimization Brief Injection

When generating a post for a topic that belongs to a silo, the generate route now checks for an existing **optimization brief** for that topic (or silo) and injects it directly into the AI prompt. This means the AI writes the post already aware of:
- The target keyword and required headings
- LSI term targets and frequency requirements
- Google entities to reference
- Internal link guidelines from the brief

Falls back to the standard `seo_brief` behavior if no optimization brief is found.

### Uncovered cluster topics in prompts
The AI prompt also now includes a list of uncovered cluster keywords from the silo — terms that are planned but don't have a page yet. The AI is instructed to mention or link to these future pages where contextually natural, pre-seeding internal link opportunities before those pages exist.

### Calendar generate — silo filter
The `POST /api/admin/content/calendar/generate` endpoint now accepts an optional `silo_id` parameter to scope topic generation to a specific silo.

### Topic regenerate — silo context preserved
When an admin regenerates a topic, the replacement topic is now generated with the original topic's silo context passed through — so the regenerated topic stays within the correct silo and keyword cluster.

---

## 6. WordPress Author Bug Fix

Posts were publishing under the "SEO" account (the API key's own WordPress user) instead of the configured author. Fixed at two points:

1. **Schedule generation** — new posts now seed `wp_author_id` from `content_settings.default_author_id`
2. **Publish route** — the approve/publish route now passes the resolved author ID to WordPress. Resolution order: post-level `wp_author_id` → schedule `default_author_id` → WordPress site default

---

## 7. WordPress Category Support

Content can now be assigned to one or more WordPress categories, controlled at two levels:

### Schedule-level defaults
A **Default Categories** multi-select in schedule config (populated live from the connected WordPress site) applies to every auto-generated post.

### Per-post override
A **WP Categories** multi-select in the post editor overrides the default before publishing.

Resolution order: post-level override → schedule default → unassigned. New DB columns: `wp_category_ids` on `content_posts`, `default_category_ids` on `content_settings`. New endpoint fetches the live category list directly from WordPress — no manual entry needed.

---

## 8. Uptime Monitor Improvements

### Faster down-site detection
Failure threshold lowered from 2 to 1 — down-sites detected within ~5 minutes instead of 10+. Alert behavior unchanged: down fires once on first failure, recovery fires once on restoration. No re-alerting while the site stays down.

### Cloudflare whitelist support
Scanner sends `LaunchLocal-Monitor/1.0` in the User-Agent. Clients can add one WAF Custom Rule (`http.user_agent contains "LaunchLocal-Monitor"` → Skip WAF + Bot Fight Mode + Rate Limiting) to prevent Cloudflare from blocking the health checks.

### Performance improvements
- Daily rollup now runs as a **single batch upsert** instead of one query per site.
- 7-day uptime recalculation runs concurrently via `Promise.all`.
- `today` date is derived from the canonical `checkedAt` timestamp captured at run start — prevents a rare edge case where checks taken just before UTC midnight could be rolled up into the wrong day's bucket.

### Sites page — full width
Now uses the full browser width, matching all other admin pages.

---

## 9. Ad Fuel Cron — DB Overload Safety

The Ad Fuel pause/resume crons now abort early if the spend RPC calls fail due to database overload, rather than continuing with bad spend data and making incorrect budget adjustments.

---

## 10. Silo UI Polish

### Animations
New CSS animations added for the silo manager:
- **Expand/collapse** — smooth CSS Grid row expansion (avoids the `max-height` "pop" artifact)
- **Cluster row enter** — slides in from the left when a new cluster keyword is added
- **Badge pop** — springy scale-in when status badges appear
- **Card stagger** — cards cascade in with a per-index delay when the silo list loads

### Sound effects
A `useSiloSounds` hook uses the Web Audio API to play subtle UI sounds (can be toggled):
- **Silo created** — ascending D4→F#4→A4 triangle arpeggio
- **Cluster added** — E4→E5 rising frequency sweep
- **Topic generated** — C5→G5 two-note fanfare

---

## 11. Content Calendar View

The content calendar is the main view inside each client's Blog Posts tab (and Service Area Pages tab). It shows the entire content pipeline — every topic and post — organized chronologically by publish date.

### Status bar
A row at the top shows color-coded counts by pipeline stage (Pending, Approved, Generating, For Review, Published, etc.) and a total item count. Updates in real time as actions are taken.

### Date groups
Topics and posts are grouped under publish-date headers. Each header shows:
- The publish date in bold.
- A dot-per-slot row that fills green as topics in that slot are approved — a fast visual of slot readiness.
- A fraction (e.g., "2/3") showing approved-vs-needed topics for the slot.
- A **Generate Slot** button that appears automatically once the quota is met and approved topics are ready. One click starts post generation for that entire date slot.

### Topic rows
Each topic row shows its status pill, title, and target keyword. Action buttons appear contextually:

| Button | When it appears |
|---|---|
| ✓ Approve | Topic is pending |
| ✎ Edit | Opens inline rename + AI direction notes |
| ↻ Regenerate | Replaces the topic idea with a new one |
| ▶ Generate Post | Topic approved, no post created yet |
| Review / Edit | Post is ready for review or saved as draft |
| ↗ Live link | Post is live in WordPress or BigCommerce |
| Retry | Generation previously failed |
| ✕ Reject | Removes the topic from the slot |

Clicking a topic with AI rationale attached expands an inline detail panel showing color-coded cards: **Keyword Opportunity · Ranking Strategy · Audience Intent · Why Now · Competition level**, plus any competitor URLs researched and a cannibalization warning if keyword overlap was detected.

### Published section
Posts that are published or saved as a final draft are grouped at the bottom under a "Published" header, with direct links to the live URL.

### Rejected toggle
A "Show Rejected (N)" link below the table reveals all rejected items inline. Click again to hide.

---

## 12. Monthly Review Flow

A dedicated admin workflow for batch-reviewing and approving all content scheduled to publish in the current and upcoming month — across every client — without navigating away from one page.

### How to access
Navigate to `/admin/content/monthly-review`. The page loads all posts in a reviewable state (`for_review`, `pending`, `approved`) with a publish date between today and the end of next month, then launches the review session.

### Progress bar (sticky header)
Pinned to the top of the screen throughout the session:
- **"Monthly Review — [Month Year]"** title.
- A green animated progress bar that fills as posts are approved.
- A live counter: "X of Y posts · A of B clients done."
- A sound toggle (♪ / ♩) — audio cues play at three moments: single post approved, all posts for a client done, entire session complete. Preference saved in local storage.
- **Exit Review** button.

### Client sections
Clients are listed as collapsible accordion panels. Each panel header shows the client name and an approved/total count (e.g., "2/3 approved"). Once all posts for a client are actioned, the panel collapses automatically, turns green, and shows a checkmark — clearing it visually from the remaining work.

### Post cards
Each post in the queue is a card showing (collapsed):
- Thumbnail image (or a document icon if none set).
- Post title, publish date, word count, and platform label (WP / BC).
- A content-type badge (Blog, Service Area, Service Page, Page).
- Three action buttons: **Regenerate** (flags the post for replacement, preserves the topic) · **Discard** (removes the post and topic permanently) · **Approve →** (queues for publishing).

Clicking the card before actioning it expands to show:
- A full-width featured image banner.
- **Content tab** — full rendered HTML of the post body (scrollable, max 360px).
- **SEO tab** — SEO Title, Meta Description, and Target Keyword.
- An **Open Editor** button that launches the full post editor overlay for deeper edits.

Once a decision is made, the buttons are replaced by an **Approved** or **Rejected** badge. Rejected cards fade to reduced opacity.

### Completion screen
When every post has been approved or rejected, the post list is replaced by a celebration screen: animated checkmark, session summary ("N posts approved across N clients"), and two exit paths — **View Content Calendar** or **Exit Review**.

---

## 13. Client Cycle Queue (Content Dashboard)

The content dashboard at `/admin/content` shows a **Client Cycle Queue** above the calendar — a live view of every client's upcoming topic generation cycle and what needs attention before posts can be generated.

### What it shows
Each client appears as a collapsible card. The header shows:
- Client name and a link to their content settings.
- Schedule frequency label (Daily, Weekly, Biweekly, Monthly, or "Global default").
- A **Generate Topics** button for on-demand AI topic generation.

When expanded, each pending topic shows:
- Topic title (with a spinning indicator if currently generating).
- Target keyword chip, competition level badge (green = Low, yellow = Medium, red = High), and target publish date.
- AI rationale chips: **Keyword · Strategy · Audience · Why Now · Competition** — the AI's reasoning for suggesting that topic.
- Contextual actions: **Schedule** (approve) or **✕** (reject) for pending topics; **Generate Post** for approved topics that failed to generate; an orange error message if generation failed.

### Workflow position
The cycle queue is the upstream step before Monthly Review. Topics are reviewed and approved here first; once enough topics are approved for a slot, post generation can run. Generated posts then flow into the Monthly Review queue for final approval.

---

## 14. Topics/Posts Per Run Removed — Hard-coded to 1

The `topics_per_run` and `posts_per_run` settings have been removed from all UI, API routes, and types. The pipeline now always generates exactly **1 topic per slot** and **1 post per approved topic** — no configuration, no clutter.

### What was removed
- "Topics per Run" slider and "Posts per Run" input removed from the schedule config panel.
- Both fields removed from the Setup Wizard save payload (wizard no longer exposes or stores them).
- Both fields removed from all API route `.select()` calls, destructuring, and type definitions.
- `ClientScheduleSettings` interface no longer includes either field.

### How it's enforced
Every path that previously read `topics_per_run` or `posts_per_run` from the DB now uses a hard-coded `1`:
- Cron auto-generation: `generateTopicsForClient(..., 1, ...)` — 1 topic per slot.
- Cron auto-approve: `.slice(0, 1)` — 1 topic approved per date group per run.
- Cron post generation: `.slice(0, 1)` — 1 post kicked off per run.
- Schedule route: `const postsPerRun = 1`.
- Topics `[id]` route: `const postsNeeded = 1`.

The DB columns are left in place (no destructive migration). Migration `167_topics_per_run_to_1.sql` sets all existing rows to `1` and changes the column default to `1`.

---

## 15. Service Pages + Regular Pages — Full Content Pipeline

Service Pages and Regular Pages previously had only an enable/disable toggle and a silo manager — no calendar, no topic generation, no post review. They now have the complete pipeline that Blog Posts has.

### Config panel
Each type has a collapsible config panel containing:
- **Topic Guidelines** — a textarea for AI instructions specific to that content type (e.g. "Focus on local intent, include pricing ranges").
- **Auto Generate** toggle — separate from blog's auto-generate, controls whether the cron auto-generates for this type.
- **Enable/Disable** toggle — existing behavior, now inside the panel.

Config is saved via the existing client-settings endpoint. New DB columns: `service_page_topic_guidelines`, `regular_page_topic_guidelines`, `service_page_auto_generate`, `regular_page_auto_generate`.

### Calendar table (PipelineCalendar)
A self-contained `PipelineCalendar` component renders the full calendar pipeline for each type:
- Topics and posts loaded by `content_type` filter.
- Date groups with slot dots, approve/reject/generate actions.
- **Generate Slot** button fires once approved topics are ready.
- **Clean up** button removes stale pending/approved topics from slots that already have a generated post.
- **Post review** — Review/Edit buttons open the existing `ContentPostEditor` overlay.
- Status bar shows pipeline stage counts in real time.

### Generate Plan modal
The "AI Content Plan" generate modal works for Service Pages and Regular Pages, passing `content_type` in the request so topics are tagged and prompted correctly.

### content_type-aware AI prompt
The topic generation AI (`generateTopics.ts`) now branches its system prompt and user prompt based on `content_type`:
- **service_page** → "Generate service landing pages targeting commercial/transactional intent — one page per service or service+location combination."
- **regular_page** → "Generate evergreen pages (About, FAQ, Resources, process pages) for navigational and foundational content."
- **blog** → existing blog post prompt (unchanged).

The `content_type` derives from the silo's own `content_type` field first, then the explicit `contentType` opt passed by the caller, then defaults to `'blog'`.

### Refresh signals
When a silo-based topic generation fires for Service Pages or Regular Pages, a refresh signal increments and `PipelineCalendar` reloads its data automatically — no manual refresh needed.

---

## 16. Setup Wizard — Step 6: Additional Content Types

The Content Setup Wizard (run when onboarding a new client) gains a new **Step 6: Additional Content Types** between Schedule (step 5) and Research (step 7). Total steps is now 8.

### What it covers
- **Service Pages** checkbox — enable AI-generated service landing pages, with an optional topic guidelines textarea.
- **Regular Pages** checkbox — enable AI-generated evergreen pages, with an optional topic guidelines textarea.
- Both are opt-in and skippable. Step 6 shows a "Skip →" button label in the footer.

### Re-run safe
When the wizard is opened on a client that already has settings, `loadInit()` now fetches the existing client settings and pre-populates the Service Pages and Regular Pages toggles and guidelines. Previously, re-running the wizard would reset those values to `false`.

### Save payload
The wizard's final save includes `generate_service_pages`, `generate_regular_pages`, `service_page_topic_guidelines`, and `regular_page_topic_guidelines` alongside the existing schedule fields.

---

## 17. Content Calendar Bug Fixes

Several bugs in the blog calendar (and new PipelineCalendar) were identified and fixed:

### hasGeneratedInSlot always returned false
The slot "Generate Slot" button visibility check read from a filtered group (which excluded `draft_saved` and `published` posts) — making the button appear even when a post had already been generated. Fixed: the check now reads from the raw (unfiltered) group so `draft_saved` and `published` posts are correctly detected.

### slotReady never triggered for SP/RP
The slot readiness check compared `approvedInGroup >= postsPerRun`, where `postsPerRun` was previously `2` (the old default). With the pipeline hard-coded to 1, the check now correctly uses `approvedInGroup >= 1`. The Generate Slot button now appears as soon as a single approved topic is in the slot.

### Topics stuck in "generating" on network errors
When `generateForSlot` kicked off a post generation request and the API returned an HTTP error, the `.catch` block only logged the error — the topic's status remained stuck at `'generating'` permanently. Fixed: the handler now checks `res.ok`, throws on failure, and the `.catch` resets the topic's status back to `'approved'` so the slot can be retried.

### bulk-reject missing ownership check
The `POST /api/admin/content/topics/bulk-reject` route accepted a list of topic IDs and rejected them with no `client_id` constraint — meaning an admin could theoretically reject topics belonging to any client. Fixed: `client_id` is now required in the request body, and the update query adds `.eq('client_id', clientId)` to scope the operation.

---

## Database Migrations

| Migration | What it adds |
|---|---|
| `164_silo_enhancements.sql` | `content_type`, `target_keyword`, `cluster_keywords`, `target_exists`, `priority` on `content_silos`; priority index for cron auto-selection; `append_silo_pending_link` RPC for atomic JSONB append |
| `165_silo_optimization_engine.sql` | 5 new tables: `content_silo_keywords`, `content_silo_pages`, `content_optimization_briefs`, `content_optimization_audits`, `content_silo_internal_links` |
| `166_wp_category_support.sql` | `wp_category_ids` on `content_posts`; `default_category_ids` on `content_settings` |
| `167_topics_per_run_to_1.sql` | Sets all `topics_per_run` rows to `1`; changes column default to `1` |
| `168_page_type_guidelines.sql` | Adds `service_page_topic_guidelines`, `regular_page_topic_guidelines`, `service_page_auto_generate`, `regular_page_auto_generate` to `content_settings` |

---

## New API Routes

| Route | Purpose |
|---|---|
| `GET /api/public/ads` | Public ad data — token-gated, no login |
| `GET /api/admin/wordpress/categories` | Live WP category list for a connection |
| `POST /api/admin/content/silos/[siloId]/build-plan` | AI-generate full silo plan in one call |
| `GET /api/admin/content/silos/[siloId]/keywords` | List silo keywords |
| `POST /api/admin/content/silos/[siloId]/keywords` | Create keyword |
| `PATCH /api/admin/content/silos/[siloId]/keywords/[id]` | Update / delete keyword |
| `GET /api/admin/content/silos/[siloId]/pages` | List planned pages |
| `POST /api/admin/content/silos/[siloId]/pages` | Create planned page |
| `PATCH /api/admin/content/silos/[siloId]/pages/[id]` | Update / delete page |
| `GET /api/admin/content/silos/[siloId]/internal-links` | List link recommendations |
| `POST /api/admin/content/silos/[siloId]/internal-links/recommend` | Re-run link recommender |
| `PATCH /api/admin/content/silos/[siloId]/internal-links/[id]` | Update link status |
| `POST /api/admin/content/optimization/build-brief` | Generate optimization brief |
| `GET /api/admin/content/optimization/briefs/[id]` | Fetch brief |
| `POST /api/admin/content/optimization/audit` | Run content audit against a brief |
| `GET /api/admin/content/optimization/audits/[id]` | Fetch audit result |
| `POST /api/admin/content/topics/bulk-reject` | Batch-reject topic IDs by client — used by slot "Clean up" action |

---

## 18. Ad Library — Mobile Optimization

The public Ad Library share page is now fully responsive for mobile clients.

- **Controls:** Platform/status filter pills and the sort dropdown stack into separate rows on small screens (≤600px). The separator dot hides on mobile. The sort dropdown expands to fill the available width.
- **Grid:** Collapses to a single column on phones (≤600px), two columns on tablets (601–880px), and auto-fill on desktop.
- **Page padding:** Reduced from `2rem 1.5rem` to `1.25rem 1rem` on mobile so content isn't unnecessarily inset on small screens.

---

## 19. Ad Library — Expired Image Fix

Meta CDN image URLs (`scontent-*.fbcdn.net`) are signed with short-lived tokens that expire quickly after being stored in the database. Cards were rendering these stale DB URLs directly, causing the "URL signature expired" errors visible in the browser network tab.

**Fix:** `AdLibraryCard` now routes all Meta ad images through the existing `/api/proxy/meta-image` endpoint when a token is present. The proxy calls the Meta Graph API on demand to get a fresh signed URL (cached server-side for 30 minutes) and returns a 302 redirect to it. The `token` threads from the share page → `AdLibraryView` → `AdLibraryCard`. The existing `onError` fallback still hides broken images gracefully if the proxy returns no result.

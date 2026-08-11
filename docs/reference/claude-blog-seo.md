# Reference: claude-blog — On-Page SEO Checklist

> **Source / attribution:** Distilled from the open-source **claude-blog** agent prompts by
> **AgriciDaniel** — https://github.com/AgriciDaniel/claude-blog (`agents/blog-seo.md`),
> licensed **MIT**. Reference copy only. The live checks run in
> [`src/lib/content/scoreSeoPost.ts`](../../src/lib/content/scoreSeoPost.ts) and the editor's
> SEO Checklist ([`src/components/admin/ContentPostEditor.tsx`](../../src/components/admin/ContentPostEditor.tsx)).

## Title tag
Clear, accurate, unique. Identifies the page and its purpose; natural language consistent with
visible content; not a duplicate of another page's title on the same site.

## Meta description
Accurate, page-specific, useful. Summarizes the visible page; specific enough to distinguish
from related content; most useful info early (truncation risk); avoid keyword stuffing.

## Heading hierarchy
No skipped levels + natural keyword use + accurate section labels. Single H1 (title only);
never H1→H3. Semantically consistent terminology. Declarative and question headings both valid.

## Internal links
3–10 contextual links per post (length-dependent). Descriptive anchor text (not "click here"/
"read more"). Spread throughout, not clustered. Check bidirectional linking where applicable.
*(Our app is internal-links-only from an allow-list; no external hyperlinks.)*

## External links
Tier 1–3 sources only, no broken links; support adjacent claims; `rel="nofollow"` for sponsored,
`rel="noopener"` for new tabs. *(In our app, sources are named in prose only.)*

## Canonical URL
Present + absolute + consistent. Absolute (not relative) URL; consistent trailing-slash
convention; no self-referencing errors.

## URL structure
3–5 words ideal; contains the primary keyword; no dates or special characters; lowercase only;
no stop words (the, and, of, etc.).

## Open Graph tags
Required: `og:title`, `og:description`, `og:image`, `og:type`. `og:image` 1200×630 minimum;
`og:type` = `article`.

## Twitter Card tags
`twitter:card` = `summary_large_image`; `twitter:title` under 70 chars; `twitter:description`
under 200 chars.

## Scoring bands
- **PASS:** 9/9 checks
- **NEEDS FIXES:** 7–8/9 checks
- **FAIL:** < 7/9 checks

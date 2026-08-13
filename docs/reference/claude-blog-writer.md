# Reference: claude-blog — Writer Quality Rules

> **Source / attribution:** Distilled from the open-source **claude-blog** agent prompts by
> **AgriciDaniel** — https://github.com/AgriciDaniel/claude-blog (`agents/blog-writer.md`),
> licensed **MIT**. This is a reference copy of the writer-quality techniques we adopted; it
> is NOT the machine source of truth. The enforced rules live in
> [`src/lib/content/blogStrategy.ts`](../../src/lib/content/blogStrategy.ts)
> (`BLOG_WRITER_QUALITY_RULES`), adapted to this app's constraints (HTML output,
> internal-links-only, no external hyperlinks, no tables).

## 1. Banned AI-tell phrases / filler
Replace these (and close variants) with clearer, specific alternatives:
"in today's digital landscape", "it's important to note", "dive into", "delve into",
"game-changer", "navigate the landscape", "revolutionize", "seamless"/"seamlessly",
"cutting-edge", "harness the power of", "leverage" (as a verb), "unlock", "elevate",
"empower", "robust", "streamline", "look no further", "rest assured", "at the end of the day",
"the world of", "a myriad of", "plethora".

## 2. Hard rules & guardrails
- **Em-dashes:** Do not use the U+2014 em dash. Replace with commas, colons, periods,
  parentheses, or a plain hyphen when grammatically correct.
- **Brand mentions:** Maximum 1 brand mention (author-bio context only). No promotional language.
- **Heading hierarchy:** One H1 (title only). H2s for main sections (mix declarative and
  question forms per intent). H3s for subsections — never skip levels.
- **Image/alt text:** Alt text is a full descriptive sentence (not just keywords). Only direct
  CDN/image-file URLs, not page URLs.
- **Citations:** Support material statistics with sources that actually substantiate them.
  Do not impose a statistic or citation-density quota.

## 3. Information-gain markers
- `<!-- ORIGINAL DATA: ... -->` — proprietary surveys, experiments, case-study metrics.
- `<!-- PERSONAL EXPERIENCE: ... -->` — first-hand observations, lessons learned, process docs.
- `<!-- UNIQUE INSIGHT: ... -->` — analysis others haven't made; contrarian, data-backed views.
- No minimum count; the marker itself earns no score.
  *(In our adaptation these are collapsed to `<!-- INSIGHT: -->` / `<!-- EXPERIENCE: -->`.)*

## 4. Key Takeaways box
After the introduction, generate a Key Takeaways box: concise bullets sized to the material,
no fixed length. Contains the post's key findings/recommendations. Include a verified statistic
only when it materially helps. Self-contained: makes sense without reading the full post.
Default format: `> **Key Takeaways**` as a bulleted list, not a prose paragraph.

## 5. Paragraph & sentence discipline
- Treat familiar paragraph ranges as optional planning aids; let completeness and comprehension
  set length. Start each paragraph with its most important sentence. One idea per paragraph.
- Choose sentence structure for clarity and emphasis; no fixed average/maximum. Active voice
  preferred. Natural, conversational tone.

## 6. Pre-submission self-check
- Important claims have context and verified support.
- Paragraph/sentence pacing fits the audience; length alone does not fail review.
- All statistics have named sources.
- Heading hierarchy is clean (H1 → H2 → H3).
- Meta description is accurate and consistent with visible content.
- Max 1 brand mention. FAQ included only when warranted.
- Natural, conversational tone throughout.
- Key Takeaways box present after the introduction.
- Information-gain markers identify supported original material.
- Zero em dashes.
- Every embedded image URL verified; image alt text is a full descriptive sentence.

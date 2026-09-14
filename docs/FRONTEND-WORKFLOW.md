# FRONTEND-WORKFLOW.md — How UI Work Is Designed and Checked

Every change someone will see goes through four steps: **research, plan, build, look at it.**

The last step is the one that matters most. Every serious UI defect in this project so far compiled cleanly and passed review — it was only visible once the page was rendered.

## What wins when sources disagree

1. The request itself.
2. This product's design system — `docs/DESIGN.md` and the theme variables in `src/app/globals.css`.
3. The `frontend-design` skill's process and principles.
4. Mobbin references.

The dashboard already has a visual identity. The `frontend-design` skill is written to give a *new* brief a distinctive look. Here, use its process (plan → review against the brief → build → critique) and its rules on copy and templated defaults — not its licence to invent a new palette or typeface.

---

## 1. Research — Mobbin

Before designing a new screen, flow, or significant component:

- Search Mobbin for how established products handle the same job — inviting a teammate, an approval queue, a content calendar, an empty state, a settings page.
- Pick 2–3 references. For each, note the pattern worth borrowing and why it fits *this* job.
- Borrow structure and behaviour: hierarchy, states, flow, copy patterns. Never another product's branding or visuals.

Skip this for small fixes — a colour, a label, a spacing bug.

**Setup:** Mobbin is an MCP server (`mobbin`, user scope). It needs a one-time sign-in: run `claude` in a terminal, then `/mcp` → **mobbin** → authenticate. If it isn't available in a session, say so and continue.

## 2. Plan — the `frontend-design` skill

Invoke `/frontend-design:frontend-design` (it also loads on its own for front-end design work). Before writing code, produce a short plan:

| Part | What it covers |
|---|---|
| Layout | One sentence and an ASCII wireframe |
| States | Empty, loading, error, success, disabled — and the long-content case: long names, long titles, many rows |
| Copy | Actions named for what they do; the same word through the whole flow ("Publish" → "Published"); errors that say what happened and how to fix it |
| Parts | Which existing components and theme variables it uses (see `docs/DESIGN.md`); anything new, and why it has to be new |

Review the plan against the design system before building. Where it deviates, say so and why.

## 3. Build — rules this codebase has already paid for

**Colours come from theme variables, never hex literals.**
Use `var(--bg-surface)`, `var(--text-primary)`, `var(--accent)`, `var(--green-subtle)`, `var(--red-subtle)`, `var(--amber-subtle)` and their siblings. Each has a dark-mode value in `globals.css`; a hex literal does not. `MonthlyReviewPostCard` uses `#dcfce7` and `#fee2e2` backgrounds, so in dark mode an approved card keeps a light background under light text and its title becomes unreadable.

**Colour matches meaning, and is never the only signal.**
Green is good, amber needs attention, red is a problem. A "Competition: low" box tinted red reads as a warning when it is good news. Pair colour with a label or icon.

**Reuse before you build.** Check `docs/DESIGN.md` for an existing component first.

**Quality floor.** Works down to a phone width, visible keyboard focus, reduced motion respected (see `docs/DESIGN.md` → Animation Patterns).

## 4. Look at it — before committing

UI work is not done until it has been rendered and looked at.

- **Screenshot every planned state in light and dark, at desktop (1440px) and mobile (390px).**
- **Look for:** unreadable contrast; text overflowing or truncating badly; misalignment; layout shifting between states; anything that looks different from its neighbours for no reason.
- When changing an existing screen, compare against screenshots taken before the change.
- A page that redirects to the login screen is not a screenshot of that page. The script below flags it.

### Tools

| Tool | What it shows | How to use it |
|---|---|---|
| Design sandbox — `/dev/design` | Real components with made-up data. No login, no database. Returns 404 in production. | `npm run dev`, then open `http://localhost:3000/dev/design` |
| `scripts/design-shots.mjs` | Full-page screenshots of any pages, light and dark × desktop and mobile, saved to `.design-shots/` | `npm run design:shots -- dev/design` |
| Full-page tour *(planned)* | Every real page with realistic data, signed in as a test admin | Needs a staging database — see below |

To show a component in the sandbox, add a section to `src/app/dev/design/DesignGallery.tsx` covering its states.

Pass page paths with or without the leading slash. In Git Bash leave it off (`dev/design`, not `/dev/design`) — Git Bash rewrites a leading-slash argument into a Windows path before the script sees it. The script detects that and tells you.

`design-shots` can sign in through the real login route with `DESIGN_SHOTS_EMAIL` and `DESIGN_SHOTS_PASSWORD`, and target another host with `DESIGN_SHOTS_BASE_URL`. Only ever point it at a staging environment with a test account — never production.

### Planned: full pages against a staging database

The sandbox shows components. It cannot show a real page, a broken query, or a missing column. The target setup:

- **A separate Supabase project for staging**, with the full schema and realistic seeded data: clients, posts in every status, metrics, connections. `supabase/schema_master.sql` only covers migrations 001–065, so the full migration history is needed.
- **A seeded test admin account**, so screenshots go through the real login. No auth bypass in the code.
- **Vercel Preview and local development pointed at staging**, so previews stop running unreviewed code against production data.
- **`design-shots` run over every page** — 31 admin, 11 client dashboard — before a UI change is committed.

---

## Definition of done for UI work

- [ ] Mobbin references noted (new screens and flows)
- [ ] Plan written and reviewed against `docs/DESIGN.md`
- [ ] Theme variables only — no hex literals
- [ ] Every planned state screenshotted in light and dark, desktop and mobile — and looked at
- [ ] Copy checked: action names, error messages, empty states

# Admin UI

How the admin (`src/app/admin/`, `src/components/admin/`) is built: the rules every page follows,
the shared components, and where styles live. Colour tokens and the client dashboard are in
[DESIGN.md](DESIGN.md).

## Scope

- `src/styles/admin.css` loads in the admin layouts only. Every rule in it is a `ui-` or `adm-`
  class or is scoped under `.adm` (the admin shell's root), so a shared class like `.card` only
  changes inside the admin.
- The client dashboard (`src/app/dashboard/`) and the ad library (`src/app/share/`) use
  `globals.css` and aren't restyled from here.

## Rules

- **Theme tokens only, no hex.** `var(--accent)`, `--accent-soft`, `--bg-surface`, `--bg-subtle`,
  `--text-muted`, `--border`, `--green-fg` / `--red-fg` / `--amber-fg` for status text, `--on-fill`
  for text on a solid button, `--accent-fg` for text set in the accent (readable in dark mode,
  where plain `--accent` text is not). Inside `.adm`, `--text-faint` is darkened to pass 3:1 on
  admin surfaces; keep it for quiet text, never for anything someone has to read to act. The
  exceptions are things shown as they really look: the post preview's iframe stylesheet and the
  email preview's light canvas.
- **Sentence case** for headings, labels, buttons and tabs.
- **Skeletons, not "Loading…".** Use the `Sk*` pieces, and give each route a `loading.tsx`. A busy
  button can still say "Saving…".
- **In-app links use `next/link`**, never `window.location`.
- **390px wide, light and dark.** Every page and dialog works at both.
- **Exact times.** Anything someone wrote or something that happened (a note, an alert) shows its
  date and clock time ("Sep 29, 2026, 4:12 PM"; under a day heading, just the time). "3 days ago"
  goes in the tooltip, never in place of the time.
- **Phosphor icons**, not emoji or text arrows.
- **Deletes ask first** in a `ConfirmDialog`, never `window.confirm`. A failed delete throws from
  `onConfirm`, and the dialog shows the message and stays open.
- **One client's data at a time.** A screen about one client offers only that client's sites,
  contacts and settings, and never guesses one when there is none: it says so ("No site
  connected") and links to where to add it. The API checks the same thing on save
  (`lib/content/postConnection`).

## Settings

Everything you configure sits behind one sidebar item, **Settings**. `SettingsShell`
(`src/components/admin/SettingsShell.tsx`) puts the same grouped menu (Agency, Workspace,
Personal) beside every settings page. On a wide screen it's a column; below 1180px it's a
"Settings › Branding" button that opens the list in a sheet. AdminShell adds it to any path
`isSettingsPath` matches, so pages keep their own URLs.

- A new settings page: add it to `SETTINGS_GROUPS` and its path to `isSettingsPath` / `activeId`.
- AI keys (the writing model and the featured-image key) are a connection, so they live on
  Integrations (`AiAgencyCards`), not in Settings. `/admin/settings?tab=ai` redirects there.
- Agency settings' sections are `?tab=` values (`settings/tabs.ts`). On `/admin/settings` the
  menu switches them in place with `history.pushState` (no request, edits survive, Back works),
  and `AgencySettings` reads the section from `useSearchParams`.

## Shared components (`src/components/ui`)

| Component | Use it for |
|---|---|
| `PageHeader` | Every page's title, one-line description, back link and actions |
| `Section` | A titled card holding a group of settings or a list (`flush` for tables) |
| `PillTabs` / `RouteTabs` | Tabs inside a page (state or `?tab=`) / tabs that are routes |
| `ActionMenu` | The ⋯ menu on a row. It returns focus to its button before running an item |
| `StatusBadge` | A status: `success`, `warning`, `danger`, `info`, `neutral` |
| `Tile`, `BrandLogo`, `Avatar` | The tinted square an icon or logo sits in; platform logos; people |
| `EmptyState` | Nothing here yet, or something failed: say what happened and what to do |
| `Skeleton` (`Sk`, `SkPage`, `SkHeader`, `SkRows`, `SkTable`, `SkCard`, …) | Loading states |
| `Switch` / `SwitchRow` | On/off. A real checkbox, so it can't submit a form by accident |
| `Field` | A label, the control, a hint and an error |
| `Dialog` / `ConfirmDialog` | Every modal, side sheet and yes/no question |

### Dialog

```tsx
<Dialog open={open} onClose={close} title="Edit site" description="harbor-dental.example"
  busy={saving} onSubmit={save}
  footer={<>
    {error && <p className="ui-dialog-error" role="alert">{error}</p>}
    <button type="button" className="btn btn-secondary" onClick={close}>Cancel</button>
    <button type="submit" className="btn btn-primary">Save changes</button>
  </>}>
  …fields…
</Dialog>
```

It portals into `.adm`, traps Tab, locks the page scroll, closes on Escape or a click outside
(not while `busy`), and gives focus back to whatever opened it. On a phone it's a bottom sheet
with stacked full-width buttons. Options:

- `variant="side"` for a full-height sheet from the right (email details); `size` `sm`–`xl`.
- `onSubmit` makes it a form, so Enter submits.
- `onEscape` steps back out of an edit before closing.
- `actions` puts small buttons beside the close button (pin, edit).
- `initialFocus` takes a ref, or `'dialog'` to focus the panel itself in a read-mostly view.
  Otherwise focus goes to the first field, then the main action.

## Styles

- `src/styles/admin.css` holds the shell and every shared `ui-` class. Per-page styles live in
  `src/styles/admin/*.css`, and each page imports its own file.
- Helper classes:
  - `ui-notice` (`--danger`, `--warning`, `--success`, `--info`)
  - `ui-grid-2` (two columns that stack on a phone)
  - `ui-hide-sm` / `ui-only-sm`
  - `ui-saverow` + `ui-saved` / `ui-savefail` (a save button and what happened)
  - `ui-x` (a remove button), `ui-toast`, `ui-table`, `ui-row`
- Each page's classes have a short prefix. Check this list before picking a new one:

| Prefix | Where |
|---|---|
| `adm-`, `ui-`, `sx-` | Shell; shared pieces; the Settings menu (`admin.css`) |
| `cl-`, `int-`, `nc-`, `cc-` | Clients, integrations, new connection, client content sub-tabs (`admin.css`) |
| `us-` | Usage (`admin.css`) and Users (`users.css`). The names don't overlap yet, so check both |
| `se-`, `nt-` | Settings hub, notification table (`settings.css`) |
| `mr-`, `cal-`, `cs-`, `sd-`, `ra-` | Monthly review, calendar, content settings, silo detail, rationale (`content.css`) |
| `pl-`, `sm-`, `ccs-`, `wz-`, `pe-`, `cp-` | Pipeline, sitemap, client content settings, setup wizard, post editor, plan (`pipeline.css`) |
| `co-`, `af-`, `em-`, `st-`, `sy-`, `al-` | Client overview, Ad Fuel, emails, sites, system, alerts |
| `au-` | Signed-out pages: login, forgot and reset password (`auth.css`, with the mesh in `LoginCanvas`) |
| `pv-`, `ap-`, `np-`, `ccs-cadence` | Preview bar and client switcher, Ad Fuel auto-pause, the note's client, the schedule fields (`admin.css`) |
| `il-`, `lb-` | Image library and stock-image lightbox (`pipeline.css`) |
| `cco-`, `pto-`, `kw-`, `pt-` | Content → Clients, priority topics overview, keywords, priority topics (`globals.css`; `pt-ext` is in `admin.css`) |

`pt-` (PriorityTag) and `cal-filter-tab` are taken in `globals.css`.

## Gotchas

- A `<button>` inside a `<form>` submits it unless it has `type="button"`.
- A plain value exported from a `'use client'` file reaches a server component only as a
  reference. Shared constants go in a plain module, like `settings/tabs.ts`.
- A media-query override needs at least the specificity of the rule it overrides. `.nt td` beats
  `.nt-ch--none`, so the phone rules are written `.nt .nt-ch--none`.
- Tailwind's preflight makes `svg` `display: block`. An icon inline with text needs
  `display: inline-block`.
- `.ui-only-sm` reverts `display`, which leaves a `<span>` inline, and an inline element can't
  clip with an ellipsis. Use a `<div>` when it must.
- `useState(initialProps)` goes stale after `router.refresh()`. Derive the list from props instead.
- The `hidden` attribute loses to any class that sets `display`, because preflight's `[hidden]`
  rule is no more specific. `admin.css` makes it win inside `.adm`.
- `--accent-subtle` is a fixed light tint and turns into a white patch in dark mode. Use
  `--accent-soft`.

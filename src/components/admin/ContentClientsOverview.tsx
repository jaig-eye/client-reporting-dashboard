'use client'

// The Content page's Clients view: one row per client with content settings — automation, schedule,
// where posts go, how far the plan reaches, what's waiting — with problems flagged so nothing hides in
// a client's nested settings. Read-only; every row opens that client's Pipeline. The page reads the
// data (lib/content/clientsOverviewData) and the flags come from lib/content/clientOverviewFlags.

import Link from 'next/link'
import { useState } from 'react'
import { Article, WarningCircle } from '@phosphor-icons/react'
import EmptyState from '@/components/ui/EmptyState'
import { Explained, HelpTip } from '@/components/admin/KeywordUi'
import { issueCount, type ClientOverviewRow, type OverviewFlag } from '@/lib/content/clientOverviewFlags'

const pipelineHref = (id: string) => `/admin/clients/${id}?tab=content&subtab=pipeline`

/** "Oct 5" this year, "Oct 5, 2027" otherwise. Dates are calendar days, so read in UTC. */
function fmtDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return iso
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear()
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC', ...(sameYear ? {} : { year: 'numeric' }) })
}

function ago(days: number): string {
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 60) return `${days} days ago`
  return `${Math.round(days / 30)} months ago`
}

const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** "Dec 7, Jan 4, 2027", and how many more past the third. */
function dateList(dates: string[]): string {
  const shown = dates.slice(0, 3).map(fmtDate).join(', ')
  return dates.length > 3 ? `${shown} and ${dates.length - 3} more` : shown
}

/** A read that failed: say nothing rather than something false. The cause is in the server log. */
const Unknown = () => <span className="cco-unknown" title="Couldn’t load this">—</span>

const HELP = {
  automation: 'Running: the planner picks topics, writes the posts and publishes them on their dates. Paused: nothing happens until someone does it by hand.',
  schedule:   'How often this client publishes, how many posts go out on each date, how far ahead the planner fills dates, and the date the schedule counts from.',
  planned:    'The furthest date that has a topic, and the publish dates after it, inside the planning window, that still have room for one: open when the planner has had a run to fill them, "next run" when they are new since its last run. Automation only plans forward, so empty dates it skips (before the furthest one, or too close after it) are listed apart, as are dates someone cleared by deleting their topics: Regenerate plan fills both.',
  review:     'Posts written and waiting for someone to review them, and how many of those have a publish date that has already gone by.',
  published:  'The newest post that is live on the client’s site.',
  length:     'The length posts are written to, in words.',
  dfs:        'Whether keyword research can use DataForSEO for this client, and when it last ran.',
  priority:   'Priority topic sets with keywords still waiting. They take the client’s next publish dates before anything else.',
  issues:     'Settings or results that need someone. Each one says what to do.',
}

function Flag({ flag }: { flag: OverviewFlag }) {
  return (
    <span className={`cco-flag cco-flag--${flag.level}`}>
      {flag.label}
      <HelpTip label={`What to do: ${flag.label}`}>{flag.tip}</HelpTip>
    </span>
  )
}

function Row({ r }: { r: ClientOverviewRow }) {
  const issues = issueCount(r.flags)
  return (
    <tr className={issues > 0 ? 'cco-row--issue' : undefined}>
      <th scope="row" className="cco-client">
        <span className="cco-client-line">
          {r.logoUrl
            ? <img src={r.logoUrl} alt="" className="cco-logo" />
            : <span className="cco-logo cco-logo--initial" aria-hidden>{r.name.charAt(0).toUpperCase()}</span>}
          <span className="cco-client-text">
            <Link href={pipelineHref(r.id)} className="cco-client-name">{r.name}</Link>
            {issues > 0 && <span className="cco-client-issues">{plural(issues, 'issue')}</span>}
          </span>
        </span>
      </th>

      {/* Next to the name, so a laptop shows every problem without scrolling sideways. */}
      <td className="cco-issues" data-label="Issues">
        {r.flags.length === 0
          ? <span className="cco-none">None</span>
          : <span className="cco-flags">{r.flags.map(f => <Flag key={f.key} flag={f} />)}</span>}
      </td>

      <td data-label="Automation">
        <span className={`badge ${r.running ? 'badge-green' : 'badge-gray'}`}>{r.running ? 'Running' : 'Paused'}</span>
        {r.offSwitches.length > 0 && (
          <span className="cco-sub cco-warn cco-inline">
            {r.offSwitches.map(s => s[0].toUpperCase() + s.slice(1)).join(' and ')} off
            <HelpTip label="Why is this off?">
              Automation is on, but {r.offSwitches.join(' and ')} {r.offSwitches.length === 1 ? 'is' : 'are'} switched off in this client’s settings.
              The planner switches {r.offSwitches.length === 1 ? 'it' : 'them'} back on at its next run. If this stays, save the client’s Content settings again.
            </HelpTip>
          </span>
        )}
      </td>

      <td className="cco-wide" data-label="Schedule">
        <span className="cco-main">{r.cadence}</span>
        <span className="cco-sub cco-strong">{plural(r.postsPerDate, 'post')} each date</span>
        <span className="cco-sub">
          Plans {r.window}
          {' · '}
          {r.startDate ? `${r.startDate > new Date().toISOString().slice(0, 10) ? 'Starts' : 'Started'} ${fmtDate(r.startDate)}` : 'No start date'}
        </span>
      </td>

      <td data-label="Planned">
        {r.planned === null ? <Unknown /> : (
          <>
            {r.planned.through
              ? <span className="cco-main">Through {fmtDate(r.planned.through)}</span>
              : <span className="cco-none">Nothing planned</span>}
            {(r.planned.open ?? 0) > 0 && (
              <span className={`cco-sub${r.running ? ' cco-warn' : ''}`}>
                {plural(r.planned.open!, 'open date')}: {dateList(r.planned.openDates)}
              </span>
            )}
            {(r.planned.waiting ?? 0) > 0 && (
              <span className="cco-sub" title="New since the planner’s last run (it runs every two hours): a schedule saved since, or a date that just came into the window.">
                Next run plans {dateList(r.planned.waitingDates)}
              </span>
            )}
            {r.planned.open === 0 && !r.planned.waiting && !r.planned.cleared && (
              <span className="cco-sub">Window full</span>
            )}
            {(r.planned.cleared ?? 0) > 0 && (
              <span className="cco-sub" title="Topics deleted by hand. Automation leaves these dates empty; Regenerate plan fills them.">
                {plural(r.planned.cleared!, 'date')} cleared
              </span>
            )}
            {(r.planned.gaps ?? 0) > 0 && (
              <span className="cco-sub" title="Empty dates automation doesn't go back for: before the last planned one, or too close after it for the schedule. Regenerate plan fills them.">
                {plural(r.planned.gaps!, 'date')} skipped
              </span>
            )}
          </>
        )}
      </td>

      <td data-label="In review">
        {r.review === null ? <Unknown /> : r.review.count === 0 ? <span className="cco-none">None</span> : (
          <>
            <span className="cco-main">{r.review.count}</span>
            {r.review.overdue > 0 && <span className="cco-sub cco-bad">{r.review.overdue} past date</span>}
          </>
        )}
      </td>

      <td data-label="Last published">
        {r.lastPublished === null ? <Unknown /> : r.lastPublished.date ? (
          <>
            <span className="cco-main">{fmtDate(r.lastPublished.date)}</span>
            {r.lastPublished.daysAgo !== null && <span className="cco-sub">{ago(r.lastPublished.daysAgo)}</span>}
          </>
        ) : <span className="cco-none">Never</span>}
      </td>

      <td className="cco-num" data-label="Length">{r.length ? `${r.length.toLocaleString('en-US')}` : <span title="No length set, so posts use the default">1,500 (default)</span>}</td>

      <td data-label="DataForSEO">
        {r.dfs === null ? <Unknown /> : r.dfs.connected ? (
          <>
            <span className="cco-main">Connected</span>
            <span className="cco-sub">{r.dfs.researchedAt ? `Researched ${fmtDate(r.dfs.researchedAt)}` : 'Not researched yet'}</span>
          </>
        ) : <span className="cco-none">No</span>}
      </td>

      <td data-label="Priority topics">
        {r.prioritySets === null ? <Unknown /> : r.prioritySets === 0
          ? <span className="cco-none">None</span>
          : <span className="cco-main">{plural(r.prioritySets, 'set')} waiting</span>}
      </td>
    </tr>
  )
}

export default function ContentClientsOverview({ rows, error }: { rows: ClientOverviewRow[]; error: string | null }) {
  const [onlyIssues, setOnlyIssues] = useState(false)

  if (error) {
    return (
      <div className="card">
        <EmptyState icon={<WarningCircle size={22} weight="duotone" />} tone="red" title="The clients overview didn’t load">
          {error} Reload the page to try again.
        </EmptyState>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="card">
        <EmptyState
          icon={<Article size={22} weight="duotone" />}
          title="No clients have content set up yet"
          actions={<Link className="btn btn-secondary" href="/admin/dashboard">Go to clients</Link>}
        >
          A client appears here once its content is set up: open the client, go to Content, and run the setup.
        </EmptyState>
      </div>
    )
  }

  const running   = rows.filter(r => r.running).length
  const withIssue = rows.filter(r => issueCount(r.flags) > 0).length
  const shown     = onlyIssues ? rows.filter(r => issueCount(r.flags) > 0) : rows

  return (
    <div className="cco">
      <p className="pto-lede">
        Every client’s content setup on one line, with anything that needs someone flagged. Clients with issues come first.
        Open a client to change its settings.
      </p>

      <div className="cco-bar">
        <p className="cco-summary">
          <strong>{rows.length}</strong> {rows.length === 1 ? 'client' : 'clients'}
          <span className="cco-dot" aria-hidden>·</span><strong>{running}</strong> running
          <span className="cco-dot" aria-hidden>·</span><strong>{rows.length - running}</strong> paused
          <span className="cco-dot" aria-hidden>·</span>
          <strong className={withIssue > 0 ? 'cco-bad' : undefined}>{withIssue}</strong> with issues
        </p>
        <label className={`cco-filter${withIssue === 0 ? ' cco-filter--off' : ''}`}>
          <input type="checkbox" checked={onlyIssues} disabled={withIssue === 0} onChange={e => setOnlyIssues(e.target.checked)} />
          Show only clients with issues
        </label>
      </div>

      <div className="card cco-card">
        <div className="cco-scroll">
          <table className="data-table data-table--compact cco-table">
            <thead>
              <tr>
                <th scope="col" className="cco-client">Client</th>
                <th scope="col"><Explained name="Issues" help={HELP.issues}>Issues</Explained></th>
                <th scope="col"><Explained name="Automation" help={HELP.automation}>Automation</Explained></th>
                <th scope="col"><Explained name="Schedule" help={HELP.schedule}>Schedule</Explained></th>
                <th scope="col"><Explained name="Planned" help={HELP.planned}>Planned</Explained></th>
                <th scope="col"><Explained name="In review" help={HELP.review}>In review</Explained></th>
                <th scope="col"><Explained name="Last published" help={HELP.published}>Last published</Explained></th>
                <th scope="col" className="cco-num"><Explained name="Length" help={HELP.length}>Length</Explained></th>
                <th scope="col"><Explained name="DataForSEO" help={HELP.dfs}>DataForSEO</Explained></th>
                <th scope="col"><Explained name="Priority topics" help={HELP.priority}>Priority topics</Explained></th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => <Row key={r.id} r={r} />)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

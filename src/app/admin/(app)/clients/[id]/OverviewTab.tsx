'use client'

// Client → Overview, the tab a client page opens on. Two columns: a narrow one on the left (the
// numbers at a glance, the relationship, the people, quick links) and a wide workspace on the
// right, with notes first and the latest invoices and Ad Fuel lines on tabs. Business info and the
// editing of contacts and the account manager live on the Profile tab; People here only reads them.
// On a tablet or phone it's one column, with the workspace straight after the numbers.

import '@/styles/admin/client-overview.css'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowSquareOut, CaretRight, Copy, Check, Receipt, RocketLaunch } from '@phosphor-icons/react'
import ClientNotesStream from '@/components/admin/ClientNotesStream'
import Section from '@/components/ui/Section'
import { PillTabs } from '@/components/ui/PillTabs'
import EmptyState from '@/components/ui/EmptyState'
import { copyText } from '@/components/ui/ActionMenu'
import StatusBadge from '@/components/ui/StatusBadge'
import { Sk, SkRows } from '@/components/ui/Skeleton'
import ClientRelationshipCard from './ClientRelationshipCard'
import { InvoiceRow, LedgerRow, fmtMoney, type Invoice, type LedgerEntry } from './BillingTab'
import type { ClientTemperature } from '@/lib/types'
import { CONTACT_ROLE, initials, type AdminUser, type Contact } from './people'

interface Stats {
  adFuelBalance:        number | null
  pendingAch:           number
  mtdSpend:             number | null
  siteUptime7d:         number | null
  contentPipelineCount: number
}

interface Props {
  clientId:         string
  /** The account manager, when one is assigned. */
  accountManager:   AdminUser | null
  temperature:      ClientTemperature | null
  lastContactedAt:  string | null
  contactStaleDays: number | null
  agencyStaleDays:  number
  contacts:         Contact[]
  /** Signs the client's dashboard and ad library links, under Quick links (the header's ⋯ menu
   *  builds the same two). No token, no links. */
  dashboardToken?:  string | null
}

function fmt$(n: number | null): string {
  if (n == null) return '—'
  const abs = Math.abs(n)
  const formatted = abs >= 1000
    ? '$' + (abs / 1000).toFixed(1) + 'k'
    : '$' + abs.toFixed(0)
  return n < 0 ? '-' + formatted : formatted
}

export default function OverviewTab({
  clientId, accountManager, contacts,
  temperature, lastContactedAt, contactStaleDays, agencyStaleDays, dashboardToken,
}: Props) {
  const router = useRouter()

  // ── The workspace ─────────────────────────────────────────────────────────
  const [workTab,   setWorkTab]   = useState<WorkTab>('notes')
  const [noteCount, setNoteCount] = useState<number | null>(null)

  // The links are absolute, and the origin is only known in the browser (after hydration).
  const [origin, setOrigin] = useState('')
  useEffect(() => setOrigin(window.location.origin), [])
  const dashUrl       = dashboardToken && origin ? `${origin}/api/auth/access?token=${dashboardToken}` : null
  const adsLibraryUrl = dashboardToken && origin ? `${origin}/share/ads?token=${dashboardToken}` : null

  // ── Lazy-load stats ───────────────────────────────────────────────────────
  const [stats, setStats]           = useState<Stats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/admin/clients/${clientId}/overview-stats`)
      .then(r => r.ok ? r.json() : null)
      .then((data: Stats | null) => { if (data) setStats(data) })
      .catch(() => {})
      .finally(() => setStatsLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── People: the main contacts first, then billing, then the rest ──────────
  const ROLE_ORDER: Record<string, number> = { primary: 0, billing: 1 }
  const people = [...contacts].sort((a, b) => (ROLE_ORDER[a.role] ?? 2) - (ROLE_ORDER[b.role] ?? 2))
  const shownPeople = people.slice(0, 3)
  const profileHref = `/admin/clients/${clientId}?tab=profile`

  // ── Billing data (invoices + ledger) ─────────────────────────────────────
  const [invoices,       setInvoices]       = useState<Invoice[]>([])
  const [billingLedger,  setBillingLedger]  = useState<LedgerEntry[]>([])
  const [billingLoading, setBillingLoading] = useState(true)

  const loadBilling = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/billing`)
      if (!res.ok) { console.error('Billing fetch failed:', res.status); return }
      const data = await res.json()
      setInvoices(data.invoices ?? [])
      setBillingLedger(data.ledger ?? [])
    } finally {
      setBillingLoading(false)
    }
  }, [clientId])

  useEffect(() => { loadBilling() }, [loadBilling])

  const billingHref = `/admin/clients/${clientId}?tab=billing`

  // ── At a glance ───────────────────────────────────────────────────────────
  const afBalance = stats?.adFuelBalance ?? null
  const afTone = afBalance == null ? 'co-faint' : afBalance < 0 ? 'co-neg' : afBalance < 200 ? 'co-warn' : 'co-pos'
  const projected = stats != null && (stats.pendingAch ?? 0) > 0 ? (stats.adFuelBalance ?? 0) + stats.pendingAch : null
  const uptime = stats?.siteUptime7d ?? null
  const uptimeTone = uptime == null ? 'co-faint' : uptime >= 99 ? 'co-pos' : uptime >= 95 ? 'co-warn' : 'co-neg'
  const pipeline = stats?.contentPipelineCount ?? 0

  const workTabs = [
    { id: 'notes',    label: 'Notes', count: noteCount ?? undefined },
    { id: 'invoices', label: 'Invoices' },
    { id: 'ledger',   label: 'Ad Fuel ledger' },
  ]

  return (
    <div className="co-ov co-scope">

      {/* ── The client, in a column ──────────────────────────────────── */}
      <div className="co-ov-side">
        <div className="co-ov-glance">
          <Section title="At a glance">
            <div className="co-stats" aria-busy={statsLoading || undefined}>
              <Link href={billingHref} className="co-stat">
                <span className="co-stat-label">Ad Fuel balance<CaretRight size={10} weight="bold" aria-hidden /></span>
                {statsLoading ? <Sk w="80%" h={22} r={6} /> : (
                  <>
                    <span className={`co-stat-value ${afTone}`}>
                      {afBalance != null ? `${afBalance < 0 ? '−' : ''}${fmtMoney(afBalance)}` : '—'}
                    </span>
                    {projected != null && (
                      <span className={`co-stat-sub ${projected >= 0 ? 'co-pos' : 'co-neg'}`}>
                        {projected < 0 ? '−' : ''}{fmtMoney(projected)} after pending ACH
                      </span>
                    )}
                  </>
                )}
              </Link>
              <div className="co-stat">
                <span className="co-stat-label">Spend this month</span>
                {statsLoading ? <Sk w="60%" h={22} r={6} /> : (
                  <>
                    <span className="co-stat-value">{fmt$(stats?.mtdSpend ?? null)}</span>
                    <span className="co-stat-sub co-muted">Raw, before Ad Fuel</span>
                  </>
                )}
              </div>
              <Link href="/admin/sites" className="co-stat">
                <span className="co-stat-label">Site uptime, 7 days<CaretRight size={10} weight="bold" aria-hidden /></span>
                {statsLoading ? <Sk w="60%" h={22} r={6} /> : (
                  <span className={`co-stat-value ${uptimeTone}`}>{uptime != null ? `${uptime.toFixed(1)}%` : '—'}</span>
                )}
              </Link>
              <Link href={`/admin/clients/${clientId}?tab=content`} className="co-stat">
                <span className="co-stat-label">Content pipeline<CaretRight size={10} weight="bold" aria-hidden /></span>
                {statsLoading ? <Sk w="40%" h={22} r={6} /> : (
                  <span className={`co-stat-value ${pipeline > 0 ? 'co-accent' : 'co-muted'}`}>{pipeline}</span>
                )}
              </Link>
            </div>
          </Section>
        </div>

        <div className="co-ov-rel">
          <ClientRelationshipCard
            clientId={clientId}
            temperature={temperature}
            lastContactedAt={lastContactedAt}
            contactStaleDays={contactStaleDays}
            agencyStaleDays={agencyStaleDays}
          />
        </div>

        <div className="co-ov-people">
          <Section
            title="People"
            flush
            actions={<Link href={profileHref} className="co-link">Profile<CaretRight size={12} weight="bold" aria-hidden /></Link>}
          >
            {!accountManager && people.length === 0 ? (
              <p className="co-empty">No contacts or account manager yet. <Link href={profileHref}>Add them on the Profile tab</Link>.</p>
            ) : (
              <>
                {accountManager && (
                  <div className="ui-row">
                    <span className="co-avatar" aria-hidden>
                      {accountManager.avatar_url ? <img src={accountManager.avatar_url} alt="" /> : initials(accountManager.name)}
                    </span>
                    <span className="ui-row-text">
                      <span className="ui-row-title">{accountManager.name}</span>
                      <span className="ui-row-sub">Account manager</span>
                    </span>
                  </div>
                )}
                {shownPeople.map(contact => {
                  const role = CONTACT_ROLE[contact.role]
                  return (
                    <div key={contact.id} className="ui-row">
                      <span className="co-avatar" aria-hidden>{initials(contact.name)}</span>
                      <span className="ui-row-text">
                        <span className="ui-row-title">
                          {contact.name}
                          {role && <StatusBadge tone={role.tone} dot={false}>{role.label}</StatusBadge>}
                        </span>
                        {(contact.email || contact.phone) && (
                          <span className="ui-row-sub co-row-sub">
                            {contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
                            {contact.email && contact.phone && <span className="co-dot" aria-hidden />}
                            {contact.phone && <a href={`tel:${contact.phone}`} className="co-nowrap">{contact.phone}</a>}
                          </span>
                        )}
                      </span>
                    </div>
                  )
                })}
                {people.length > shownPeople.length && (
                  <p className="co-more">
                    <Link href={profileHref}>{people.length - shownPeople.length} more on the Profile tab</Link>
                  </p>
                )}
              </>
            )}
          </Section>
        </div>

        {(dashUrl || adsLibraryUrl) && (
          <div className="co-ov-links">
            <Section title="Quick links" description="What the client sees, ready to send.">
              <div className="co-links">
                {dashUrl && <QuickLink label="Client dashboard" url={dashUrl} />}
                {adsLibraryUrl && <QuickLink label="Ad library" url={adsLibraryUrl} />}
              </div>
            </Section>
          </div>
        )}
      </div>

      {/* ── The workspace: notes first, then money in and out ──────────── */}
      <section className="card co-work" aria-labelledby="co-work-title">
        <header className="co-work-head">
          <h2 className="co-work-title" id="co-work-title">Client workspace</h2>
          <p className="co-work-desc">Notes, invoices and Ad Fuel, in one place.</p>
        </header>
        <div className="co-work-tabs">
          <PillTabs label="Workspace" activeId={workTab} onSelect={id => setWorkTab(id as WorkTab)} items={workTabs} idPrefix="co-work" />
        </div>

        {/* Notes stays mounted, so a half-written note survives a look at the invoices. */}
        <div className="co-work-panel" role="tabpanel" id="co-work-panel-notes" aria-labelledby="co-work-tab-notes" hidden={workTab !== 'notes'}>
          <ClientNotesStream
            clientId={clientId}
            // A contact-log note stamps last_contacted_at server-side; refresh so
            // the Relationship card reflects it without a manual reload.
            onContactLogged={() => router.refresh()}
            onCount={setNoteCount}
          />
        </div>

        {workTab === 'invoices' && (
          <div className="co-work-panel co-work-panel--flush" role="tabpanel" id="co-work-panel-invoices" aria-labelledby="co-work-tab-invoices">
            <div className="co-work-sub">
              <span>The latest Stripe invoices</span>
              <Link href={billingHref} className="co-link">All billing<CaretRight size={12} weight="bold" aria-hidden /></Link>
            </div>
            {billingLoading ? (
              <SkRows rows={3} />
            ) : invoices.length === 0 ? (
              <EmptyState icon={<Receipt size={22} weight="duotone" />} title="No invoices yet"
                actions={<Link href={`/admin/clients/${clientId}?tab=sources`} className="btn btn-secondary">Open Integrations</Link>}>
                Add the client’s Stripe customer ID under Integrations, and their invoices show up here.
              </EmptyState>
            ) : (
              invoices.slice(0, 8).map(inv => <InvoiceRow key={inv.id} inv={inv} />)
            )}
          </div>
        )}

        {workTab === 'ledger' && (
          <div className="co-work-panel co-work-panel--flush" role="tabpanel" id="co-work-panel-ledger" aria-labelledby="co-work-tab-ledger">
            <div className="co-work-sub">
              <span>The latest payments in and charges out</span>
              <Link href={billingHref} className="co-link">Full ledger<CaretRight size={12} weight="bold" aria-hidden /></Link>
            </div>
            {billingLoading ? (
              <SkRows rows={3} />
            ) : billingLedger.length === 0 ? (
              <EmptyState icon={<RocketLaunch size={22} weight="duotone" />} title="No Ad Fuel entries yet"
                actions={<Link href="/admin/ad-fuel" className="btn btn-secondary">Open Ad Fuel</Link>}>
                Payments and charges for this client show up here once they’re added on the Ad Fuel page.
              </EmptyState>
            ) : (
              billingLedger.slice(0, 8).map(entry => <LedgerRow key={entry.id} entry={entry} />)
            )}
          </div>
        )}
      </section>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

type WorkTab = 'notes' | 'invoices' | 'ledger'

/** A link the client uses, shortened to its host and path, with Copy and Open. */
function QuickLink({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false)
  const short = url.replace(/^https?:\/\//, '')
  return (
    <div className="co-qlink">
      <span className="co-qlink-label">{label}</span>
      <span className="co-qlink-row">
        <span className="co-qlink-url" title={url}>{short}</span>
        <button
          type="button"
          className="co-iconbtn"
          onClick={async () => { if (await copyText(url)) { setCopied(true); setTimeout(() => setCopied(false), 1600) } }}
          aria-label={copied ? `${label} link copied` : `Copy the ${label.toLowerCase()} link`}
          title={copied ? 'Copied' : 'Copy'}
        >
          {copied ? <Check size={15} weight="bold" aria-hidden /> : <Copy size={15} aria-hidden />}
        </button>
        <a href={url} target="_blank" rel="noopener noreferrer" className="co-iconbtn" aria-label={`Open the ${label.toLowerCase()} in a new tab`} title="Open">
          <ArrowSquareOut size={15} aria-hidden />
        </a>
      </span>
    </div>
  )
}

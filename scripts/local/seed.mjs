// npm run local:seed — fills the LOCAL database with realistic fake data so every page renders.
//
// Four clients chosen to exercise every layout: a lead-gen auto shop and a home-services company
// (both with content), a dental practice (with a site that is down and a failing sync), and an
// ecommerce store. Each gets the connections, 120 days of metrics, ads, content, alerts and billing
// the pages read.
//
// Numbers come from a seeded generator, so every run produces the same data and screenshots taken
// before and after a change stay comparable.
//
// Re-runnable. In one transaction it removes what it seeded last time — by seeded client and by fixed
// id — and inserts fresh. It never touches rows it did not create, except that reseeding resets
// anything added locally to the four seeded clients. Refuses anything but 127.0.0.1.

import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, LOCAL, DB, startDatabase } from './db.mjs'
import { GATEWAY_URL } from './config.mjs'

const requireFromApp = createRequire(join(ROOT, 'package.json'))
const bcrypt = requireFromApp('bcryptjs')
const pg = createRequire(join(ROOT, '.local', 'tools', 'node_modules', 'pg', 'package.json'))('pg')

// ── Test accounts ─────────────────────────────────────────────────────────────────
// Local-only credentials. They exist in .local/pgdata and nowhere else.
export const LOCAL_ACCOUNTS = [
  { email: 'admin@local.test',  username: 'localadmin',  name: 'Local Admin',  role: 'admin',  password: 'local-admin-123' },
  { email: 'viewer@local.test', username: 'localviewer', name: 'Local Viewer', role: 'viewer', password: 'local-viewer-123' },
]

// ── Determinism ───────────────────────────────────────────────────────────────────
const uid = key => {
  const h = createHash('md5').update(`local-seed:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/** A small seeded PRNG (mulberry32). Same key, same sequence, every run. */
function rng(key) {
  let a = parseInt(createHash('md5').update(key).digest('hex').slice(0, 8), 16)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const r2   = n => Math.round(n * 100) / 100
const pick = (r, list) => list[Math.floor(r() * list.length)]

// ── Dates ─────────────────────────────────────────────────────────────────────────
const DAY          = 86_400_000
const today        = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')
const iso          = d => d.toISOString().slice(0, 10)
const daysAgo      = n => new Date(today.getTime() - n * DAY)
const HISTORY_DAYS = 120
const Y = today.getUTCFullYear(), M = today.getUTCMonth()
/** A day of the current month, as an ISO date. */
const monthDay     = (n, offset = 0) => iso(new Date(Date.UTC(Y, M + offset, n)))
const stamp        = (daysBack, hour = 9) => new Date(today.getTime() - daysBack * DAY + hour * 3_600_000).toISOString()

/** Every day from `from` days ago to yesterday, oldest first. Metrics are synced through yesterday. */
const history = (from = HISTORY_DAYS) => Array.from({ length: from }, (_, i) => daysAgo(from - i))
const weekday = d => [0.72, 1.06, 1.1, 1.08, 1.04, 0.96, 0.78][d.getUTCDay()]

// ── Images ────────────────────────────────────────────────────────────────────────
// Creatives and featured images as SVG files in local storage, so every image slot renders without
// asking Meta, Google or a CDN for anything.
const IMAGE_DIR = join(LOCAL, 'storage', 'uploads', 'seed')
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function image(name, title, subtitle, hue) {
  mkdirSync(IMAGE_DIR, { recursive: true })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="628" viewBox="0 0 1200 628">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="hsl(${hue},58%,40%)"/><stop offset="1" stop-color="hsl(${(hue + 36) % 360},64%,22%)"/>`
    + `</linearGradient></defs><rect width="1200" height="628" fill="url(#g)"/>`
    + `<text x="72" y="292" font-family="Arial, Helvetica, sans-serif" font-size="64" font-weight="700" fill="#ffffff">${esc(title)}</text>`
    + `<text x="72" y="368" font-family="Arial, Helvetica, sans-serif" font-size="32" fill="#ffffffd9">${esc(subtitle)}</text></svg>`
  writeFileSync(join(IMAGE_DIR, `${name}.svg`), svg)
  return `${GATEWAY_URL}/storage/v1/object/public/uploads/seed/${name}.svg`
}

// ── The clients ───────────────────────────────────────────────────────────────────
const CLIENTS = [
  {
    key: 'ridgeline', name: 'Ridgeline Auto Performance', slug: 'ridgeline-auto', email: 'owner@ridgelineauto.example',
    website: 'https://ridgelineauto.example', phone: '(512) 555-0142', address: '4100 Burnet Rd, Austin, TX 78756',
    layout_type: 'lead_gen', bill_day: 5, monthly_budget: 6000, ad_fuel_cut: 0.2, temperature: 'high', leadValue: 180, hue: 212,
    services: 'Performance tuning, dyno tuning, exhaust and intake upgrades, turbo service', city: 'Austin, TX',
    sources: ['google_ads', 'meta_ads', 'google_analytics', 'google_search_console', 'google_business_profile', 'ghl', 'wordpress', 'ahrefs'],
    google: [
      { id: '2100001', name: 'Search — Performance Parts', type: 'SEARCH', budget: 90, spend: 72, ctr: 0.064, cvr: 0.082, groups: ['Downpipes & Exhaust', 'Intakes & Intercoolers'] },
      { id: '2100002', name: 'Search — Tuning & Dyno',     type: 'SEARCH', budget: 60, spend: 48, ctr: 0.071, cvr: 0.095, groups: ['Dyno Tuning', 'ECU Flash'] },
      { id: '2100003', name: 'PMax — Local Leads',          type: 'PERFORMANCE_MAX', budget: 50, spend: 41, ctr: 0.018, cvr: 0.041, groups: ['Austin Enthusiasts', 'Truck Owners'] },
    ],
    meta: [
      { id: '1202001', name: 'Leads — Dyno Day Offer',       objective: 'OUTCOME_LEADS', budget: 45, spend: 38, ctr: 0.014, cvr: 0.06 },
      { id: '1202002', name: 'Retargeting — Site Visitors',  objective: 'OUTCOME_LEADS', budget: 20, spend: 16, ctr: 0.021, cvr: 0.09 },
    ],
  },
  {
    key: 'summit', name: 'Summit Home Services', slug: 'summit-home', email: 'office@summithome.example',
    website: 'https://summithome.example', phone: '(214) 555-0187', address: '2800 Commerce St, Dallas, TX 75226',
    layout_type: 'lead_gen', bill_day: 15, monthly_budget: 9000, ad_fuel_cut: 0.2, temperature: 'medium', leadValue: 240, hue: 18,
    services: 'HVAC repair and installation, water heaters, plumbing', city: 'Dallas, TX',
    sources: ['google_ads', 'meta_ads', 'google_analytics', 'google_business_profile', 'ghl', 'wordpress'],
    google: [
      { id: '2200001', name: 'Search — AC Repair',          type: 'SEARCH', budget: 140, spend: 121, ctr: 0.058, cvr: 0.11, groups: ['AC Repair', 'Emergency HVAC'] },
      { id: '2200002', name: 'Search — Water Heaters',      type: 'SEARCH', budget: 80,  spend: 64,  ctr: 0.052, cvr: 0.09, groups: ['Tankless', 'Water Heater Repair'] },
      { id: '2200003', name: 'Local Services — Dallas',     type: 'PERFORMANCE_MAX', budget: 70, spend: 58, ctr: 0.02, cvr: 0.05, groups: ['Homeowners', 'Property Managers'] },
    ],
    meta: [
      { id: '1203001', name: 'Leads — Summer Tune-Up $79',  objective: 'OUTCOME_LEADS', budget: 60, spend: 52, ctr: 0.012, cvr: 0.055 },
    ],
  },
  {
    key: 'harbor', name: 'Harbor Dental Studio', slug: 'harbor-dental', email: 'frontdesk@harbordental.example',
    website: 'https://harbordental.example', phone: '(713) 555-0119', address: '1500 Westheimer Rd, Houston, TX 77006',
    layout_type: 'lead_gen', bill_day: 1, monthly_budget: 3500, ad_fuel_cut: 0.15, temperature: 'low', leadValue: 320, hue: 174,
    services: 'General dentistry, whitening, Invisalign, implants', city: 'Houston, TX',
    sources: ['google_ads', 'google_analytics', 'google_search_console', 'google_business_profile', 'ahrefs'],
    google: [
      { id: '2300001', name: 'Search — New Patients',       type: 'SEARCH', budget: 70, spend: 61, ctr: 0.061, cvr: 0.074, groups: ['Dentist Near Me', 'Emergency Dentist'] },
      { id: '2300002', name: 'Search — Invisalign',         type: 'SEARCH', budget: 45, spend: 37, ctr: 0.049, cvr: 0.052, groups: ['Invisalign Cost', 'Clear Aligners'] },
    ],
    meta: [],
  },
  {
    key: 'oakline', name: 'Oakline Outfitters', slug: 'oakline-outfitters', email: 'hello@oaklineoutfitters.example',
    website: 'https://oaklineoutfitters.example', phone: '(303) 555-0165', address: '1720 Wazee St, Denver, CO 80202',
    layout_type: 'ecom', bill_day: 20, monthly_budget: 12000, ad_fuel_cut: 0.18, temperature: 'high', aov: 86, hue: 142,
    services: 'Outdoor apparel and gear, online store', city: 'Denver, CO', purchase_action: 'purchase',
    sources: ['google_ads', 'meta_ads', 'google_analytics', 'ghl'],
    google: [
      { id: '2400001', name: 'Shopping — All Products',     type: 'SHOPPING', budget: 180, spend: 158, ctr: 0.011, cvr: 0.024, groups: ['Jackets', 'Packs & Bags'] },
      { id: '2400002', name: 'PMax — Apparel',              type: 'PERFORMANCE_MAX', budget: 150, spend: 131, ctr: 0.014, cvr: 0.021, groups: ['Fall Layers', 'Best Sellers'] },
      { id: '2400003', name: 'Search — Brand',              type: 'SEARCH', budget: 25, spend: 18, ctr: 0.18, cvr: 0.11, groups: ['Brand', 'Brand + Product'] },
    ],
    meta: [
      { id: '1204001', name: 'Sales — Fall Collection',     objective: 'OUTCOME_SALES', budget: 160, spend: 142, ctr: 0.017, cvr: 0.028 },
      { id: '1204002', name: 'Sales — Catalog Retargeting', objective: 'OUTCOME_SALES', budget: 70,  spend: 58,  ctr: 0.024, cvr: 0.041 },
    ],
  },
]
for (const c of CLIENTS) {
  c.id = uid(`client:${c.key}`)
  c.dashboard_token = uid(`client-token:${c.key}`)
  c.host = new URL(c.website).hostname
}

const CONNECTOR_LABELS = {
  google_ads: 'Google Ads', meta_ads: 'Meta Ads', google_analytics: 'Google Analytics 4',
  google_search_console: 'Google Search Console', google_business_profile: 'Google Business Profile',
  ghl: 'GoHighLevel', wordpress: 'WordPress', ahrefs: 'Ahrefs',
}

// WordPress keeps its site credentials on the connector itself, so each client site has its own.
const connectorId  = (type, client) => uid(type === 'wordpress' ? `connector:wordpress:${client.key}` : `connector:${type}`)
const connectionId = (client, type) => uid(`connection:${client.key}:${type}`)

// ── Database helpers ──────────────────────────────────────────────────────────────
async function loadColumns(c) {
  const { rows } = await c.query(`
    SELECT table_name, column_name, udt_name, is_nullable, column_default
    FROM information_schema.columns WHERE table_schema = 'public'`)
  const cols = new Map()
  for (const r of rows) {
    if (!cols.has(r.table_name)) cols.set(r.table_name, new Map())
    cols.get(r.table_name).set(r.column_name, {
      udt: r.udt_name,
      // NOT NULL with a default: a seed row saying "no value" means the default, not NULL.
      defaultsWhenNull: r.is_nullable === 'NO' && r.column_default !== null,
    })
  }
  return cols
}

/**
 * Batched INSERT that checks every column against the live schema first, so a seed that has drifted
 * from the migrations fails with the table and column named rather than a bare Postgres error.
 * An undefined value becomes DEFAULT, not NULL, so column defaults still apply — and so does null
 * for a NOT NULL column that has a default. A null into a NOT NULL column with no default still fails.
 */
function makeInsert(c, cols, counts) {
  return async function insert(table, rows) {
    if (!rows.length) return
    const known = cols.get(table)
    if (!known) throw new Error(`table "${table}" does not exist in the local database`)
    const keys = [...new Set(rows.flatMap(r => Object.keys(r)))]
    const unknown = keys.filter(k => !known.has(k))
    if (unknown.length) throw new Error(`${table} has no column(s): ${unknown.join(', ')}`)

    const encode = (k, v) => (known.get(k).udt === 'jsonb' || known.get(k).udt === 'json') ? JSON.stringify(v) : v
    const perChunk = Math.max(1, Math.floor(30000 / keys.length))
    for (let i = 0; i < rows.length; i += perChunk) {
      const params = []
      const tuples = rows.slice(i, i + perChunk).map(r => '(' + keys.map(k => {
        if (r[k] === undefined || (r[k] === null && known.get(k).defaultsWhenNull)) return 'DEFAULT'
        params.push(r[k] === null ? null : encode(k, r[k]))
        return `$${params.length}`
      }).join(', ') + ')')
      await c.query(`INSERT INTO public."${table}" (${keys.map(k => `"${k}"`).join(', ')}) VALUES ${tuples.join(', ')}`, params)
    }
    counts[table] = (counts[table] ?? 0) + rows.length
  }
}

// ── Content ───────────────────────────────────────────────────────────────────────
const RIDGELINE_POSTS = [
  { key: 'downpipe', status: 'for_review', day: 9,
    keyword: 'what does a downpipe do on an EcoBoost engine',
    title: 'Downpipe vs Stock Pipe: What Changes, What It Costs, and What It Does on an EcoBoost',
    sections: [
      ['What a downpipe actually does', 'The downpipe carries exhaust from the turbo outlet to the rest of the system. On an EcoBoost the factory pipe is built for emissions and noise first, so it is narrow and packed with a restrictive catalytic converter. That restriction raises back-pressure right where the turbo needs to spool.'],
      ['What changes when you swap it', 'A larger, mandrel-bent downpipe lets the turbo spool faster and run cooler. On its own you will feel sharper throttle response. Paired with a tune, owners typically see the biggest single-part gain in the exhaust.'],
      ['What it costs in Austin', 'Parts run from roughly $450 for a catted pipe to $900 for a premium stainless unit. Installation is two to three hours, and a tune to match is strongly recommended.'],
      ['The part everyone skips', 'A downpipe is only half the equation. Without a tune the ECU keeps targeting stock boost, and a check-engine light for the removed or relocated sensor is common.'],
    ] },
  { key: 'intake', status: 'approved', day: 16,
    keyword: 'cold air intake vs short ram',
    title: 'Cold Air Intake vs Short Ram: Which Suits a Daily Driver?',
    sections: [
      ['The short version', 'A cold air intake moves the filter away from engine heat; a short ram keeps it close for a shorter path. For a daily driver in Texas heat, the cooler air usually wins.'],
      ['Where each one shines', 'Short rams sound great and respond quickly. Cold air intakes make more consistent power once the engine bay is hot, which is most of the year here.'],
      ['Water and weather', 'A low-mounted cold air intake can ingest water in a flooded street. A bypass valve or a mid-mounted filter solves it.'],
    ] },
  { key: 'dyno-cost', status: 'draft_saved', day: 2, wpPostId: 4101,
    keyword: 'how much does a dyno tune cost',
    title: 'How Much Does a Dyno Tune Cost in Austin?',
    sections: [
      ['What you are paying for', 'A dyno tune is several hours of pulls, logging and adjustment on your specific car, not a canned file.'],
      ['Typical prices', 'Expect $500 to $900 for a street tune and more for flex-fuel or built engines.'],
      ['How to compare shops', 'Ask for before-and-after graphs and whether retunes after future parts are included.'],
    ] },
  { key: 'wastegate', status: 'for_review', day: 23, critical: true,
    keyword: 'turbo wastegate sticking symptoms',
    title: 'Signs Your Turbo Wastegate Is Sticking (and What It Costs to Fix)',
    sections: [
      ['The symptoms', 'Boost spikes, boost that never builds, and a rattle on cold start are the classic signs of a sticking wastegate.'],
      ['What causes it', 'Carbon build-up and a worn actuator rod are the usual culprits. Call us at (512) 55-0142 to book an inspection.'],
      ['Fixing it', 'A cleaning and actuator adjustment is often enough. Replacement runs higher.'],
    ] },
  { key: 'exhaust-tips', status: 'rejected', day: 30,
    keyword: 'best exhaust tips',
    title: 'The 10 Best Exhaust Tips of the Year',
    sections: [['A roundup', 'A list of popular exhaust tips.']] },
  { key: 'e85', status: 'generating', day: 27,
    keyword: 'e85 flex fuel conversion cost',
    title: null, sections: [] },
  { key: 'intercooler', status: 'published', day: 12, monthOffset: -1, wpPostId: 3988,
    keyword: 'ecoboost intercooler upgrade',
    title: 'Intercooler Upgrades Explained: When an EcoBoost Needs One',
    sections: [
      ['Heat soak is the enemy', 'Repeated pulls heat the stock intercooler and the ECU pulls timing to stay safe.'],
      ['What an upgrade changes', 'A larger core keeps intake temperatures stable, so power stays consistent pull after pull.'],
    ] },
]

const SUMMIT_POSTS = [
  { key: 'ac-cold', status: 'for_review', day: 11,
    keyword: 'ac not blowing cold air',
    title: 'AC Running but Not Blowing Cold? 7 Causes and What They Cost',
    sections: [
      ['Start with the easy checks', 'A clogged filter or a thermostat set to fan-only accounts for a surprising number of calls.'],
      ['Refrigerant and leaks', 'Low refrigerant means a leak somewhere. Topping up without fixing it just delays the next visit.'],
      ['When it is the compressor', 'A failed compressor or capacitor is the expensive end — but a capacitor is often under $250 installed.'],
    ] },
  { key: 'tankless-cost', status: 'approved', day: 18,
    keyword: 'tankless water heater cost',
    title: 'Tankless Water Heater Cost in Dallas: Installed Prices for 2026',
    sections: [
      ['Unit and installation', 'Most whole-home units land between $2,800 and $4,500 installed.'],
      ['Gas line and venting', 'Older homes may need a larger gas line, which is the most common surprise on the quote.'],
    ] },
  { key: 'short-cycling', status: 'draft_saved', day: 4, wpPostId: 5220,
    keyword: 'furnace short cycling',
    title: 'Why Your Furnace Keeps Short Cycling',
    sections: [
      ['What short cycling is', 'The furnace starts, runs briefly, and shuts off again well before the house is warm.'],
      ['Common causes', 'A dirty flame sensor, an oversized unit or a clogged filter.'],
    ] },
]

const PENDING_TOPICS = {
  ridgeline: [
    { key: 'brakes',  status: 'pending',   day: 6,  keyword: 'brake pad replacement lifted truck', topic: 'How often should you replace brake pads on a lifted truck?' },
    { key: 'coating', status: 'approved',  day: 13, keyword: 'ceramic coating vs ppf',             topic: 'Ceramic coating vs PPF: which protects a daily driver better?' },
    { key: 'clutch',  status: 'scheduled', day: 20, keyword: 'clutch slipping signs',              topic: 'Five signs your clutch is slipping before it fails' },
  ],
  summit: [
    { key: 'heat-pump', status: 'pending',  day: 8,  keyword: 'heat pump vs furnace texas', topic: 'Heat pump vs furnace: which makes sense in North Texas?' },
    { key: 'softener',  status: 'approved', day: 22, keyword: 'water softener worth it',    topic: 'Is a water softener worth it in Dallas?' },
  ],
}

function articleHtml(post, client) {
  const intro = `<p>${esc(post.title)} — a straight answer from the team at ${esc(client.name)} in ${esc(client.city)}.</p>`
  const body  = post.sections.map(([h, p]) => `<h2>${esc(h)}</h2>\n<p>${esc(p)}</p>\n<p>${esc(p)} Every car and home is a little different, so treat these as starting points rather than quotes.</p>`).join('\n')
  const takeaways = `<h2>Key Takeaways</h2>\n<ul>${post.sections.slice(0, 3).map(([h]) => `<li>${esc(h)}</li>`).join('')}</ul>`
  const cta = `<p>Questions? <a href="tel:${client.phone.replace(/[^0-9]/g, '')}">${esc(client.phone)}</a> or <a href="${client.website}/contact">book online</a>.</p>`
  return [intro, takeaways, body, cta].join('\n')
}

const wordCount = html => html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length

function qualityReport(post, words) {
  const findings = post.critical
    ? [
        { code: 'phone_invalid', severity: 'critical', message: 'A phone number in the article does not parse as dialable.', evidence: ['(512) 55-0142'] },
        { code: 'kw_titlecase',  severity: 'warning',  message: 'The keyword is title-cased in 2 headings.' },
      ]
    : post.status === 'for_review'
      ? [{ code: 'kw_titlecase', severity: 'warning', message: 'The keyword is title-cased in 3 headings, which reads as stuffing.', evidence: ['What A Downpipe Actually Does'] }]
      : []
  return {
    findings,
    score: post.critical ? 54 : findings.length ? 82 : 94,
    blocksAutoPush: Boolean(post.critical),
    wordCount: words,
  }
}

function seoScore(r, overall) {
  return {
    overall,
    keyword_in_title: true, keyword_in_intro: true, keyword_in_headings: overall > 70,
    intent_match: true, heading_structure: true, internal_links_count: 2 + Math.floor(r() * 3),
    local_relevance: true, cta_present: true, faq_present: false, meta_present: true,
    eat_signals: overall > 75, word_count_on_target: overall > 60, over_optimised: false, duplicate_warning: false,
    issues: overall < 70 ? ['Keyword missing from subheadings'] : [],
    warnings: ['No FAQ section'],
  }
}

// ── Build the rows ────────────────────────────────────────────────────────────────
function buildMetrics(client, rowsBy) {
  const add = (table, row) => (rowsBy[table] ??= []).push(row)
  const has = type => client.sources.includes(type)

  // Google Ads — campaigns, ads, keywords, search terms, PMax assets
  if (has('google_ads')) {
    const cc = connectionId(client, 'google_ads')
    for (const camp of client.google) {
      const r = rng(`google:${client.key}:${camp.id}`)
      const groups = camp.groups.map((name, i) => ({ id: `${camp.id}${i + 1}`, name }))
      const ads = groups.flatMap((g, gi) => [0, 1].map(ai => ({
        group: g, id: `${camp.id}${gi + 1}${ai + 1}`, weight: [0.34, 0.26, 0.24, 0.16][gi * 2 + ai],
        name: `${g.name} — ${ai === 0 ? 'Offer' : 'Proof'}`,
      })))
      const imageAd = camp.type !== 'SEARCH'
        ? image(`g-${client.key}-${camp.id}`, camp.name.replace(/^.*— /, ''), client.name, client.hue)
        : null

      for (const d of history()) {
        const f = weekday(d) * (1 + (r() * 2 - 1) * 0.18)
        const spend = r2(Math.min(camp.budget, camp.spend * f))
        const cpc = camp.type === 'SEARCH' ? 1.9 + r() * 1.7 : 0.7 + r() * 0.6
        const clicks = Math.max(1, Math.round(spend / cpc))
        const impressions = Math.max(clicks, Math.round(clicks / (camp.ctr * (0.85 + r() * 0.3))))
        const conversions = r2(clicks * camp.cvr * (0.7 + r() * 0.6))
        const value = client.layout_type === 'ecom'
          ? r2(conversions * client.aov * (0.85 + r() * 0.3))
          : r2(conversions * client.leadValue)

        add('google_ads_metrics', {
          connection_id: cc, client_id: client.id, campaign_id: camp.id, campaign_name: camp.name,
          campaign_status: 'ENABLED', campaign_type: camp.type, date: iso(d),
          cost_micros: Math.round(spend * 1e6), spend, impressions, clicks, conversions,
          conversions_value: value, all_conversions_value: value,
          roas: spend ? r2(value / spend) : 0, ctr: r2((clicks / impressions) * 100) / 100,
          cpc: r2(spend / clicks), cpm: r2((spend / impressions) * 1000), daily_budget: camp.budget,
          search_impression_share: camp.type === 'SEARCH' ? r2(0.42 + r() * 0.25) : null,
          campaign_start_date: '2025-11-03',
        })

        for (const ad of ads) {
          const s = r2(spend * ad.weight)
          add('google_ads_ad_metrics', {
            connection_id: cc, client_id: client.id, campaign_id: camp.id, campaign_name: camp.name,
            ad_group_id: ad.group.id, ad_group_name: ad.group.name, ad_id: ad.id, ad_name: ad.name,
            ad_type: camp.type === 'SEARCH' ? 'RESPONSIVE_SEARCH_AD' : camp.type === 'PERFORMANCE_MAX' ? 'ASSET_GROUP' : 'RESPONSIVE_DISPLAY_AD',
            date: iso(d), cost_micros: Math.round(s * 1e6), spend: s,
            impressions: Math.round(impressions * ad.weight), clicks: Math.round(clicks * ad.weight),
            conversions: r2(conversions * ad.weight), conversions_value: r2(value * ad.weight), all_conversions_value: r2(value * ad.weight),
            headlines: [`${ad.group.name} in ${client.city}`, `${client.name}`, 'Book Online Today'],
            descriptions: [`Trusted ${client.services.split(',')[0].toLowerCase()} with upfront pricing.`, 'Same-week appointments. Call or book online.'],
            final_url: `${client.website}/`, image_url: imageAd, ad_strength: pick(r, ['GOOD', 'EXCELLENT']),
            ad_status: 'ENABLED', ad_created_at: '2025-11-03',
          })
        }
      }

      if (camp.type === 'SEARCH') {
        const words = camp.groups.flatMap(g => [g.toLowerCase(), `${g.toLowerCase()} near me`, `best ${g.toLowerCase()}`, `${g.toLowerCase()} cost`])
        for (const d of history(45)) {
          words.forEach((w, i) => {
            const group = groups[i % groups.length]
            const clicks = Math.round((2 + r() * 9) * weekday(d))
            add('google_ads_keywords', {
              connection_id: cc, client_id: client.id, campaign_id: camp.id, campaign_name: camp.name,
              ad_group_id: group.id, ad_group_name: group.name, keyword_id: `${camp.id}-kw${i}`, keyword_text: w,
              match_type: pick(r, ['PHRASE', 'EXACT', 'BROAD']), keyword_status: 'ENABLED',
              spend: r2(clicks * (1.8 + r() * 1.5)), impressions: clicks * (12 + Math.floor(r() * 10)), clicks,
              conversions: r2(clicks * camp.cvr), conversions_value: r2(clicks * camp.cvr * (client.leadValue ?? client.aov ?? 100)), date: iso(d),
            })
          })
        }
        for (const d of history(30)) {
          for (const group of groups) {
            for (const term of [`${group.name.toLowerCase()} austin`, `${group.name.toLowerCase()} price`, `cheap ${group.name.toLowerCase()}`, `${group.name.toLowerCase()} open now`]) {
              const clicks = Math.round(r() * 6)
              add('google_ads_search_terms', {
                connection_id: cc, client_id: client.id, campaign_id: camp.id, campaign_name: camp.name,
                ad_group_id: group.id, ad_group_name: group.name, search_term: term, match_type: 'PHRASE',
                status: term.startsWith('cheap') ? 'EXCLUDED' : 'NONE', date: iso(d),
                impressions: clicks * (8 + Math.floor(r() * 8)), clicks, spend: r2(clicks * 2.2),
                conversions: r2(clicks * camp.cvr), conversion_value: r2(clicks * camp.cvr * (client.leadValue ?? 100)),
              })
            }
          }
        }
        for (const [i, w] of ['free', 'jobs', 'diy', 'used'].entries()) {
          add('google_ads_negative_keywords', {
            connection_id: cc, client_id: client.id, campaign_id: camp.id, campaign_name: camp.name,
            keyword_id: `${camp.id}-neg${i}`, keyword_text: w, match_type: 'BROAD', level: 'CAMPAIGN',
          })
        }
      } else {
        for (const g of groups) {
          const img = image(`pmax-${client.key}-${g.id}`, g.name, client.name, (client.hue + 24) % 360)
          const assets = [
            ['MARKETING_IMAGE', null, img], ['HEADLINE', `${g.name} from ${client.name}`, null],
            ['HEADLINE', 'Free shipping over $75', null], ['DESCRIPTION', `Shop ${g.name.toLowerCase()} built for real weather.`, null],
          ]
          assets.forEach(([field_type, text_content, image_url], i) => add('google_ads_asset_group_assets', {
            connection_id: cc, client_id: client.id, campaign_id: camp.id, campaign_name: camp.name,
            asset_group_id: g.id, asset_group_name: g.name, asset_id: `${g.id}-a${i}`, field_type, text_content, image_url,
          }))
        }
      }

      add('client_campaign_assignments', {
        client_id: client.id, source: 'google_ads', campaign_id: camp.id, campaign_name: camp.name,
        display_mode: client.layout_type === 'ecom' ? 'ecommerce' : 'lead_gen',
      })
    }
  }

  // Meta — ad-level rows are what spend totals read; campaign rows are their sums
  if (has('meta_ads')) {
    const cc = connectionId(client, 'meta_ads')
    const isEcom = client.layout_type === 'ecom'
    for (const camp of client.meta) {
      const r = rng(`meta:${client.key}:${camp.id}`)
      const adsets = [1, 2].map(n => ({ id: `${camp.id}0${n}`, name: n === 1 ? 'Broad — 25-54' : 'Lookalike 1%', budget: r2(camp.budget / 2) }))
      const ads = adsets.flatMap((s, si) => [1, 2].map(n => ({
        set: s, id: `${s.id}0${n}`, weight: [0.32, 0.22, 0.28, 0.18][si * 2 + n - 1],
        name: n === 1 ? 'Video — Before & After' : 'Carousel — Customer Reviews',
        img: image(`meta-${client.key}-${s.id}0${n}`, camp.name.replace(/^.*— /, ''), n === 1 ? 'Book this week' : '4.9 stars from local customers', (client.hue + 180) % 360),
      })))

      for (const d of history()) {
        const f = weekday(d) * (1 + (r() * 2 - 1) * 0.2)
        const spend = r2(Math.min(camp.budget, camp.spend * f))
        const impressions = Math.round(spend * (95 + r() * 40))
        const clicks = Math.max(1, Math.round(impressions * camp.ctr * (0.8 + r() * 0.4)))
        const conv = Math.max(0, Math.round(clicks * camp.cvr * (0.6 + r() * 0.8)))
        const value = isEcom ? r2(conv * client.aov * (0.9 + r() * 0.25)) : 0
        const actionsFor = (n, c) => isEcom
          ? [{ action_type: 'link_click', value: String(c) }, { action_type: 'add_to_cart', value: String(n * 3) }, { action_type: 'purchase', value: String(n) }]
          : [{ action_type: 'link_click', value: String(c) }, { action_type: 'lead', value: String(n) }, { action_type: 'onsite_conversion.lead_grouped', value: String(n) }]
        const valuesFor = v => (isEcom ? [{ action_type: 'purchase', value: v.toFixed(2) }] : [])

        add('meta_ads_metrics', {
          connection_id: cc, client_id: client.id, campaign_id: camp.id, campaign_name: camp.name, objective: camp.objective,
          date: iso(d), spend, impressions, clicks, reach: Math.round(impressions * 0.71), frequency: r2(1.2 + r() * 0.6),
          actions: actionsFor(conv, clicks), action_values: valuesFor(value), conversions: conv, conversion_value: value,
          roas: spend ? r2(value / spend) : 0, ctr: r2((clicks / impressions) * 100), cpc: r2(spend / clicks), cpm: r2((spend / impressions) * 1000),
          discovered_actions: isEcom ? ['link_click', 'add_to_cart', 'purchase'] : ['link_click', 'lead', 'onsite_conversion.lead_grouped'],
          campaign_status: 'ACTIVE', daily_budget: camp.budget, campaign_created_at: '2025-12-01', adset_created_at: '2025-12-01',
        })

        for (const ad of ads) {
          const n = Math.round(conv * ad.weight)
          const c = Math.round(clicks * ad.weight)
          add('meta_ads_ad_metrics', {
            connection_id: cc, client_id: client.id, campaign_id: camp.id, campaign_name: camp.name,
            adset_id: ad.set.id, adset_name: ad.set.name, ad_id: ad.id, ad_name: ad.name,
            thumbnail_url: ad.img, image_url: ad.img, date: iso(d), spend: r2(spend * ad.weight),
            impressions: Math.round(impressions * ad.weight), clicks: c, reach: Math.round(impressions * ad.weight * 0.7),
            actions: actionsFor(n, c), action_values: valuesFor(r2(value * ad.weight)),
            conversions: n, conversion_value: r2(value * ad.weight),
            creative_title: camp.name.replace(/^.*— /, ''), creative_body: `${client.name} — ${client.services.split(',')[0]}. Book this week.`,
            creative_link_url: `${client.website}/`, ad_status: 'ACTIVE', ad_created_at: '2025-12-01', adset_daily_budget: ad.set.budget,
          })
        }
      }

      add('client_campaign_assignments', {
        client_id: client.id, source: 'meta_ads', campaign_id: camp.id, campaign_name: camp.name,
        display_mode: isEcom ? 'ecommerce' : 'lead_gen',
      })
    }
  }

  // GA4
  if (has('google_analytics')) {
    const cc = connectionId(client, 'google_analytics')
    const r = rng(`ga4:${client.key}`)
    const base = client.layout_type === 'ecom' ? 1400 : 260
    const channels = [['Organic Search', 0.41], ['Paid Search', 0.24], ['Direct', 0.17], ['Paid Social', 0.11], ['Referral', 0.07]]
    const sources = [['google', 'organic', '(organic)', 0.41], ['google', 'cpc', 'search', 0.24], ['(direct)', '(none)', '(direct)', 0.17], ['facebook', 'paid', 'meta', 0.11]]
    for (const d of history()) {
      const total = base * weekday(d) * (0.85 + r() * 0.3)
      for (const [channel_group, share] of channels) {
        const sessions = Math.max(1, Math.round(total * share))
        add('ga4_metrics', {
          connection_id: cc, client_id: client.id, date: iso(d), channel_group, sessions,
          users: Math.round(sessions * 0.82), new_users: Math.round(sessions * 0.61), page_views: Math.round(sessions * 2.3),
          bounce_rate: r2(0.38 + r() * 0.17), avg_session_duration: r2(95 + r() * 65),
          conversions: Math.round(sessions * (client.layout_type === 'ecom' ? 0.021 : 0.035)), engaged_sessions: Math.round(sessions * 0.6),
        })
      }
      for (const [source, medium, campaign, share] of sources) {
        const sessions = Math.max(1, Math.round(total * share))
        add('ga4_source_metrics', {
          connection_id: cc, client_id: client.id, date: iso(d), source, medium, campaign, sessions,
          users: Math.round(sessions * 0.82), new_users: Math.round(sessions * 0.6), page_views: Math.round(sessions * 2.2),
          conversions: Math.round(sessions * 0.03), engaged_sessions: Math.round(sessions * 0.6),
        })
      }
    }
  }

  // Search Console — the admin Content tab reads the last 28 days. (Client GSC pages call Google live.)
  if (has('google_search_console')) {
    const cc = connectionId(client, 'google_search_console')
    const r = rng(`gsc:${client.key}`)
    const pairs = client.key === 'harbor'
      ? [['dentist near me', '/'], ['invisalign cost houston', '/invisalign/'], ['emergency dentist houston', '/emergency/'], ['teeth whitening houston', '/whitening/']]
      : [['ecoboost downpipe', '/blog/downpipe-vs-stock-pipe/'], ['dyno tune austin', '/dyno-tuning/'], ['cold air intake vs short ram', '/blog/cold-air-intake-vs-short-ram/'], ['performance shop austin', '/']]
    for (const d of history(28)) {
      for (const [query, path] of pairs) {
        const impressions = Math.round((40 + r() * 160) * weekday(d))
        const clicks = Math.round(impressions * (0.02 + r() * 0.06))
        add('gsc_metrics', {
          connection_id: cc, client_id: client.id, date: iso(d), query, page: `${client.website}${path}`, country: 'usa',
          clicks, impressions, ctr: impressions ? r2(clicks / impressions) : 0, position: r2(3 + r() * 14),
        })
      }
    }
  }

  // Business Profile
  if (has('google_business_profile')) {
    const cc = connectionId(client, 'google_business_profile')
    const r = rng(`gbp:${client.key}`)
    let reviews = 140 + Math.floor(r() * 90)
    for (const d of history()) {
      if (r() < 0.18) reviews++
      add('gbp_metrics', {
        connection_id: cc, client_id: client.id, date: iso(d), location_id: `locations/${4000 + CLIENTS.indexOf(client)}`,
        location_name: `${client.name} — ${client.city.split(',')[0]}`,
        views_search: Math.round((60 + r() * 50) * weekday(d)), views_maps: Math.round((30 + r() * 35) * weekday(d)),
        website_clicks: Math.round(4 + r() * 9), call_clicks: Math.round(2 + r() * 7), direction_clicks: Math.round(1 + r() * 5),
        photos_views: Math.round(20 + r() * 40), photos_count: 86, reviews_count: reviews, reviews_avg_rating: 4.8,
      })
    }
  }

  // GoHighLevel
  if (has('ghl')) {
    const cc = connectionId(client, 'ghl')
    const r = rng(`ghl:${client.key}`)
    for (const d of history()) {
      const forms = Math.round((2 + r() * 6) * weekday(d))
      const quote = Math.round(forms * 0.6)
      const incoming = Math.round((3 + r() * 8) * weekday(d))
      const missed = Math.round(incoming * (0.08 + r() * 0.1))
      const won = Math.round(r() * 2)
      add('ghl_metrics', {
        connection_id: cc, client_id: client.id, date: iso(d), contacts_created: forms + incoming - missed,
        total_calls: incoming + Math.round(incoming * 0.4), incoming_calls: incoming, outgoing_calls: Math.round(incoming * 0.4), missed_calls: missed,
        forms_submitted: forms, reviews_sent: Math.round(r() * 4), reviews_received: Math.round(r() * 2), spam_leads: Math.round(r() * 1.4),
        emails_sent: Math.round(10 + r() * 30), sms_sent: Math.round(8 + r() * 25),
        new_opportunities: Math.round(forms * 0.7), won_opportunities: won, lost_opportunities: Math.round(r() * 1.5),
        won_value: r2(won * (client.leadValue ?? client.aov ?? 150) * 3),
        raw_data: { form_breakdown: [
          { id: 'form_quote', name: 'Get a Quote', type: 'form', count: quote },
          { id: 'form_contact', name: 'Contact Us', type: 'form', count: forms - quote },
        ] },
      })
    }
  }

  // Ahrefs — weekly snapshots, plus keywords and pages for the two latest
  if (has('ahrefs')) {
    const cc = connectionId(client, 'ahrefs')
    const r = rng(`ahrefs:${client.key}`)
    const weeks = Array.from({ length: 10 }, (_, i) => daysAgo((9 - i) * 7 + 1))
    weeks.forEach((d, i) => add('ahrefs_metrics', {
      connection_id: cc, client_id: client.id, date: iso(d), domain_rating: r2(28 + i * 0.4),
      ahrefs_rank: 2_400_000 - i * 18_000, backlinks: 1850 + i * 35, referring_domains: 212 + i * 3,
      organic_keywords: 640 + i * 22, organic_traffic: 2100 + i * 90, traffic_value: r2(3200 + i * 140),
      new_backlinks: 30 + Math.floor(r() * 20), lost_backlinks: 10 + Math.floor(r() * 12),
      new_referring_domains: 2 + Math.floor(r() * 4), lost_referring_domains: Math.floor(r() * 3),
    }))
    const kws = client.key === 'harbor'
      ? ['dentist houston', 'invisalign houston', 'emergency dentist', 'teeth whitening houston', 'dental implants cost']
      : ['ecoboost downpipe', 'dyno tune austin', 'cold air intake vs short ram', 'performance shop austin', 'ecoboost tune']
    for (const d of weeks.slice(-2)) {
      kws.forEach((keyword, i) => add('ahrefs_keywords', {
        connection_id: cc, client_id: client.id, date: iso(d), keyword, position: 2 + i * 3 + Math.floor(r() * 3),
        volume: 1900 - i * 300, traffic: 320 - i * 50, difficulty: 18 + i * 6,
      }))
      ;['/', '/services/', '/blog/', '/contact/'].forEach((path, i) => add('ahrefs_pages', {
        connection_id: cc, client_id: client.id, date: iso(d), url: `${client.website}${path}`,
        organic_traffic: 900 - i * 180, organic_keywords: 210 - i * 40,
      }))
    }
  }

  // Sync history — last 7 days; Harbor's Business Profile has been failing
  const r = rng(`sync:${client.key}`)
  for (const type of client.sources) {
    for (let back = 1; back <= 7; back++) {
      const failing = client.key === 'harbor' && type === 'google_business_profile' && back <= 2
      add('sync_jobs', {
        connection_id: connectionId(client, type), client_id: client.id, job_type: 'incremental',
        status: failing ? 'error' : 'success', records_synced: failing ? 0 : 20 + Math.floor(r() * 400),
        error_message: failing ? 'Google Business Profile: token expired — reconnect the account' : null,
        date_from: iso(daysAgo(back + 1)), date_to: iso(daysAgo(back)), started_at: stamp(back, 6),
        completed_at: stamp(back, 6.05), triggered_by: 'cron', progress_pct: 100,
      })
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────────
async function seed(c) {
  if (DB.host !== '127.0.0.1') throw new Error('Refusing to seed a non-local database.')
  const counts = {}
  const cols = await loadColumns(c)
  const insert = makeInsert(c, cols, counts)
  const clientIds = CLIENTS.map(x => x.id)

  // Accounts first — outside the reset, they are upserted.
  for (const a of LOCAL_ACCOUNTS) {
    await c.query(
      `INSERT INTO users (email, username, name, password_hash, role, is_active, must_reset_password)
       VALUES ($1, $2, $3, $4, $5, true, false)
       ON CONFLICT (email) DO UPDATE SET
         username = EXCLUDED.username, name = EXCLUDED.name, password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role, is_active = true, must_reset_password = false, password_changed_at = NULL`,
      [a.email, a.username, a.name, bcrypt.hashSync(a.password, 10), a.role],
    )
  }
  const adminId = (await c.query(`SELECT id FROM users WHERE email = 'admin@local.test'`)).rows[0].id

  // ── Remove the last seed (children before parents) ──
  const byClient = [
    'seo_rankings', 'seo_keywords', 'content_silo_internal_links', 'content_silo_pages', 'content_silo_keywords',
    'content_posts', 'content_topics', 'content_silos', 'content_settings', 'email_campaigns', 'client_notes',
    'client_contacts', 'wp_sites', 'sites', 'ad_pause_log', 'ad_fuel_ach_pending', 'ad_fuel_ledger', 'sync_jobs',
    'ahrefs_pages', 'ahrefs_keywords', 'ahrefs_metrics', 'ghl_metrics', 'gbp_metrics', 'gsc_metrics',
    'ga4_source_metrics', 'ga4_metrics', 'meta_ads_ad_metrics', 'meta_ads_metrics', 'google_ads_asset_group_assets',
    'google_ads_search_terms', 'google_ads_negative_keywords', 'google_ads_keywords', 'google_ads_ad_metrics',
    'google_ads_metrics', 'client_campaign_assignments', 'admin_alerts', 'activity_log', 'ai_usage',
    'dataforseo_usage', 'client_connections',
  ]
  for (const t of byClient) {
    if (cols.get(t)?.has('client_id')) await c.query(`DELETE FROM public."${t}" WHERE client_id = ANY($1::uuid[])`, [clientIds])
  }
  const fixedIds = {
    admin_alerts: ['alert:agency-digest'], activity_log: ['activity:settings'], sites: ['site:agency'],
    site_groups: ['group:clients', 'group:agency'], payment_notifications: ['pay:1', 'pay:2', 'pay:3'],
    content_settings: ['content-settings:global'],
  }
  for (const [t, keys] of Object.entries(fixedIds)) {
    await c.query(`DELETE FROM public."${t}" WHERE id = ANY($1::uuid[])`, [keys.map(uid)])
  }
  await c.query(`DELETE FROM public.clients WHERE id = ANY($1::uuid[])`, [clientIds])
  const connectorIds = [...new Set(CLIENTS.flatMap(cl => cl.sources.map(t => connectorId(t, cl))))]
  await c.query(`DELETE FROM public.connectors WHERE id = ANY($1::uuid[])`, [connectorIds])

  // ── Agency settings (the one row the migrations create) ──
  await c.query(`
    UPDATE agency_settings SET
      agency_name = 'Launch Local', app_version = '5.4.0', brand_primary = '#2563eb',
      ad_fuel_cut = 0.2, ad_fuel_cutoff_date = $1, default_lead_action = 'lead', default_purchase_action = 'purchase',
      show_blog_posts = true, notification_email = 'ops@local.test', ai_provider = 'anthropic', ai_model = 'claude-sonnet-5',
      primary_user_id = $2, image_generation_enabled = true
    WHERE id = (SELECT id FROM agency_settings ORDER BY id LIMIT 1)`, [`${Y}-01-01`, adminId])

  // ── Connectors and clients ──
  await insert('connectors', connectorIds.map(id => {
    const cl = CLIENTS.find(x => x.sources.some(t => connectorId(t, x) === id))
    const type = cl.sources.find(t => connectorId(t, cl) === id)
    return {
      id, type, label: type === 'wordpress' ? `WordPress — ${cl.host}` : CONNECTOR_LABELS[type], status: 'active',
      // No real credentials anywhere: nothing local should ever authenticate against a live API.
      auth: {}, config: type === 'wordpress' ? { site_url: cl.website, username: 'local-editor', app_password: 'not-a-real-password' } : {},
      last_checked_at: stamp(0, 7),
    }
  }))

  await insert('clients', CLIENTS.map(cl => ({
    id: cl.id, name: cl.name, slug: cl.slug, email: cl.email, website: cl.website, phone: cl.phone, address: cl.address,
    dashboard_token: cl.dashboard_token, layout_type: cl.layout_type, bill_day: cl.bill_day, historic_bill_day: cl.bill_day,
    monthly_budget: cl.monthly_budget, ad_fuel_cut: cl.ad_fuel_cut, temperature: cl.temperature, account_manager_id: adminId,
    purchase_action: cl.purchase_action ?? null, show_benchmarks: true, benchmark_ctr: 3.5, benchmark_cpc: 2.8,
    benchmark_conv_rate: 6, benchmark_roas: cl.layout_type === 'ecom' ? 4 : null, benchmark_cpl: cl.layout_type === 'ecom' ? null : 45,
    show_blog_posts: cl.sources.includes('wordpress'), last_contacted_at: stamp(CLIENTS.indexOf(cl) * 4 + 2),
  })))

  await insert('client_connections', CLIENTS.flatMap(cl => cl.sources.map((type, i) => ({
    id: connectionId(cl, type), client_id: cl.id, connector_id: connectorId(type, cl), status: 'active',
    external_id: {
      google_ads: `512-555-01${CLIENTS.indexOf(cl)}${i}`, meta_ads: `act_10${CLIENTS.indexOf(cl)}000${i}`,
      google_analytics: `properties/3000${CLIENTS.indexOf(cl)}${i}`, google_search_console: `sc-domain:${cl.host}`,
      google_business_profile: `locations/${4000 + CLIENTS.indexOf(cl)}`, ghl: `ghl-location-${cl.key}`,
      wordpress: cl.website, ahrefs: cl.host,
    }[type],
    external_name: type === 'wordpress' ? cl.host : `${cl.name} — ${CONNECTOR_LABELS[type]}`,
    last_synced_at: stamp(1, 6.05), sync_from: `${Y - 1}-11-01`,
  }))))

  await insert('wp_sites', CLIENTS.filter(cl => cl.sources.includes('wordpress')).map(cl => ({
    connection_id: connectionId(cl, 'wordpress'), client_id: cl.id, site_url: cl.website,
    username: 'local-editor', app_password: 'not-a-real-password',
  })))

  // ── Metrics ──
  const rowsBy = {}
  for (const cl of CLIENTS) buildMetrics(cl, rowsBy)
  const categories = (await c.query(`SELECT id, display_mode FROM campaign_categories ORDER BY sort_order NULLS LAST`)).rows
  for (const a of rowsBy.client_campaign_assignments ?? []) {
    a.category_id = categories.find(cat => cat.display_mode === a.display_mode)?.id ?? null
  }
  for (const [table, rows] of Object.entries(rowsBy)) await insert(table, rows)

  // ── Ad Fuel billing ──
  const ledger = [], pending = []
  for (const cl of CLIENTS) {
    const gross = r2(cl.monthly_budget / (1 - cl.ad_fuel_cut))
    for (let m = 0; m <= M; m++) {
      const paid = new Date(Date.UTC(Y, m, cl.bill_day))
      if (paid > today) break
      const latest = m === M || new Date(Date.UTC(Y, m + 1, cl.bill_day)) > today
      // Summit's latest payment is an ACH still clearing — it shows as pending, not balance.
      if (cl.key === 'summit' && latest) {
        pending.push({ client_id: cl.id, invoice_id: `in_local_${cl.key}_${m + 1}`, invoice_date: iso(paid), amount_af: gross, note: `ACH pending — LL-${cl.key.toUpperCase()}-${m + 1}` })
        continue
      }
      ledger.push({
        client_id: cl.id, date_of_payment: iso(paid), invoice_date: iso(paid), amount_af: gross, type: 'MRR',
        invoice_id: `in_local_${cl.key}_${m + 1}`, note: `Monthly Ad Fuel — ${paid.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })}`,
        created_by: 'seed', ach_status: 'cleared',
      })
    }
  }
  await insert('ad_fuel_ledger', ledger)
  await insert('ad_fuel_ach_pending', pending)

  // ── Content ──
  const contentClients = [
    { cl: CLIENTS[0], posts: RIDGELINE_POSTS, topics: PENDING_TOPICS.ridgeline },
    { cl: CLIENTS[1], posts: SUMMIT_POSTS,    topics: PENDING_TOPICS.summit },
  ]
  const settingsRows = [{
    id: uid('content-settings:global'), client_id: null, target_length: 1500, posts_per_run: 1, wp_publish_mode: 'scheduled_draft',
    brand_voice: 'Plain-spoken and specific. No hype.', wizard_completed: true,
  }]
  const topicRows = [], postRows = [], links = []
  for (const { cl, posts, topics } of contentClients) {
    const r = rng(`content:${cl.key}`)
    settingsRows.push({
      client_id: cl.id, connection_id: connectionId(cl, 'wordpress'), business_background: `${cl.name} is an independent ${cl.services.split(',')[0].toLowerCase()} business in ${cl.city}.`,
      services: cl.services, target_audience: `Owners in and around ${cl.city} who want it done right the first time.`,
      geographic_focus: cl.city, brand_voice: 'Knowledgeable, direct, and friendly. Explain the why.',
      phone_number: cl.phone, schedule_frequency: 'weekly', schedule_day_of_week: 2, target_length: 1500,
      weeks_ahead: 6, posts_per_run: 1, topics_per_run: 4, wizard_completed: true, wp_publish_mode: 'scheduled_draft',
      auto_generate: false, auto_approve_topics: false, auto_push_posts: false, publish_time: '09:00',
      schedule_start_date: monthDay(1, -1), content_image_generation: true, cta_list: 'Book online, Call us',
    })

    for (const p of posts) {
      const topicId = uid(`topic:${cl.key}:${p.key}`)
      const postId  = uid(`post:${cl.key}:${p.key}`)
      const date    = monthDay(p.day, p.monthOffset ?? 0)
      const html    = p.sections.length ? articleHtml(p, cl) : null
      const words   = html ? wordCount(html) : 0
      const pushed  = p.status === 'draft_saved' || p.status === 'published'
      const approved = pushed || p.status === 'approved'
      const slug    = p.title ? p.keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : null

      topicRows.push({
        id: topicId, client_id: cl.id, topic: p.title ?? p.keyword, target_keyword: p.keyword, content_type: 'blog',
        status: { for_review: 'generated', approved: 'generated', draft_saved: 'generated', published: 'published', rejected: 'rejected', generating: 'generating' }[p.status],
        target_publish_date: date, rationale: `Steady local search demand for "${p.keyword}" and no strong local answer ranking.`,
        search_volume: 320 + Math.floor(r() * 1800), keyword_difficulty: 12 + Math.floor(r() * 30),
        competition_level: pick(r, ['low', 'medium']), search_intent: 'informational', keyword_opportunity: pick(r, ['high', 'medium']),
      })
      postRows.push({
        id: postId, client_id: cl.id, topic_id: topicId, connection_id: connectionId(cl, 'wordpress'), status: p.status,
        content_type: 'blog', target_keyword: p.keyword, focus_keyword: p.keyword, title: p.title, seo_title: p.title,
        content: html, meta_description: p.title ? `${p.title} — plain answers from ${cl.name} in ${cl.city}.`.slice(0, 158) : null,
        slug, word_count: words, heading_count: html ? (html.match(/<h2>/g) ?? []).length : 0, internal_links: 2,
        target_publish_date: date, generated_at: p.status === 'generating' ? null : stamp(20 - p.day / 2),
        // generated_by is constrained to scheduled / manual / topic; these posts come from topics.
        ai_model: 'claude-sonnet-5', generated_by: 'topic',
        featured_image_url: html ? image(`post-${cl.key}-${p.key}`, (p.title ?? '').slice(0, 34), cl.name, cl.hue) : null,
        featured_image_source: html ? 'ai_generated' : null,
        image_alt_text: html ? `${p.keyword} — ${cl.name}` : null,
        quality_report: html ? qualityReport(p, words) : null, quality_score: html ? qualityReport(p, words).score : null,
        quality_checked_at: html ? stamp(3) : null, seo_score: html ? seoScore(r, p.critical ? 64 : 84) : null,
        admin_approved_at: approved ? stamp(5) : null, admin_approved_by: approved ? 'admin@local.test' : null,
        wp_post_id: pushed ? p.wpPostId : null, wp_site_url: pushed ? cl.website : null, wp_status: pushed ? (p.status === 'published' ? 'publish' : 'future') : null,
        published_url: p.status === 'published' ? `${cl.website}/blog/${slug}/` : p.status === 'draft_saved' ? `${cl.website}/wp-admin/post.php?post=${p.wpPostId}&action=edit` : null,
        published_at: p.status === 'published' ? stamp(18) : null, last_pushed_at: pushed ? stamp(4) : null,
        platform_edit_url: pushed ? `${cl.website}/wp-admin/post.php?post=${p.wpPostId}&action=edit` : null,
        suggested_tags: ['guides', cl.key === 'ridgeline' ? 'performance' : 'home'],
      })
      links.push([topicId, postId])
    }

    for (const t of topics) {
      topicRows.push({
        id: uid(`topic:${cl.key}:${t.key}`), client_id: cl.id, topic: t.topic, target_keyword: t.keyword, content_type: 'blog',
        status: t.status, target_publish_date: monthDay(t.day, 1), rationale: 'Question-led search with thin local competition.',
        search_volume: 260 + Math.floor(r() * 900), keyword_difficulty: 10 + Math.floor(r() * 25),
        competition_level: 'low', search_intent: 'informational', keyword_opportunity: 'high',
      })
    }
  }
  await insert('content_settings', settingsRows)

  // Silo for Ridgeline, before posts (posts reference it)
  const ridge = CLIENTS[0]
  const siloId = uid('silo:ridgeline:ecoboost')
  await insert('content_silos', [{
    id: siloId, client_id: ridge.id, name: 'EcoBoost Performance', hub_page_url: `${ridge.website}/ecoboost-performance/`,
    hub_page_title: 'EcoBoost Performance Upgrades', central_entity: 'Ford EcoBoost', section: 'core', status: 'active',
    content_type: 'blog', target_keyword: 'ecoboost performance upgrades', priority: 1, inject_internal_links: true,
    description: 'Everything an EcoBoost owner asks before modifying.',
  }])
  await insert('content_topics', topicRows)
  for (const p of postRows) if (p.client_id === ridge.id && /downpipe|intake|intercooler|wastegate/.test(p.target_keyword)) p.silo_id = siloId
  await insert('content_posts', postRows)
  for (const [topicId, postId] of links) await c.query('UPDATE content_topics SET post_id = $1 WHERE id = $2', [postId, topicId])

  const kw = (k, type, extra = {}) => ({ id: uid(`silo-kw:${k}`), client_id: ridge.id, silo_id: siloId, keyword: k, keyword_type: type, intent: 'informational', monthly_searches_low: 200, monthly_searches_high: 1400, keyword_score: 62, selected: true, ...extra })
  const siloKeywords = [
    kw('ecoboost performance upgrades', 'top_level', { intent: 'commercial' }),
    kw('ecoboost tune', 'secondary_top_level'), kw('ecoboost downpipe', 'secondary_top_level'),
    kw('what does a downpipe do on an ecoboost engine', 'supporting', { target_post_id: uid('post:ridgeline:downpipe'), used_at: stamp(6) }),
    kw('ecoboost intercooler upgrade', 'supporting', { target_post_id: uid('post:ridgeline:intercooler'), used_at: stamp(30) }),
  ]
  await insert('content_silo_keywords', siloKeywords)
  const page = (key, title, type, status, extra = {}) => ({ id: uid(`silo-page:${key}`), client_id: ridge.id, silo_id: siloId, title, page_type: type, status, slug: key, ...extra })
  const pages = [
    page('hub', 'EcoBoost Performance Upgrades', 'hub', 'published', { target_url: `${ridge.website}/ecoboost-performance/`, primary_keyword_id: siloKeywords[0].id, priority: 1, sort_order: 0 }),
    page('downpipe', 'Downpipe vs Stock Pipe', 'supporting_article', 'for_review', { content_post_id: uid('post:ridgeline:downpipe'), primary_keyword_id: siloKeywords[3].id, sort_order: 1 }),
    page('intercooler', 'Intercooler Upgrades Explained', 'supporting_article', 'published', { content_post_id: uid('post:ridgeline:intercooler'), primary_keyword_id: siloKeywords[4].id, sort_order: 2 }),
    page('tune', 'Choosing an EcoBoost Tune', 'guide', 'planned', { primary_keyword_id: siloKeywords[1].id, sort_order: 3 }),
  ]
  await insert('content_silo_pages', pages)
  await insert('content_silo_internal_links', [
    { client_id: ridge.id, silo_id: siloId, source_silo_page_id: pages[0].id, target_silo_page_id: pages[1].id, anchor_text: 'what a downpipe changes', link_type: 'hub_to_supporting', status: 'recommended', reason: 'The hub summarises exhaust upgrades.' },
    { client_id: ridge.id, silo_id: siloId, source_silo_page_id: pages[2].id, target_silo_page_id: pages[0].id, anchor_text: 'EcoBoost performance upgrades', link_type: 'supporting_to_hub', status: 'inserted', reason: 'Every supporting article links back to the hub.' },
    { client_id: ridge.id, silo_id: siloId, source_silo_page_id: pages[1].id, target_silo_page_id: pages[2].id, anchor_text: 'intercooler upgrades', link_type: 'supporting_to_supporting', status: 'recommended', reason: 'Heat soak follows naturally from more boost.' },
  ])

  // Tracked keywords with weekly rank history
  const tracked = [], rankings = []
  for (const cl of [CLIENTS[0], CLIENTS[2]]) {
    const r = rng(`rank:${cl.key}`)
    const words = cl.key === 'harbor'
      ? ['dentist houston', 'invisalign houston', 'emergency dentist houston', 'teeth whitening houston']
      : ['ecoboost downpipe', 'dyno tune austin', 'cold air intake vs short ram', 'performance shop austin']
    words.forEach((keyword, i) => {
      const id = uid(`seo-kw:${cl.key}:${keyword}`)
      tracked.push({
        id, client_id: cl.id, keyword, normalized_keyword: keyword.toLowerCase(), country: 'us', source: 'dataforseo',
        search_volume: 1600 - i * 280, keyword_difficulty: 22 + i * 7, cpc: r2(2.4 + i), intent: i === 3 ? 'commercial' : 'informational',
        is_tracked: true, location_code: 2840, language_code: 'en', last_checked_at: stamp(1, 5),
      })
      let pos = 14 + i * 4
      for (let w = 7; w >= 0; w--) {
        pos = Math.max(1, pos - Math.round(r() * 3 - 0.8))
        rankings.push({
          keyword_id: id, client_id: cl.id, date: iso(daysAgo(w * 7 + 1)), position: pos, rank_absolute: pos + 1,
          url: `${cl.website}/`, search_volume: 1600 - i * 280, provider: 'dataforseo', device: 'desktop',
        })
      }
    })
  }
  await insert('seo_keywords', tracked)
  await insert('seo_rankings', rankings)

  // ── Operations: sites, alerts, activity, usage, contacts, notes, email ──
  await insert('site_groups', [{ id: uid('group:clients'), name: 'Client sites' }, { id: uid('group:agency'), name: 'Agency' }])
  await insert('sites', [
    ...CLIENTS.map((cl, i) => ({
      client_id: cl.id, name: cl.name, url: cl.website, platform: cl.layout_type === 'ecom' ? 'shopify' : 'wordpress',
      hosting_type: i % 2 ? 'client' : 'ours', hosting_provider: i % 2 ? 'Client host' : 'Cloudways', group_id: uid('group:clients'),
      status: 'active', is_up: cl.key !== 'harbor', last_checked_at: stamp(0, 8), last_status_code: cl.key === 'harbor' ? 522 : 200,
      last_response_ms: cl.key === 'harbor' ? null : 280 + i * 60, consecutive_failures: cl.key === 'harbor' ? 4 : 0,
      uptime_7d: cl.key === 'harbor' ? 96.2 : 99.95, ssl_issuer: "Let's Encrypt", ssl_days_remaining: cl.key === 'oakline' ? 9 : 61 - i * 7,
      ssl_expires_at: new Date(today.getTime() + (cl.key === 'oakline' ? 9 : 61 - i * 7) * DAY).toISOString(), ssl_last_checked: stamp(0, 8),
    })),
    { id: uid('site:agency'), client_id: null, name: 'Launch Local', url: 'https://golaunchlocal.example', platform: 'custom', hosting_type: 'ours',
      group_id: uid('group:agency'), status: 'active', is_up: true, last_checked_at: stamp(0, 8), last_status_code: 200, last_response_ms: 190,
      consecutive_failures: 0, uptime_7d: 100, ssl_issuer: "Let's Encrypt", ssl_days_remaining: 74 },
  ])

  await insert('admin_alerts', [
    { client_id: CLIENTS[1].id, client_name: CLIENTS[1].name, type: 'ad_fuel', severity: 'critical', title: 'Ad Fuel runs out before rebill',
      body: 'At the current pace Summit Home Services runs out of Ad Fuel 6 days before its next bill date.', link_url: `/admin/clients/${CLIENTS[1].id}`, created_at: stamp(0, 7) },
    { id: uid('alert:agency-digest'), client_id: null, type: 'content', severity: 'info', title: 'Monthly review is ready',
      body: '9 posts are waiting for review this month.', meta: { content_type: 'monthly_review_ready' }, link_url: '/admin/content?view=review', created_at: stamp(1, 8) },
    { client_id: CLIENTS[2].id, client_name: CLIENTS[2].name, type: 'integration', severity: 'warning', title: 'Google Business Profile needs reconnecting',
      body: 'The last two syncs failed: token expired.', link_url: `/admin/clients/${CLIENTS[2].id}`, created_at: stamp(1, 6.1) },
    { client_id: CLIENTS[0].id, client_name: CLIENTS[0].name, type: 'ad_insights', severity: 'info', title: 'Cost per lead down 18% week over week',
      body: 'Search — Tuning & Dyno is converting better since the new ad copy went live.', read_at: stamp(0, 10), created_at: stamp(2, 9) },
    { client_id: CLIENTS[3].id, client_name: CLIENTS[3].name, type: 'crm', severity: 'info', title: '12 new contacts not yet assigned',
      body: 'New contacts from the Fall Collection campaign have no owner in GoHighLevel.', created_at: stamp(3, 11) },
  ])

  const actions = [
    ['approved', 'post', 0, 'Downpipe vs Stock Pipe'], ['updated', 'client', 1, 'Monthly budget'], ['created', 'user', null, 'Local Viewer'],
    ['published', 'post', 0, 'Intercooler Upgrades Explained'], ['synced', 'connection', 2, 'Google Ads'], ['rejected', 'post', 0, 'The 10 Best Exhaust Tips'],
    ['updated', 'settings', null, 'AI model'], ['created', 'client', 3, 'Oakline Outfitters'],
  ]
  await insert('activity_log', actions.map(([action, resource_type, ci, label], i) => ({
    ...(i === 6 ? { id: uid('activity:settings') } : {}),
    user_id: adminId, user_name: 'Local Admin', action, resource_type, resource_id: label,
    client_id: ci === null ? null : CLIENTS[ci].id, client_name: ci === null ? null : CLIENTS[ci].name,
    meta: { title: label }, created_at: stamp(i * 0.7, 10),
  })))

  const usage = [], dfs = []
  for (const cl of [CLIENTS[0], CLIENTS[1]]) {
    const r = rng(`ai:${cl.key}`)
    for (let back = 29; back >= 0; back--) {
      if (r() < 0.45) usage.push({ provider: 'anthropic', model: 'claude-sonnet-5', operation: 'article', client_id: cl.id, date: iso(daysAgo(back)), created_at: stamp(back, 14),
        input_tokens: 5200 + Math.floor(r() * 2400), output_tokens: 3100 + Math.floor(r() * 1400), units: 1, cost_usd: r2(0.06 + r() * 0.04) })
      if (r() < 0.2) usage.push({ provider: 'openai', model: 'gpt-image-1', operation: 'image', client_id: cl.id, date: iso(daysAgo(back)), created_at: stamp(back, 14.2),
        input_tokens: 0, output_tokens: 0, units: 1, cost_usd: 0.04 })
      if (back % 7 === 0) usage.push({ provider: 'anthropic', model: 'claude-sonnet-5', operation: 'topics', client_id: cl.id, date: iso(daysAgo(back)), created_at: stamp(back, 6.3),
        input_tokens: 9800, output_tokens: 2600, units: 1, cost_usd: 0.07 })
      dfs.push({ client_id: cl.id, operation: 'rank_check', units: 4, cost: 0.0024, date: iso(daysAgo(back)) })
    }
  }
  await insert('ai_usage', usage)
  await insert('dataforseo_usage', dfs)

  await insert('payment_notifications', [1, 2, 3].map(n => ({
    id: uid(`pay:${n}`), stripe_event_id: `evt_local_${n}`, amount: r2(CLIENTS[n].monthly_budget / (1 - CLIENTS[n].ad_fuel_cut)),
    currency: 'usd', description: 'Ad Fuel', customer_email: CLIENTS[n].email, client_name: CLIENTS[n].name, created_at: stamp(n * 9, 15),
  })))

  await insert('ad_pause_log', [
    { client_id: CLIENTS[1].id, action: 'paused', trigger: 'auto', balance: 42.1, google_campaigns_affected: 3, meta_campaigns_affected: 1,
      paused_campaign_names: CLIENTS[1].google.map(g => g.name), created_at: stamp(26, 13) },
    { client_id: CLIENTS[1].id, action: 'resumed', trigger: 'payment', balance: 11250, google_campaigns_affected: 3, meta_campaigns_affected: 1, created_at: stamp(25, 9) },
  ])

  await insert('client_contacts', CLIENTS.flatMap(cl => [
    { client_id: cl.id, name: `${cl.name.split(' ')[0]} Owner`, email: cl.email, phone: cl.phone, role: 'primary' },
    { client_id: cl.id, name: 'Accounts Payable', email: `billing@${cl.host}`, role: 'billing' },
  ]))
  await insert('client_notes', CLIENTS.flatMap(cl => [
    { client_id: cl.id, user_id: adminId, title: 'Kickoff notes', content: `Prefers email over calls. Busiest season: ${cl.key === 'summit' ? 'June–August' : 'spring'}.`, category: 'general', pinned: true },
    { client_id: cl.id, user_id: adminId, title: 'Hosting', content: 'Site is on managed hosting; changes go through the agency.', category: 'hosting' },
  ]))

  const oak = CLIENTS[3]
  await insert('email_campaigns', [
    { client_id: oak.id, title: 'Fall Collection launch', subject_line: 'The layers are back', goal: 'Launch sales', status: 'approved',
      sent_at: iso(daysAgo(9)), open_rate: 41.2, click_rate: 3.8, conversions: 64, revenue: 5480, submitted_by: adminId, reviewed_by: adminId, reviewed_at: stamp(11) },
    { client_id: oak.id, title: 'Weekend flash sale', subject_line: '48 hours: 20% off packs', goal: 'Clear inventory', status: 'pending_review', submitted_by: adminId },
    { client_id: oak.id, title: 'Trail guide newsletter', subject_line: 'Five fall hikes near Denver', goal: 'Engagement', status: 'draft', submitted_by: adminId },
  ])

  return counts
}

// ── Run ───────────────────────────────────────────────────────────────────────────
let startedHere = null
let c
try {
  c = new pg.Client(DB)
  await c.connect()
} catch (e) {
  if (e.code !== 'ECONNREFUSED') throw e
  startedHere = (await startDatabase()).server   // local:up is not running — start the database for the seed
  c = new pg.Client(DB)
  await c.connect()
}

try {
  await c.query('BEGIN')
  const counts = await seed(c)
  await c.query('COMMIT')

  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  console.log(`Seeded ${total.toLocaleString()} rows across ${Object.keys(counts).length} tables for ${CLIENTS.length} clients.`)
  for (const [t, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${t.padEnd(32)} ${n.toLocaleString()}`)
  console.log('\nSign in:')
  for (const a of LOCAL_ACCOUNTS) console.log(`  ${a.role.padEnd(6)} ${a.email}  /  ${a.password}`)
  console.log('\nClient dashboards:')
  for (const cl of CLIENTS) console.log(`  ${cl.name.padEnd(28)} http://localhost:3000/api/auth/access?token=${cl.dashboard_token}`)
  console.log('\nThe app caches some data for up to an hour. Restart `npm run local:up` to see a reseed immediately.')
} catch (e) {
  await c.query('ROLLBACK').catch(() => {})
  console.error(`\nSEED FAILED — nothing was written.\n  ${e.message}`)
  process.exitCode = 1
} finally {
  await c.end()
  if (startedHere) await startedHere.stop()
}

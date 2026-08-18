'use client'

// ─────────────────────────────────────────────────────────────────────────────
// /overview-preview — DESIGN PREVIEW (sample data)
//
// A non-destructive preview of the proposed "streams" Overview, built with the
// real design tokens (globals.css), real components (SparkMetricCard,
// ChannelSourceCard, ConnectorLogo), Recharts, and Inter. Nothing here touches
// the live dashboard. Every widget is badged by build phase:
//   Live now              — ships from data already synced
//   Needs call sync       — per-call GHL sync (Phase 2)
//   Needs opportunity data — persisted GHL opportunities + spend map (Phase 3)
//
// Visit /overview-preview while running `npm run dev`. Use the theme toggle to
// see it in light and dark.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, Fragment } from 'react'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import SparkMetricCard from '@/components/SparkMetricCard'
import ChannelSourceCard from '@/components/ChannelSourceCard'
import { ConnectorLogo } from '@/components/ConnectorLogo'

// ── palette (matches globals.css brand + status hues; concrete for SVG) ────────
const C = {
  blue: '#2563eb', blueLt: '#3b82f6', emerald: '#10b981', amber: '#d97706',
  violet: '#7c3aed', pink: '#db2777', slate: '#94a3b8', green: '#16a34a', red: '#dc2626',
}
const AXIS = '#94a3b8'          // readable on both light & dark grounds
const GRID = 'rgba(148,163,184,.18)'
const TOOLTIP = {
  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
  borderRadius: 8, fontSize: 12, color: 'var(--text-primary)', boxShadow: '0 4px 20px rgba(0,0,0,.12)',
}

// ── sample data ────────────────────────────────────────────────────────────────
const spark = (a: number[]) => a.map(v => ({ v }))
const leadTrend = Array.from({ length: 28 }, (_, i) => {
  const weekend = i % 7 === 5 || i % 7 === 6
  return {
    d: `${((i % 28) + 16) > 30 ? (i - 14) : i + 16}`,
    calls: Math.max(1, 4 + Math.round(3 * Math.abs(Math.sin(i * 0.7))) - (weekend ? 2 : 0)),
    forms: Math.max(0, 2 + Math.round(3 * Math.abs(Math.cos(i * 0.9)))),
  }
})
const rolling = [14, 29, 33, 28, 29, 27, 33, 30, 39, 35, 32, 47].map((total, i) => {
  const calls = [8, 15, 17, 15, 16, 14, 18, 16, 22, 20, 18, 26][i]
  const wk = ['Jan 27', 'Feb 3', 'Feb 10', 'Feb 17', 'Feb 24', 'Mar 3', 'Mar 10', 'Mar 17', 'Mar 24', 'Mar 31', 'Apr 7', 'Apr 14'][i]
  return { wk, total, calls, forms: total - calls }
})
const answeredMissed = [
  { d: 'Mon', answered: 43, missed: 4 }, { d: 'Tue', answered: 25, missed: 4 },
  { d: 'Wed', answered: 33, missed: 1 }, { d: 'Thu', answered: 29, missed: 6 },
  { d: 'Fri', answered: 27, missed: 2 }, { d: 'Sat', answered: 17, missed: 2 },
  { d: 'Sun', answered: 3, missed: 1 },
]
const trafficSources = [
  { name: 'Organic Search', value: 38, color: C.blue },
  { name: 'Local / GBP', value: 27, color: C.emerald },
  { name: 'Google Ads', value: 14, color: C.amber },
  { name: 'Direct', value: 10, color: C.violet },
  { name: 'Paid Social', value: 6, color: C.pink },
  { name: 'Other', value: 5, color: C.slate },
]
const attribution = [
  { src: 'Local SEO', color: C.blue, leads: 103, open: 42, won: 32, lost: 14, aband: 15, win: '52.5%', rev: '$161.2k', pipe: '$901.8k', spend: '—', cpl: '—', cac: '—', roi: '—', roiPos: null },
  { src: 'Google Ads', color: C.emerald, leads: 44, open: 10, won: 17, lost: 13, aband: 4, win: '50.0%', rev: '$38.6k', pipe: '$258.4k', spend: '$3.5k', cpl: '$80', cac: '$206', roi: '+1004%', roiPos: true },
  { src: 'Word of Mouth', color: C.amber, leads: 16, open: 7, won: 6, lost: 2, aband: 1, win: '66.7%', rev: '$79.4k', pipe: '$167.0k', spend: '—', cpl: '—', cac: '—', roi: '—', roiPos: null },
  { src: 'Direct Visits', color: C.violet, leads: 9, open: 7, won: 1, lost: 1, aband: 0, win: '50.0%', rev: '$138.4k', pipe: '$202.9k', spend: '—', cpl: '—', cac: '—', roi: '—', roiPos: null },
  { src: 'Facebook Ads', color: C.pink, leads: 4, open: 1, won: 1, lost: 1, aband: 1, win: '33.3%', rev: '$4.2k', pipe: '$8.6k', spend: '$604', cpl: '$151', cac: '$604', roi: '+587%', roiPos: true },
]

// ── small helpers ────────────────────────────────────────────────────────────
type Phase = 'live' | 'p2' | 'p3'
function PhaseBadge({ phase }: { phase: Phase }) {
  const map: Record<Phase, { label: string; bg: string; color: string }> = {
    live: { label: 'Live now', bg: 'var(--green-subtle)', color: 'var(--green)' },
    p2: { label: 'Needs call sync', bg: 'var(--amber-subtle)', color: 'var(--amber)' },
    p3: { label: 'Needs opportunity data', bg: 'rgba(124,58,237,.14)', color: '#8b5cf6' },
  }
  const s = map[phase]
  return <span className="badge" style={{ background: s.bg, color: s.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{s.label}</span>
}

function CardHead({ title, sub, phase }: { title: string; sub?: string; phase: Phase }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
      <div>
        <div className="section-title">{title}</div>
        {sub && <div className="section-desc">{sub}</div>}
      </div>
      <PhaseBadge phase={phase} />
    </div>
  )
}

const card: React.CSSProperties = { padding: '16px 18px' }

export default function OverviewPreview() {
  const [dark, setDark] = useState(true)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  }, [dark])

  return (
    <div style={{ maxWidth: 1440, margin: '0 auto', padding: '20px clamp(14px,3vw,32px) 80px' }}>

      {/* TOP BAR */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', paddingBottom: 16, marginBottom: 20, borderBottom: '1px solid var(--border-subtle)' }}>
        <div>
          <div className="page-title" style={{ fontSize: '1.4rem' }}>Overview</div>
          <div className="section-desc" style={{ marginTop: 2 }}>Cliffside HVAC · Last 30 days · <span style={{ color: 'var(--text-faint)' }}>preview · sample data</span></div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-secondary btn-sm" onClick={() => setDark(d => !d)}>{dark ? '☀ Light' : '☾ Dark'}</button>
        <span className="btn btn-secondary btn-sm">Last 30 Days ▾</span>
        <span className="btn btn-primary btn-sm">⤴ Share</span>
        <span className="btn btn-secondary btn-sm">⬇ Export</span>
      </div>

      {/* PHASE LEGEND */}
      <div className="card" style={{ padding: '11px 16px', marginBottom: 20, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="section-label">Build phases</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-muted)' }}><PhaseBadge phase="live" /> from data you already sync</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-muted)' }}><PhaseBadge phase="p2" /> per-call GHL sync (prototype first)</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-muted)' }}><PhaseBadge phase="p3" /> persist opportunities + spend map</span>
      </div>

      {/* KPI ROW */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 14, marginBottom: 20 }} className="kpi-grid">
        <SparkMetricCard label="Qualified Leads" value="169" delta={42} sub="first-time · calls + forms" sparkData={spark([6, 5, 7, 8, 7, 9, 11, 13])} sparkColor={C.blue} delay={0} />
        <SparkMetricCard label="Qualified Calls" value="114" delta={33} sub="first-time · calls only" sparkData={spark([7, 6, 8, 7, 9, 8, 11, 12])} sparkColor={C.emerald} delay={1} />
        <SparkMetricCard label="Qualified Web Forms" value="55" delta={67} sub="first-time · forms only" sparkData={spark([3, 4, 4, 6, 5, 8, 9, 11])} sparkColor={C.violet} delay={2} />
        <SparkMetricCard label="Google Ads Leads" value="58" delta={176} sub="first-time · calls + forms" sparkData={spark([2, 3, 4, 5, 7, 8, 11, 14])} sparkColor={C.blueLt} delay={3} />
        <SparkMetricCard label="Google Ads Calls" value="32" delta={220} sub="first-time · calls only" sparkData={spark([1, 2, 3, 5, 6, 8, 10, 12])} sparkColor={C.amber} delay={4} />
        <SparkMetricCard label="Google Ads Web Forms" value="26" delta={136} sub="first-time · forms only" sparkData={spark([2, 3, 3, 5, 6, 7, 9, 10])} sparkColor={C.pink} delay={5} />
      </div>

      {/* PIPELINE + HEATMAP */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 16, marginBottom: 20 }} className="two-col">
        <div className="card" style={card}>
          <CardHead title="Est. Pipeline Value" sub="Qualified leads × close rate × avg job value" phase="live" />
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
            <span className="metric-value" style={{ fontSize: '2.4rem' }}>$591,500</span>
            <span className="badge badge-green">▲ 38% vs prior</span>
          </div>
          <div style={{ display: 'flex', gap: 26, marginTop: 16, flexWrap: 'wrap' }}>
            {[['Qualified leads', '169'], ['Close rate', '35%'], ['Avg job value', '$10,000']].map(([l, v]) => (
              <div key={l}><div className="metric-label">{l}</div><div style={{ fontWeight: 700, fontSize: 16, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{v}</div></div>
            ))}
          </div>
          <div className="section-desc" style={{ marginTop: 14 }}><b style={{ color: 'var(--text-secondary)' }}>Needs:</b> two admin-editable client fields (close rate, avg job value) — a settings change, not a sync.</div>
        </div>

        <div className="card" style={{ ...card, borderStyle: 'dashed' }}>
          <CardHead title="Call Volume · Hour & Day" sub="Sales-tagged calls by hour · sample" phase="p2" />
          <Heatmap />
        </div>
      </div>

      {/* STREAMS */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }} className="two-col">
        <StreamBand tag="Paid Ads" color={C.blue}>
          <div style={{ display: 'grid', gap: 12 }}>
            <ChannelSourceCard title="Google Ads" color={C.blue} href="#" icon={<ConnectorLogo type="google_ads" size={16} />}
              metrics={[{ label: 'Spend', value: '$14.2k', delta: 8 }, { label: 'Leads', value: '58', delta: 176 }, { label: 'CPL', value: '$245', delta: -61 }, { label: 'Conv. rate', value: '6.4%', delta: 41 }]} />
            <ChannelSourceCard title="Meta Ads" color="#0866ff" href="#" icon={<ConnectorLogo type="meta_ads" size={16} />}
              metrics={[{ label: 'Spend', value: '$6.1k', delta: 3 }, { label: 'Leads', value: '22', delta: 47 }, { label: 'CPL', value: '$277', delta: -22 }, { label: 'ROAS', value: '3.1×', delta: 12 }]} />
          </div>
        </StreamBand>

        <StreamBand tag="Local SEO / Organic" color={C.emerald}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }} className="conn-grid">
            <ChannelSourceCard title="Business Profile" color={C.emerald} href="#" icon={<ConnectorLogo type="google_business_profile" size={16} />}
              metrics={[{ label: 'Calls', value: '88', delta: 19 }, { label: 'Directions', value: '241', delta: 12 }]} />
            <ChannelSourceCard title="Search Console" color={C.blueLt} href="#" icon={<ConnectorLogo type="google_search_console" size={16} />}
              metrics={[{ label: 'Clicks', value: '3.4k', delta: 27 }, { label: 'Avg pos', value: '8.1', delta: 14 }]} />
            <ChannelSourceCard title="GA4" color={C.amber} href="#" icon={<ConnectorLogo type="google_analytics" size={16} />}
              metrics={[{ label: 'Sessions', value: '9.7k', delta: 22 }, { label: 'Engaged', value: '61%', delta: 4 }]} />
            <ChannelSourceCard title="Ahrefs" color={C.violet} href="#" icon={<ConnectorLogo type="ahrefs" size={16} />}
              metrics={[{ label: 'Ref domains', value: '412', delta: 2 }, { label: 'DR', value: '38', delta: 6 }]} />
          </div>
        </StreamBand>
      </div>

      {/* LEAD TREND + DONUT */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 16, marginBottom: 20 }} className="two-col">
        <div className="card" style={card}>
          <CardHead title="Last 30 Days · Lead Trend" sub="First-time qualified leads per day" phase="live" />
          <ChartLegend items={[{ c: C.blue, l: 'Calls' }, { c: C.emerald, l: 'Forms' }]} />
          <div style={{ height: 210 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={leadTrend} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="d" tick={{ fontSize: 10, fill: AXIS }} axisLine={false} tickLine={false} interval={4} />
                <YAxis tick={{ fontSize: 10, fill: AXIS }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={TOOLTIP} cursor={{ fill: 'rgba(148,163,184,.1)' }} />
                <Bar dataKey="calls" stackId="a" fill={C.blue} isAnimationActive={false} />
                <Bar dataKey="forms" stackId="a" fill={C.emerald} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card" style={card}>
          <CardHead title="Traffic Sources" sub="GA4 sessions by channel" phase="live" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ width: 132, height: 132, position: 'relative', flex: 'none' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={trafficSources} dataKey="value" innerRadius={40} outerRadius={62} paddingAngle={2} stroke="none" isAnimationActive={false}>
                    {trafficSources.map((s, i) => <Cell key={i} fill={s.color} />)}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
                <div style={{ textAlign: 'center' }}><div style={{ fontWeight: 700, fontSize: 17 }}>9.7k</div><div className="section-desc" style={{ fontSize: 10 }}>sessions</div></div>
              </div>
            </div>
            <div style={{ display: 'grid', gap: 5, flex: 1, minWidth: 150 }}>
              {trafficSources.map(s => (
                <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color, flex: 'none' }} />
                  {s.name}<span style={{ marginLeft: 'auto', fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{s.value}%</span>
                </div>
              ))}
            </div>
          </div>
          <div className="section-desc" style={{ marginTop: 12 }}><b style={{ color: 'var(--text-secondary)' }}>Note:</b> web traffic channels (GA4) — distinct from CRM lead source (Phase 3).</div>
        </div>
      </div>

      {/* 12-WEEK LINE */}
      <div className="card" style={{ ...card, marginBottom: 20 }}>
        <CardHead title="12-Week Rolling Trend" sub="First-time qualified leads per week · last 12 weeks" phase="live" />
        <ChartLegend items={[{ c: C.blue, l: 'Total leads' }, { c: C.emerald, l: 'Calls', dash: true }, { c: C.violet, l: 'Forms', dash: true }]} />
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rolling} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="wk" tick={{ fontSize: 10, fill: AXIS }} axisLine={false} tickLine={false} interval={1} />
              <YAxis tick={{ fontSize: 10, fill: AXIS }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TOOLTIP} />
              <Line dataKey="total" stroke={C.blue} strokeWidth={2.6} dot={{ r: 2.5, fill: C.blue }} activeDot={{ r: 5 }} isAnimationActive={false} />
              <Line dataKey="calls" stroke={C.emerald} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
              <Line dataKey="forms" stroke={C.violet} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* CALL PERFORMANCE (P2) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 16, marginBottom: 20 }} className="two-col">
        <div className="card" style={{ ...card, borderStyle: 'dashed' }}>
          <CardHead title="Answered vs Missed · By Day of Week" sub="Sales-tagged calls · sample" phase="p2" />
          <ChartLegend items={[{ c: C.green, l: 'Answered' }, { c: C.red, l: 'Missed / Voicemail' }]} />
          <div style={{ height: 190 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={answeredMissed} margin={{ top: 6, right: 6, left: -18, bottom: 0 }} barGap={2}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="d" tick={{ fontSize: 11, fill: AXIS }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: AXIS }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={TOOLTIP} cursor={{ fill: 'rgba(148,163,184,.1)' }} />
                <Bar dataKey="answered" fill={C.green} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="missed" fill={C.red} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="section-desc" style={{ marginTop: 10 }}><b style={{ color: 'var(--text-secondary)' }}>Needs:</b> per-call status from message-level GHL sync. Today <code>missed_calls</code> reads 3 of 27,217 — not usable.</div>
        </div>
        <div style={{ display: 'grid', gap: 16 }}>
          <StatTile phase="p2" value="90%" valueColor="var(--green)" label="Answer Rate" sub="▲ 5% vs prior · sample" />
          <StatTile phase="p2" value="20" valueColor="var(--red)" label="Missed Sales Calls" sub="▼ 26% vs prior · sample" />
        </div>
      </div>

      {/* ATTRIBUTION TABLE (P3) */}
      <div className="card" style={{ ...card, borderStyle: 'dashed' }}>
        <CardHead title="Lead Source Report — where your leads & revenue come from" sub="Cohort attribution · last 90 days · sample" phase="p3" />
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table data-table--compact" style={{ minWidth: 860 }}>
            <thead><tr>
              {['Source', 'Leads', 'Open', 'Won', 'Lost', 'Aband.', 'Win %', 'Revenue', 'Pipeline $', 'Spend', 'CPL', 'CAC', 'ROI'].map((h, i) => (
                <th key={h} style={{ textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {attribution.map(r => (
                <tr key={r.src}>
                  <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600, color: 'var(--text-primary)' }}>
                    <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>▸</span>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color }} />{r.src}</span></td>
                  <td style={{ textAlign: 'right' }}>{r.leads}</td>
                  <td style={{ textAlign: 'right' }}>{r.open}</td>
                  <td style={{ textAlign: 'right', color: 'var(--green)', fontWeight: 600 }}>{r.won}</td>
                  <td style={{ textAlign: 'right', color: 'var(--red)' }}>{r.lost}</td>
                  <td style={{ textAlign: 'right' }}>{r.aband || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{r.win}</td>
                  <td style={{ textAlign: 'right', color: 'var(--green)', fontWeight: 600 }}>{r.rev}</td>
                  <td style={{ textAlign: 'right' }}>{r.pipe}</td>
                  <td style={{ textAlign: 'right', color: r.spend === '—' ? 'var(--text-faint)' : undefined }}>{r.spend}</td>
                  <td style={{ textAlign: 'right', color: r.cpl === '—' ? 'var(--text-faint)' : undefined }}>{r.cpl}</td>
                  <td style={{ textAlign: 'right', color: r.cac === '—' ? 'var(--text-faint)' : undefined }}>{r.cac}</td>
                  <td style={{ textAlign: 'right', color: r.roiPos ? 'var(--green)' : 'var(--text-faint)', fontWeight: r.roiPos ? 600 : 400 }}>{r.roi}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr style={{ borderTop: '2px solid var(--border)' }}>
              <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Total</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>176</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>67</td>
              <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--green)' }}>57</td>
              <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--red)' }}>31</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>21</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>32.4%</td>
              <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--green)' }}>$421.8k</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>$1.54M</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>$4.1k</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>$85</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>$228</td>
              <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--green)' }}>+943%</td>
            </tr></tfoot>
          </table>
        </div>
        <div className="section-desc" style={{ marginTop: 12 }}><b style={{ color: 'var(--text-secondary)' }}>Needs:</b> persist GHL <b>opportunities</b> (source, stage, value, dates) + a lead-source→spend map. Until then, <span style={{ color: '#8b5cf6', fontWeight: 600 }}>Spend / CPL / CAC / ROI</span> stay client-blended (shown per-source here for illustration).</div>
      </div>

      <p className="section-desc" style={{ textAlign: 'center', marginTop: 26 }}>
        Preview · sample data · real tokens &amp; components. Live-now widgets recompose what you already sync; badged widgets gate on the phased data work.
      </p>

      <style jsx global>{`
        @media (max-width: 1080px){ .two-col{ grid-template-columns:1fr !important } .kpi-grid{ grid-template-columns:repeat(3,1fr) !important } }
        @media (max-width: 560px){ .kpi-grid{ grid-template-columns:repeat(2,1fr) !important } .conn-grid{ grid-template-columns:1fr !important } }
      `}</style>
    </div>
  )
}

// ── sub-components ────────────────────────────────────────────────────────────
function StreamBand({ tag, color, children }: { tag: string; color: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--border-subtle)', borderRadius: '0.625rem', padding: 14, background: 'var(--bg-secondary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 13 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
        <span className="section-label" style={{ color: 'var(--text-secondary)' }}>{tag}</span>
        <span style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
        <PhaseBadge phase="live" />
      </div>
      {children}
    </div>
  )
}

function StatTile({ phase, value, valueColor, label, sub }: { phase: Phase; value: string; valueColor: string; label: string; sub: string }) {
  return (
    <div className="card" style={{ padding: 18, borderStyle: 'dashed', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, position: 'relative', minHeight: 118 }}>
      <div style={{ position: 'absolute', top: 12, left: 14 }}><PhaseBadge phase={phase} /></div>
      <div className="metric-value" style={{ fontSize: '2.6rem', color: valueColor }}>{value}</div>
      <div className="metric-label">{label}</div>
      <div className="section-desc">{sub}</div>
    </div>
  )
}

function ChartLegend({ items }: { items: { c: string; l: string; dash?: boolean }[] }) {
  return (
    <div style={{ display: 'flex', gap: 16, fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 8 }}>
      {items.map(it => (
        <span key={it.l} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 15, height: it.dash ? 0 : 9, borderRadius: 2, background: it.dash ? 'transparent' : it.c, borderTop: it.dash ? `2px dashed ${it.c}` : undefined }} />{it.l}
        </span>
      ))}
    </div>
  )
}

function Heatmap() {
  const hours = ['7a', '8a', '9a', '10a', '11a', '12p', '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p']
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const dayW = [1, 0.95, 1.05, 0.9, 0.85, 0.45, 0.3]
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: `34px repeat(14,1fr)`, gap: 3, alignItems: 'center' }}>
        <div />
        {hours.map(h => <div key={h} style={{ fontSize: 9, color: 'var(--text-faint)', textAlign: 'center' }}>{h}</div>)}
        {days.map((day, d) => (
          <Fragment key={day}>
            <div style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 600 }}>{day}</div>
            {hours.map((_, h) => {
              const bell = Math.exp(-Math.pow((h - 4.5) / 4.2, 2))
              const v = Math.max(0, Math.min(1, bell * dayW[d] * (0.75 + 0.5 * Math.abs(Math.sin(d * 3 + h)))))
              return <div key={`${d}-${h}`} style={{ aspectRatio: '1 / 0.82', borderRadius: 3, background: 'var(--accent)', opacity: 0.1 + v * 0.85 }} />
            })}
          </Fragment>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--text-faint)', marginTop: 11, justifyContent: 'flex-end' }}>
        Fewer
        {[0.18, 0.4, 0.65, 0.9].map(o => <span key={o} style={{ width: 15, height: 10, borderRadius: 2, background: 'var(--accent)', opacity: o }} />)}
        More
      </div>
    </>
  )
}

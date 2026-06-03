# DESIGN.md — Design System Reference

## Color Tokens

### Brand Blues (Tailwind custom scale in tailwind.config.ts)
| Token | Tailwind class | Hex |
|---|---|---|
| brand-50 | `bg-brand-50` / `text-brand-50` | `#eff6ff` |
| brand-500 | `bg-brand-500` / `text-brand-500` | `#3b82f6` |
| brand-600 | `bg-brand-600` / `text-brand-600` | `#2563eb` |
| brand-700 | `bg-brand-700` / `text-brand-700` | `#1d4ed8` |

The agency can override the primary accent via `agency_settings.brand_primary` (default `#2563eb`). `ThemeProvider` writes it to CSS custom properties `--accent`, `--accent-hover`, `--accent-subtle` using HSL math.

### Gray Scale (Tailwind defaults used throughout)
| Usage | Tailwind class | Approx hex |
|---|---|---|
| Page background | `bg-gray-50` | `#f9fafb` |
| Card background | `bg-white` | `#ffffff` |
| Subtle background | `bg-gray-100` | `#f3f4f6` |
| Border | `border-gray-200` | `#e5e7eb` |
| Muted text | `text-gray-400` | `#9ca3af` |
| Secondary text | `text-gray-500` | `#6b7280` |
| Body text | `text-gray-700` | `#374151` |
| Heading text | `text-gray-900` | `#111827` |

### Status Colors
| Status | Tailwind class | Hex | Usage |
|---|---|---|---|
| Success / green | `text-emerald-600`, `bg-emerald-50` | `#059669` | Positive delta, active sync dot |
| Warning / amber | `text-amber-500`, `bg-amber-50` | `#f59e0b` | Low Ad Fuel, amber sync dot |
| Error / red | `text-red-600`, `bg-red-50` | `#ef4444` | Error sync dot, negative delta |
| Info / blue | `text-blue-600`, `bg-blue-50` | `#2563eb` | Info banners |

### Efficiency Score Colors (from `scoreColor()` in `lib/agency-settings.ts`)
| Score range | Hex | Meaning |
|---|---|---|
| 71–100 | `#10b981` | Strong (emerald) |
| 41–70 | `#f59e0b` | Needs Work (amber) |
| 0–40 | `#ef4444` | Underperforming (red) |

### Chart Colors (agency-configurable, defaults from `DEFAULT_SETTINGS`)
| Role | Default hex | Agency setting key |
|---|---|---|
| Current spend bars | `#93c5fd` | `chart_color_spend` |
| Prior spend bars | `#94a3b8` | `chart_color_prior_spend` |
| Current conversions line | `#059669` | `chart_color_conversions` |
| Prior conversions line | `#34d399` | `chart_color_prior_conversions` |

### Ad Fuel Badge Colors
- Fill gradient: blue (`#3b82f6` → `#1d4ed8`)
- Low balance (< $200): amber fill (`#f59e0b`)

---

## Typography

**Font family:** Inter (loaded via `next/font/google` in `src/app/layout.tsx`, applied to `<html>` via className)

### Size Scale Used
| Usage | Tailwind | px equiv |
|---|---|---|
| Page heading | `text-2xl` | 24px |
| Section heading | `text-xl` | 20px |
| Card heading | `text-lg` | 18px |
| Body / label | `text-sm` | 14px |
| Small label / badge | `text-xs` | 12px |
| KPI value (large) | `text-3xl` | 30px |
| KPI value (compact) | `text-2xl` | 24px |

### Weight Scale
| Usage | Tailwind |
|---|---|
| Page heading | `font-bold` (700) |
| Section heading | `font-semibold` (600) |
| Card label | `font-medium` (500) |
| Body | `font-normal` (400) |
| Muted | `font-normal text-gray-400` |

### Line Heights
Standard Tailwind defaults apply: `leading-tight` (1.25) for headings, `leading-normal` (1.5) for body text.

---

## Spacing Scale
The project uses Tailwind's default 4px-base spacing. Common patterns:
- Card padding: `p-4` (16px) or `p-6` (24px)
- Section gap: `gap-4` (16px) or `gap-6` (24px)
- Inline item gap: `gap-2` (8px) or `gap-3` (12px)
- Page top padding: `pt-6` (24px)
- Sidebar width: fixed `w-64` (256px) on desktop

---

## Component Reference

### MetricCard
**File:** `src/components/MetricCard.tsx`
**Props:**
```ts
{
  label: string
  value: string
  delta?: number           // percent change vs prior period
  sub?: string             // sub-label below value
  invertDelta?: boolean    // flip good/bad colors (for cost metrics)
  delay?: number           // framer-motion stagger delay (ms)
}
```
**Appearance:** White card, rounded-xl, shadow-sm. Large value in `text-3xl font-bold`. Delta badge with TrendUp/TrendDown phosphor icon in green or red (inverted for CPC/CPM/CPL). Animated fade-in-up on mount via framer-motion. `useReducedMotion` respected.
**Usage:** KPI summary rows. Not for sparkline data; use `SparkMetricCard` instead.

---

### SparkMetricCard
**File:** `src/components/SparkMetricCard.tsx`
**Props:**
```ts
{
  label: string
  value: string
  delta?: number
  invertDelta?: boolean
  sub?: string
  sparkData?: { v: number }[]
  sparkColor?: string
  benchmark?: { actual: number; target: number; actualLabel: string; targetLabel: string; color: string }
  delay?: number
}
```
**Appearance:** Same card shell as MetricCard. Adds a `Sparkline` chart (Recharts AreaChart, 40px tall) below the value. Optional benchmark bar shows actual vs target as a colored progress bar with labels. `useReducedMotion` respected.
**Usage:** Main dashboard cockpit KPI cards, campaign detail KPI cards.

---

### Sparkline
**File:** `src/components/Sparkline.tsx`
**Props:**
```ts
{
  data: { v: number }[]
  color?: string     // default: brand blue
  height?: number    // default: 40
}
```
**Appearance:** Recharts `AreaChart` inside `ResponsiveContainer`. Single area with gradient fill. No axes, no tooltip, no animation. Returns null if fewer than 2 data points.
**Usage:** Embedded inside `SparkMetricCard` only.

---

### SpendChart
**File:** `src/components/SpendChart.tsx`
**Props:**
```ts
{
  data: DailyMetric[]
  priorData?: DailyMetric[]
  colorSpend?: string
  colorPriorSpend?: string
  colorConversions?: string
  colorPriorConversions?: string
  spendLabel?: string
  conversionsLabel?: string
  variant?: 'currency' | 'count'  // default: 'currency'
}
```
**Appearance:** Recharts `ComposedChart`. Dual Y axes. Bars for spend (current + prior side-by-side). Lines for conversions (current solid, prior dashed). Tooltip shows both values. Legend at bottom. Prior period bars/lines are muted (semi-transparent).
**Usage:** Main dashboard daily performance chart, GBP views chart, GA4 sessions chart (sessions mapped to the spend axis).

---

### CampaignTable
**File:** `src/components/CampaignTable.tsx`
**Props:**
```ts
{
  campaigns: Campaign[]
  connectionId?: string
  connectionsBySource?: Record<string, string>
  dateFrom?: string
  dateTo?: string
  compare?: string
  campaignBasePath?: string
  columns?: ColumnKey[]   // from lib/metric-layouts
}
```
**Appearance:** Sortable data table with sticky header. Each campaign name links to drill-down. Columns configurable via `ColumnKey` array. Default columns: campaign_name, status, spend, impressions, clicks, ctr, conversions, conv_rate, cpa, daily_budget.
**Variants:** Ecommerce campaigns show ROAS instead of CPA. Status column has colored dots.

---

### AdGroupTable / AdRowTable
**File:** `src/components/AdTable.tsx`
**AdGroupTable Props:**
```ts
{
  rows: AdGroupRow[]
  conversionLabel: string
  isPMax?: boolean
  tableColumns?: string[]
}
```
**AdRowTable Props:**
```ts
{
  rows: AdRow[]
  conversionLabel: string
  showCardView?: boolean
  tableColumns?: string[]
  clientId?: string
}
```
**Appearance:** Both are sortable tables with a totals footer row. `AdRowTable` adds a card/list view toggle (icon buttons, top-right). Card view shows ad creative thumbnail. Meta mode adds a Facebook-style ad preview modal on thumbnail click.

---

### AdCreativeSlider
**File:** `src/components/AdCreativeSlider.tsx`
**Props:** `{ ads: AdSlide[] }`
**Appearance:** Card-style slideshow. Filters to ACTIVE/ENABLED ads with images. LightboxImage thumbnail, creative copy (title + body), prev/next arrows, dot indicators, ad count label.

---

### AdSetCards
**File:** `src/components/AdSetCards.tsx`
**Props:**
```ts
{
  adSets: AdSetData[]
  displayMode?: DisplayMode
  adFuelCut?: number
  conversionLabel?: string
  groupLabel?: string
  clientId?: string
}
```
**Appearance:** Vertical list of ad set headers with aggregated metrics, each followed by a responsive grid of `AdCard` sub-components. Meta images proxied through `/api/proxy/meta-image`.

---

### KeywordTable
**File:** `src/components/KeywordTable.tsx`
**Props:**
```ts
{
  rows: KeywordRow[]
  conversionLabel?: string
  isEcom?: boolean
  adFuelLabel?: string
}
```
**Appearance:** Sortable table. Match type colored pills: Broad=blue, Phrase=orange, Exact=purple. Status dots. CPA column hidden when `isEcom` is true.

---

### KeywordSummary
**File:** `src/components/KeywordSummary.tsx`
**Props:** `{ keywords: AggKeyword[], negativeCount: number, conversionLabel?: string }`
**Appearance:** Three stacked cards: stats + progress bars, top converting keywords (green pills), non-converting keywords with spend (red pills), horizontal bar chart (top 10 by spend).

---

### NegativeKeywordList
**File:** `src/components/NegativeKeywordList.tsx`
**Props:** `{ rows: NegativeKeywordRow[], level: 'campaign' | 'adgroup' }`
**Appearance:** Horizontal wrap of colored pill badges. "−keyword" prefix. Broad=red, Phrase=orange, Exact=purple.

---

### SearchAdCopy
**File:** `src/components/SearchAdCopy.tsx`
**Props:** `{ ads: SearchAdCopyRow[] }`
**Appearance:** List of RSA/ETA cards. Ad strength badge: Excellent=emerald, Good=blue, Average=amber, Poor=red. Headlines as pill tags. Descriptions as text blocks.

---

### PMaxAssetSlider
**File:** `src/components/PMaxAssetSlider.tsx`
**Props:** `{ assets: PMaxAsset[] }`
**Appearance:** Three sections — image grid (lightbox, type badge overlays), logo thumbnails, YouTube video thumbnails (play overlay). Body scroll locked when overlay open.

---

### EfficiencyScore
**File:** `src/components/EfficiencyScore.tsx`
**Props:** `{ score: number, components: ComponentScore[], compact?: boolean }`
**Appearance:** Full: SVG ring gauge 0–100 with label (Strong/Needs Work/Underperforming) and component breakdown bars. Compact: small ring with score number only. Color from `scoreColor()`.

---

### MetricCard (admin)
See `MetricCard.tsx` above.

### AdFuelBadge
**File:** `src/components/dashboard/AdFuelBadge.tsx`
**Props:** `{ balance: number, clientName: string, monthlyBudget?: number }`
**Appearance:** 188×76px fuel tank widget. Liquid-fill animation proportional to balance vs budget. Amber when balance < $200. "+" button links to external refill form. `'use client'` component; uses `mounted` state gate to animate fill from 0.

---

### DashboardSidebar
**File:** `src/components/DashboardSidebar.tsx`
**Props:**
```ts
{
  activeConnectorTypes: ConnectorType[]
  agencyLogoUrl?: string
  agencyName?: string
  clientLogoUrl?: string
  clientName?: string
  basePath?: string
  isAdminPreview?: boolean
  crmName?: string
  hasLocalDominator?: boolean
}
```
**Appearance:** Sticky full-height sidebar (w-64). Agency + client branding header. Collapsible nav sections (Summary, Paid Ads, Analytics, SEO, CRM). Footer tag. Nav items filtered by active connectors unless `isAdminPreview`.

---

### DateRangePicker
**File:** `src/components/DateRangePicker.tsx`
**Props:** `{ from: string, to: string, compare?: string }`
**Appearance:** Dropdown button with preset label or custom date range. "vs" badge for comparison mode. Panel: preset list, custom date inputs, compare radio buttons (previous period / same period last year / none). All URL-driven via `router.push`.

---

### ConnectorLogo
**File:** `src/components/ConnectorLogo.tsx`
**Props:** `{ type: ConnectorType | string, size?: number, className?: string }`
**Appearance:** Platform-accurate inline SVGs by type. Supports: google_ads, meta_ads, google_analytics, google_search_console, ghl, wordpress. Falls back to initial badge. Also exports standalone named logo components.

---

### ChannelSourceCard
**File:** `src/components/ChannelSourceCard.tsx`
**Props:**
```ts
{
  title: string
  color: string
  icon: React.ReactNode
  metrics: { label: string; value: string; delta?: number }[]
  href: string
}
```
**Appearance:** Clickable card (Next.js Link) with colored left border, icon, title, metric rows with delta arrows.

---

### Skeleton Components
**File:** `src/components/Skeleton.tsx`
Exports: `Skeleton`, `SkeletonMetricCard`, `SkeletonCard`, `SkeletonTable`, `SkeletonChart`. All use `.skeleton` CSS class (shimmer animation in globals.css). No props beyond optional `className`/`rows`/`cols`/`height`.

---

### TabContainer
**File:** `src/components/TabContainer.tsx`
**Props:** `{ tabs: Tab[], panels: React.ReactNode[], defaultTab?: number }`
**Appearance:** Accessible tab UI (ARIA roles). Underline-style active indicator. Optional count badge on each tab. Non-active panels get `display: none` (not unmounted).

---

### LightboxImage
**File:** `src/components/LightboxImage.tsx`
**Props:** `{ src: string, alt: string, width?: number, height?: number, videoId?: string | null, fullSrc?: string }`
**Appearance:** Thumbnail. Video ID → YouTube link (new tab). Otherwise: clicking opens full-screen overlay with `fullSrc ?? src`. Escape key closes.

---

### CopyButton
**File:** `src/components/CopyButton.tsx`
**Props:** `{ text: string }`
**Appearance:** Small inline "Copy / Copied!" button. `copied` state resets after 2s. `navigator.clipboard` with `document.execCommand` fallback.

---

### ThemeProvider
**File:** `src/components/ThemeProvider.tsx`
**Props:** `{ initialMode: ThemeMode, initialAccent: string, children: React.ReactNode }`
**Appearance:** Invisible context provider. Applies `data-theme` to `<html>`. Computes accent CSS variables from HSL. Debounce-PATCHes `/api/admin/users/me` (800ms). Exports `useTheme()` hook.

---

### PreviewBanner
**File:** `src/components/PreviewBanner.tsx`
**Props:** `{ client: { id: string, name: string }, allClients: { id: string, name: string }[] }`
**Appearance:** Dark admin bar at top of screen. POSTs to `/api/admin/preview/[clientId]` on client switch. "Back to Admin" button POSTs to `/api/admin/preview/exit`.

---

### ExportButtons
**File:** `src/components/ExportButtons.tsx`
**Props:** `{ clientId: string, from?: string, to?: string, compare?: string }`
**Appearance:** CSV download button + Report dropdown (Print/PDF, Email Report). Click-outside closes dropdown.

---

## Icon System

**Library:** `@phosphor-icons/react` v2.1.10

**Weights used across codebase:**
- `Regular` — default navigation and UI icons
- `Bold` — emphasis, active states
- `Fill` — status indicators, colored badges
- `Duotone` — occasional decorative icons in admin cards

**Common icons by usage:**
- `TrendUp` / `TrendDown` — delta indicators in metric cards
- `CaretLeft` / `CaretRight` — pagination, table sort arrows
- `ArrowsCounterClockwise` — refresh/sync buttons
- `GearSix` — settings links in admin table rows
- `CalendarBlank` — date pickers
- `Robot` — AI generation actions
- `Warning`, `CheckCircle`, `XCircle` — alert severity icons
- `CopySimple` — copy-to-clipboard
- `Eye` / `EyeSlash` — show/hide password

---

## Chart Patterns (Recharts)

**Library:** recharts v2.12.0

### SpendChart pattern (ComposedChart)
```tsx
<ComposedChart data={merged}>
  <XAxis dataKey="date" />
  <YAxis yAxisId="spend" />
  <YAxis yAxisId="conv" orientation="right" />
  <Bar yAxisId="spend" dataKey="spend" fill={colorSpend} />
  <Bar yAxisId="spend" dataKey="priorSpend" fill={colorPriorSpend} />
  <Line yAxisId="conv" dataKey="conversions" stroke={colorConversions} />
  <Line yAxisId="conv" dataKey="priorConversions" stroke={colorPriorConversions} strokeDasharray="4 2" />
  <Tooltip />
  <Legend />
</ComposedChart>
```

### Sparkline pattern (AreaChart)
```tsx
<AreaChart data={data}>
  <defs>
    <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="5%" stopColor={color} stopOpacity={0.4} />
      <stop offset="95%" stopColor={color} stopOpacity={0} />
    </linearGradient>
  </defs>
  <Area type="monotone" dataKey="v" stroke={color} fill="url(#grad)" isAnimationActive={false} />
</AreaChart>
```
Animation is always disabled on sparklines (`isAnimationActive={false}`).

### GSC Trend Chart (ComposedChart — GscTrendChart.tsx)
Bars for clicks (left axis), dashed line for impressions (right axis), dual y-axes.

### Color assignment per metric type
| Metric | Color |
|---|---|
| Spend / cost | `chart_color_spend` (default `#93c5fd`) |
| Prior spend | `chart_color_prior_spend` (default `#94a3b8`) |
| Conversions | `chart_color_conversions` (default `#059669`) |
| Prior conversions | `chart_color_prior_conversions` (default `#34d399`) |
| Domain Rating sparkline | brand-500 (`#3b82f6`) |
| Sessions sparkline | emerald (`#059669`) |

---

## Animation Patterns (Framer Motion)

**Library:** framer-motion v12.35.0

### Standard card entrance (MetricCard, SparkMetricCard, ClientHealthCard)
```tsx
<motion.div
  initial={{ opacity: 0, y: 8 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.3, delay }}
>
```
`delay` is typically `index * 0.05` for staggered grid entrance.

### Respecting reduced motion
All animated components call `useReducedMotion()` from framer-motion. When true, skip the animation entirely (render at final state immediately).

### Modal overlays
Modals (IntegrationModal, LightboxImage, PMaxAssetSlider) use CSS transitions or direct DOM manipulation rather than framer-motion, to keep bundle size low.

### Ad Fuel badge fill animation
CSS transition on height: `transition: height 0.8s ease-out`. Starts at 0 on mount via `mounted` state gate in `AdFuelBadge.tsx`.

---

## Anti-Patterns — What NOT to Do

- **Do not use `text-blue-500` for brand blue.** Use `text-brand-500` or `text-blue-600` (the closest Tailwind default). The brand scale is in `tailwind.config.ts`.
- **Do not animate charts.** All Recharts charts set `isAnimationActive={false}` to avoid jarring re-renders on filter changes.
- **Do not use `<img>` for platform logos.** Use `<ConnectorLogo type="..." />` to get the correct SVG with proper accessibility attributes.
- **Do not hardcode chart colors.** Read from `agency_settings.chart_color_*` so agency can customize them.
- **Do not use `motion.div` without `useReducedMotion` guard.**
- **Do not use `role="tablist"` custom markup.** Use `<TabContainer>` which already has correct ARIA.
- **Do not add `'use client'` to server data-fetching components.** Dashboard cards like `GA4SummaryCard`, `GSCSummaryCard`, `GBPSummaryCard`, `AhrefsSummaryCard`, and `ConnectionSummaryCard` are server components — keep them that way.
- **Do not render raw HTML email content in iframes without sandboxing.** The `ReportModal` iframe uses the `/api/export/report?format=email` route which returns sanitized HTML.

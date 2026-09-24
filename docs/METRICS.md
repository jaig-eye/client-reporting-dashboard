# METRICS.md — What every number means, and where it comes from

The dashboard reports the same business from four systems that disagree with each other. This is the
agreement: which system owns which number, what we call it in front of a client, and what we never say.

Two rules hold the whole thing together:

1. **One source per row.** A row's number comes from the system that actually saw the event. Never
   stitch two systems together inside a single figure.
2. **Ads are counted by the platform.** Google and Meta report their own conversions, and those are
   the numbers we show. Everything else is counted by the CRM.

---

## Channels and programs

The client-facing name is the only one they ever see. The key is what the code uses.

### Paid — counted by the platform

| Client-facing name | Key | Source | Notes |
|---|---|---|---|
| Google Search ads | `google_ads` + `SEARCH` | Google Ads API | Split by `campaign.advertising_channel_type` |
| Performance Max | `PERFORMANCE_MAX` | Google Ads API | Can't be split into prospecting vs remarketing |
| Google Display ads | `DISPLAY` | Google Ads API | |
| YouTube ads | `VIDEO` | Google Ads API | |
| Demand Gen | `DEMAND_GEN` | Google Ads API | |
| Google Shopping | `SHOPPING` | Google Ads API | |
| Facebook & Instagram ads | `meta_ads` | Meta **ad-level** table | Never campaign-level — it lags |
| Other ads | `other_paid` | GHL attribution | Bing, TikTok etc. We don't sync those platforms, so the CRM is the only source |

**Retargeting is not a row.** No platform reports it as a campaign type. It's an audience setting, and
until we sync audience targeting, any "Retargeting" row would be guessed from campaign names.

### Not paid — counted by the CRM (GHL)

Every contact GHL tied to an ad is **excluded** from these rows, because the platform already counted them.

| Client-facing name | Key | Notes |
|---|---|---|
| Google Business Profile | `google_business` | Usually the biggest of these. Includes calls straight from the listing, which never touch the website |
| Direct | `direct` | Came straight to the website |
| Organic search | `organic_search` | Google, Bing and other search engines — **not** the listing |
| Social media | `social` | Organic posts, not ads |
| Referral sites | `referral` | Other websites linking in |
| Email campaigns | `email` | Clicks from email GHL sent |
| AI assistants | `ai_assistant` | ChatGPT, Copilot, Perplexity and others |

### Never shown to a client

These are real contacts, but no honest channel name fits, so they stay off client-facing reports.
They remain visible on admin surfaces.

| Key | Why it's excluded |
|---|---|
| `call_or_message` | A call, text or chat with no website visit and no channel |
| `website_call` | They were on the site, but nothing says what brought them |
| `untracked` | No source recorded at all |
| `other` | A label none of the rules recognise |
| `imported`, `added_manually` | Not marketing — put in the CRM by a person or an import |

---

## Metrics

### On the Overview

| Name | Definition | Source |
|---|---|---|
| **Conversions** | Ad conversions from the platforms **plus** CRM contacts for the non-ad channels | Google + Meta + GHL |
| **Cost per conversion** | Ad spend ÷ **ad** conversions only | Google + Meta |
| **Ad spend** | Spend after the Ad Fuel gross-up | Google + Meta ad-level |
| **Visits** | Ads: clicks. Everything else: website sessions for that channel | Google, Meta, GA4 |
| **Conversion rate** | Conversions ÷ visits, per row | derived |
| **Calls from ads** | Every call Google logged from an ad | Google Ads call reporting |
| **Reviews** | Rating and review count | Google Business Profile |
| **Google listing actions** | Calls + website clicks + direction requests | Google Business Profile |

### On the CRM tab

The tab keeps the name **CRM**. What it counts is **contacts**, never "leads".

| Name | Definition | Source |
|---|---|---|
| **Contacts** | People who got in touch, spam excluded | GHL |
| **Phone calls** | Every call that reached the business | GHL |
| **Form submissions** | Website form completions | GHL |
| **Opportunities** | Opportunities opened | GHL |
| **Jobs won / value** | Won opportunities and their value | GHL — only shown when there is data |
| **Calls answered** | Share of inbound calls answered, as a percentage | GHL — *needs the missed-calls fix; reads a false 100% until then* |

### Admin only — never on a client dashboard

| Name | What it's for |
|---|---|
| **Traced to a person** | How many of a platform's conversions we can tie to a CRM contact |
| **Attribution coverage** | Share of contacts with a known channel |
| **Conversion-action breakdown** | What a platform's conversion total is made of, by action |
| **Unassigned** | GA4 conversions it couldn't attribute |

---

## Words we don't use in front of clients

| Don't say | Say instead | Why |
|---|---|---|
| Leads | Conversions (Overview) / Contacts (CRM) | A client reads "leads" and "conversions" as the same thing, and they aren't |
| CPA, CPL | Cost per conversion | |
| CTR, CPM, CPC | Click rate, cost per thousand views, cost per click | |
| Unassigned, untracked, no source | *(omit the row)* | Says more about our tracking than their business |
| Impressions | Times your ad was shown | |

---

## Rules for displaying a number

**Conversions are fractional.** Under data-driven attribution Google splits one conversion across the
campaigns that contributed, so 92.25 is a real value. Store it unrounded; round only to display.

**Parts always add to their total.** Round the parts so their sum equals the rounded total, using
largest-remainder. Google's 37 / 43.5 / 36.98 displays as 37 / 43 / 37 = 117, never 118.

**No total mixes units.** Ad rows count actions; CRM rows count people. The program table's total is
the one place they're added, and it can overlap by the ad conversions the CRM couldn't attribute.

**Attribution model: last non-direct click**, with a 30-day lookback. The most recent visit that says
where someone came from. A direct visit never overwrites a real channel.

**Ad Fuel:** `applyAdFuel(rawSpend, cutPct)` is a gross-up, not a markup — `rawSpend / (1 - cutPct)`.

**Meta conversions** always come from `resolveMetaConversions` **on the ad-level table**. Campaign-level
lags, and the raw `conversions` column sums every action type.

---

## Known disagreements, and what to say

| Situation | Why | What we say |
|---|---|---|
| Google reports more conversions than the CRM has contacts | Google counts actions including repeats and taps; the CRM counts people once | "Google counts every call, tap and form, including repeats from the same person" |
| A platform reports a conversion we can't attribute | The click ID didn't reach the CRM | Nothing to the client. It's an admin concern |
| Google Ads counts fewer calls than we recorded | Its call conversion only counts calls over a minute | "Calls from ads" shows every call; the conversion count is the subset |
| GA4 and the ad platform disagree on the same channel | Different attribution models and windows | Never show both for the same channel |

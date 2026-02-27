# Client Reporting Dashboard

White-labeled PPC reporting dashboard for your agency clients. Clients log in via magic link and see their Google Ads + Meta performance in real time.

## Features

- Magic link login (no passwords — Supabase handles delivery)
- Live dashboard: spend, ROAS, leads, CTR with prior-period comparison
- Date range picker
- Campaign drill-down table
- Google Ads + Meta API sync (auto-refreshing tokens)
- Scheduled daily sync via Vercel Cron
- Export to CSV
- Admin panel to add clients and link ad accounts

## Tech Stack

- **Framework**: Next.js 14 (App Router, TypeScript)
- **Database + Auth**: Supabase (PostgreSQL + Magic Link)
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **Email**: Resend
- **Hosting**: Vercel
- **Ad APIs**: Google Ads API v16, Meta Marketing API v18

---

## Step-by-Step Setup

### 1. Clone the repo

```bash
git clone https://github.com/jaig-eye/client-reporting-dashboard.git
cd client-reporting-dashboard
npm install
```

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → New Project
2. Save your **Project URL** and **anon key** (Settings → API)
3. Run migrations in the Supabase SQL editor (copy from `supabase/migrations/`)
   - Run `001_initial_schema.sql` first
   - Then `002_rls_policies.sql`
4. In Supabase → Authentication → Email:
   - Enable **Magic Links**
   - Set **Site URL** to `https://reports.yourdomain.com` (or `http://localhost:3000` for dev)
   - Add `https://reports.yourdomain.com/auth/callback` to **Redirect URLs**

### 3. Set up Google Ads API

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → Create project
2. Enable **Google Ads API**
3. Create **OAuth 2.0 Web credentials**
4. Add `https://reports.yourdomain.com/api/auth/google/callback` as redirect URI
5. Apply for a [Developer Token](https://developers.google.com/google-ads/api/docs/first-call/dev-token) in your Google Ads MCC

### 4. Set up Meta Marketing API

1. Go to [developers.facebook.com](https://developers.facebook.com) → Create Business app
2. Add **Marketing API** product
3. Add `https://reports.yourdomain.com/api/auth/meta/callback` as redirect URI

### 5. Set up Resend (email)

1. Go to [resend.com](https://resend.com) → Create account → API Keys
2. Verify your sending domain

### 6. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in all values in `.env.local` (see `.env.example` for descriptions).

### 7. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)
- Admin panel: `/admin`
- Client login: `/login`

---

## Deploy to Vercel

### 1. Push to GitHub and import to Vercel

1. Go to [vercel.com](https://vercel.com) → New Project → Import from GitHub
2. Select `client-reporting-dashboard`
3. Add all environment variables from `.env.example`
4. Deploy

### 2. Add your custom subdomain

1. In Vercel → Project → **Settings → Domains**
2. Click **Add** → type `reports.youragency.com`
3. Vercel will show you a **CNAME record** like:
   ```
   CNAME  reports  cname.vercel-dns.com
   ```
4. Go to your DNS provider (Cloudflare, GoDaddy, Namecheap, etc.)
5. Add that CNAME record
6. Wait 1–24 hours for DNS propagation
7. Vercel auto-provisions an SSL certificate

### 3. Update OAuth redirect URIs

After deploying, update your Google + Meta OAuth apps to add:
- `https://reports.youragency.com/api/auth/google/callback`
- `https://reports.youragency.com/api/auth/meta/callback`

Also update `NEXT_PUBLIC_APP_URL` in Vercel environment variables.

---

## Adding a Client

1. Go to `/admin` → **New Client**
2. Enter client name and email
3. Click **Connect Google Ads** or **Connect Meta** to link their ad accounts
4. The client gets a magic link invite email
5. They log in and see their dashboard at `/dashboard`

## Data Sync

- **Manual**: Admin panel → Sync button per client
- **Automatic**: Vercel Cron runs daily at 6am UTC (`/api/cron/sync`)
- Sync pulls last 90 days on first run, then incremental daily updates

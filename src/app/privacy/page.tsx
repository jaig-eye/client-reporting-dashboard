export const metadata = {
  title: 'Privacy Policy',
}

export default function PrivacyPage() {
  const updated = 'March 3, 2026'

  return (
    <div className="min-h-screen bg-[#080c18] text-slate-300">
      <div className="max-w-3xl mx-auto px-6 py-16">

        <h1 className="text-2xl font-bold text-white mb-2">Privacy Policy</h1>
        <p className="text-sm text-slate-500 mb-10">Last updated: {updated}</p>

        <Section title="1. Overview">
          <p>
            This Privacy Policy describes how our marketing performance dashboard (&quot;Service&quot;,
            &quot;we&quot;, &quot;us&quot;) collects, uses, and protects information obtained through
            connections to third-party advertising platforms including Google Ads and Meta (Facebook)
            Ads. The Service is operated by a digital marketing agency and is made available to
            authorised clients for the purpose of viewing their own advertising performance data.
          </p>
        </Section>

        <Section title="2. Information We Collect">
          <p className="mb-3">We collect the following categories of data:</p>
          <ul className="list-disc list-inside space-y-2 text-slate-400">
            <li>
              <strong className="text-slate-300">Advertising performance data</strong> — campaign
              names, spend, impressions, clicks, conversions, and conversion value retrieved from
              connected Google Ads and Meta Ads accounts via their official APIs.
            </li>
            <li>
              <strong className="text-slate-300">Ad account identifiers</strong> — platform-assigned
              account IDs used to query the advertising APIs.
            </li>
            <li>
              <strong className="text-slate-300">OAuth tokens</strong> — access and refresh tokens
              issued by Google and Meta are stored encrypted and are used solely to retrieve
              advertising data on behalf of the account owner.
            </li>
            <li>
              <strong className="text-slate-300">Client contact information</strong> — name and
              email address provided to the agency at onboarding, stored to manage dashboard access.
            </li>
          </ul>
        </Section>

        <Section title="3. How We Use Your Information">
          <p className="mb-3">Information collected through the Service is used exclusively to:</p>
          <ul className="list-disc list-inside space-y-2 text-slate-400">
            <li>Display advertising performance metrics on your private, token-protected dashboard.</li>
            <li>Generate historical trend analysis and period-over-period comparisons.</li>
            <li>Calculate aggregated efficiency scores based on your campaign data.</li>
            <li>Produce CSV/PDF exports of your own performance data upon request.</li>
          </ul>
          <p className="mt-3">
            We do not sell, rent, share, or otherwise disclose your advertising data or account
            identifiers to any third party, except as required to operate the Service (e.g.
            database hosting).
          </p>
        </Section>

        <Section title="4. Meta (Facebook) API Data">
          <p className="mb-3">
            When you authorise the Service to access your Meta Ads account, we request the
            following permissions:
          </p>
          <ul className="list-disc list-inside space-y-2 text-slate-400">
            <li>
              <code className="text-xs bg-[#1e2a40] px-1.5 py-0.5 rounded">ads_read</code> —
              read-only access to ad account insights and campaign metrics.
            </li>
          </ul>
          <p className="mt-3">
            We access only aggregated campaign-level statistics (spend, reach, impressions, clicks,
            conversions). We do not access personal data about individual Facebook users who saw or
            interacted with your ads. Data obtained through the Meta API is used solely for
            displaying your performance dashboard and is not used to train models or shared with
            any third party.
          </p>
          <p className="mt-3">
            You may revoke access at any time via{' '}
            <a
              href="https://www.facebook.com/settings?tab=applications"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline"
            >
              Facebook Settings &rarr; Apps and Websites
            </a>
            .
          </p>
        </Section>

        <Section title="5. Google Ads API Data">
          <p>
            When you authorise the Service to access your Google Ads account, we request read-only
            access to campaign performance reports via the Google Ads API. We access campaign-level
            metrics only (spend, impressions, clicks, conversions). We do not access user-level
            data, search terms, or audience information. OAuth tokens are stored securely and used
            only to retrieve your advertising data.
          </p>
          <p className="mt-3">
            You may revoke access at any time via{' '}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline"
            >
              Google Account &rarr; Third-party apps &amp; services
            </a>
            .
          </p>
        </Section>

        <Section title="6. Data Storage and Security">
          <p>
            All data is stored in a Supabase-managed PostgreSQL database hosted on secure cloud
            infrastructure. Access tokens are stored and transmitted over encrypted connections
            (TLS). Dashboard access is restricted to clients via unique, unguessable tokens issued
            by the agency. We implement reasonable technical and organisational measures to protect
            data against unauthorised access, loss, or disclosure.
          </p>
        </Section>

        <Section title="7. Data Retention">
          <p>
            Campaign metrics are retained for as long as your client relationship with the agency
            is active. Upon termination of the relationship, your data will be deleted within 30
            days upon request. OAuth tokens are invalidated immediately upon disconnection of an
            ad account.
          </p>
        </Section>

        <Section title="8. Your Rights">
          <p className="mb-3">You have the right to:</p>
          <ul className="list-disc list-inside space-y-2 text-slate-400">
            <li>Request a copy of the data we hold about you.</li>
            <li>Request correction of inaccurate data.</li>
            <li>Request deletion of your data.</li>
            <li>Revoke API access at any time through Google or Meta account settings.</li>
          </ul>
          <p className="mt-3">
            To exercise any of these rights, contact us using the details in Section 10.
          </p>
        </Section>

        <Section title="9. Third-Party Services">
          <p className="mb-3">The Service relies on the following third-party providers:</p>
          <ul className="list-disc list-inside space-y-2 text-slate-400">
            <li>
              <strong className="text-slate-300">Supabase</strong> — database hosting.{' '}
              <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Privacy Policy</a>
            </li>
            <li>
              <strong className="text-slate-300">Vercel</strong> — application hosting and deployment.{' '}
              <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Privacy Policy</a>
            </li>
            <li>
              <strong className="text-slate-300">Google LLC</strong> — Google Ads API.{' '}
              <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Privacy Policy</a>
            </li>
            <li>
              <strong className="text-slate-300">Meta Platforms, Inc.</strong> — Meta Marketing API.{' '}
              <a href="https://www.facebook.com/privacy/policy" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Privacy Policy</a>
            </li>
          </ul>
        </Section>

        <Section title="10. Contact">
          <p>
            If you have questions about this Privacy Policy or wish to exercise your data rights,
            please contact the agency that granted you access to this dashboard. If you are an
            agency administrator and have questions about data handling, contact us at the email
            address registered with your account.
          </p>
        </Section>

        <Section title="11. Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. The &quot;Last updated&quot; date
            at the top of this page reflects the most recent revision. Continued use of the Service
            after changes are posted constitutes acceptance of the updated policy.
          </p>
        </Section>

      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold text-white mb-3">{title}</h2>
      <div className="text-sm leading-relaxed text-slate-400 space-y-2">{children}</div>
    </section>
  )
}

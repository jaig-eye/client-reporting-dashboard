export const metadata = { title: 'Terms of Service' }

export default function TermsPage() {
  return (
    <div className="min-h-screen py-16 px-6" style={{ background: 'var(--bg-base)' }}>
      <div className="max-w-3xl mx-auto text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Terms of Service</h1>
        <p className="mb-10" style={{ color: 'var(--text-muted)' }}>Last updated: March 10, 2025</p>
        <div className="space-y-6">
          <S t="1. Acceptance">By accessing this reporting dashboard, you agree to these Terms.</S>
          <S t="2. Service Description">This dashboard provides read-only access to your advertising performance data sourced from connected Google Ads and Meta Ads accounts. The service is provided by the agency that manages your advertising campaigns.</S>
          <S t="3. Authorised Use">Access is granted solely to the client entity associated with this dashboard. You may not share your access token with third parties or use the service to access data belonging to other clients.</S>
          <S t="4. Data Accuracy">Metrics displayed are sourced from platform APIs and are subject to the accuracy and availability of those platforms. We make no warranties regarding the completeness or real-time accuracy of the data.</S>
          <S t="5. Intellectual Property">All agency branding, dashboard design, and software remain the property of the agency. Client advertising data remains the property of the client.</S>
          <S t="6. Limitation of Liability">To the maximum extent permitted by law, the agency shall not be liable for indirect, incidental, or consequential damages arising from your use of this service.</S>
          <S t="7. Termination">Access may be revoked by the agency at any time. Upon termination, your data will be retained for 30 days before permanent deletion unless earlier deletion is requested.</S>
          <S t="8. Governing Law">These Terms are governed by the laws of the jurisdiction in which the agency is incorporated.</S>
          <S t="9. Changes">We reserve the right to update these Terms. Continued use of the service constitutes acceptance of any changes.</S>
        </div>
      </div>
    </div>
  )
}

function S({ t, children }: { t: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{t}</h2>
      <p>{children}</p>
    </section>
  )
}

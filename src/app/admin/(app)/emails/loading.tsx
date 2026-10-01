import { Sk, SkHeader, SkPage, SkTabs, SkRows } from '@/components/ui/Skeleton'

// The Emails page while it loads: header with its one action, the status tabs and client filter,
// and a card of email rows.
export default function EmailsLoading() {
  return (
    <SkPage label="Loading emails">
      <SkHeader actions={1} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }} aria-hidden>
        <SkTabs count={5} />
        <Sk w={220} h={36} r={8} style={{ maxWidth: '100%' }} />
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}><SkRows rows={5} /></div>
    </SkPage>
  )
}

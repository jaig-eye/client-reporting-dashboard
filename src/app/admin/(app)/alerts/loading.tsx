import '@/styles/admin/alerts.css'
import { Sk, SkHeader, SkTabs, SkRows, SkPage } from '@/components/ui/Skeleton'

// Matches AlertsPage: header, the type tabs, the filters, then a card of alert rows.
export default function AlertsLoading() {
  return (
    <SkPage label="Loading alerts">
      <SkHeader actions={2} />
      <SkTabs count={5} />
      <div className="al-filters" aria-hidden><Sk w={240} h={38} r={8} /><Sk w={120} h={20} r={10} /></div>
      <div className="card al-list" aria-hidden>
        <SkRows rows={6} />
      </div>
    </SkPage>
  )
}

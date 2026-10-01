import '@/styles/admin/alerts.css'
import { SkHeader, SkTabs, SkRows, SkPage } from '@/components/ui/Skeleton'

// Matches AlertsPage: header, the type tabs, then a card of alert rows.
export default function AlertsLoading() {
  return (
    <SkPage label="Loading alerts">
      <SkHeader actions={0} />
      <SkTabs count={5} />
      <div className="card al-list" aria-hidden>
        <SkRows rows={6} />
      </div>
    </SkPage>
  )
}

import '@/styles/admin/adfuel.css'
import { SkHeader, SkTabs, SkTable, SkRows, SkPage, Sk } from '@/components/ui/Skeleton'

// Matches the Dashboard tab: header, tabs, the totals strip and the balances table.
export default function AdFuelLoading() {
  return (
    <SkPage label="Loading Ad Fuel">
      <SkHeader actions={1} />
      <SkTabs count={3} />
      <div className="card af-stats" aria-hidden>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="af-stat"><Sk w={96} h={11} /><Sk w={88} h={24} r={6} /><Sk w={70} h={10} /></div>
        ))}
      </div>
      <div className="card ui-section" style={{ overflow: 'hidden' }} aria-hidden>
        <div className="ui-section-head" style={{ paddingBottom: 14 }}>
          <div className="ui-section-text" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Sk w={90} h={14} />
            <Sk w="min(380px, 80%)" h={11} />
          </div>
          <Sk w={104} h={28} r={6} />
        </div>
        <div className="af-table-wrap"><SkTable rows={5} cols={8} /></div>
        <div className="af-list"><SkRows rows={5} tile={false} /></div>
      </div>
    </SkPage>
  )
}

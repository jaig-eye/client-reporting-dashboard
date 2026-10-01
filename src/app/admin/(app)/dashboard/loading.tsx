import { SkHeader, SkTable, SkPage, Sk } from '@/components/ui/Skeleton'

export default function DashboardLoading() {
  return (
    <SkPage label="Loading clients">
      <SkHeader actions={2} />
      <div className="card cl-stats" aria-hidden>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="cl-stat"><Sk w={96} h={11} /><Sk w={72} h={24} r={6} /></div>
        ))}
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}><SkTable rows={8} cols={7} /></div>
    </SkPage>
  )
}

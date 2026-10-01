import { SkHeader, SkRows, SkPage, Sk } from '@/components/ui/Skeleton'

export default function ConnectionsLoading() {
  return (
    <SkPage label="Loading integrations">
      <SkHeader actions={0} />
      {[3, 3, 2].map((rows, i) => (
        <div key={i} style={{ marginTop: i ? 28 : 0 }}>
          <Sk w={150} h={14} style={{ marginBottom: 10 }} />
          <div className="card" style={{ padding: 0 }}><SkRows rows={rows} /></div>
        </div>
      ))}
    </SkPage>
  )
}

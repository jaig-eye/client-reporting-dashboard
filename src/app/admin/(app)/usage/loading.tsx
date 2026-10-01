import { SkHeader, SkStats, SkCard, SkPage } from '@/components/ui/Skeleton'

export default function UsageLoading() {
  return (
    <SkPage label="Loading usage">
      <SkHeader actions={0} />
      <SkStats count={4} />
      <div className="ui-stack"><SkCard /><SkCard /></div>
    </SkPage>
  )
}

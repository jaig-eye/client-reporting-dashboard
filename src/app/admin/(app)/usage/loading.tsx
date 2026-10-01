import { SkHeader, SkTabs, SkPage } from '@/components/ui/Skeleton'
import { USAGE_BODY_SKELETON } from './UsageSkeleton'

export default function UsageLoading() {
  return (
    <SkPage label="Loading usage">
      <SkHeader actions={0} />
      <SkTabs count={4} />
      {USAGE_BODY_SKELETON}
    </SkPage>
  )
}

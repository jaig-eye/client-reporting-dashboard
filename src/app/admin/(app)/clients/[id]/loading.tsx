import { SkTabs, SkPage } from '@/components/ui/Skeleton'
import { ClientHeaderSkeleton, CLIENT_TAB_SKELETONS } from './ClientSkeletons'

// loading.tsx can't see ?tab=, so it shows the Overview, where a client page opens.
export default function ClientLoading() {
  return (
    <SkPage label="Loading client">
      <ClientHeaderSkeleton />
      <SkTabs count={6} />
      {CLIENT_TAB_SKELETONS.overview}
    </SkPage>
  )
}

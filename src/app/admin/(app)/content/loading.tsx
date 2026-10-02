import '@/styles/admin/content.css'
import { ContentHeader, ContentViewSkeleton } from '@/components/admin/ContentViews'
import { SkTabs } from '@/components/ui/Skeleton'

// Shown on a first visit while the server reads. loading.tsx can't see ?view=, so it shows Review,
// the landing view; switching views in place shows each view's own skeleton (ContentViews).
export default function ContentLoading() {
  return (
    <div aria-busy="true" aria-label="Loading content">
      <ContentHeader />
      <div style={{ marginBottom: 20 }}><SkTabs count={4} /></div>
      <ContentViewSkeleton view="review" />
    </div>
  )
}

import { ContentViewSkeleton } from '@/components/admin/ContentViews'

// Shown on a first visit while the server reads. loading.tsx can't see ?view=, so it shows Review,
// the landing view; switching views in place shows each view's own skeleton (ContentViews).
export default function ContentLoading() {
  return (
    <div>
      <div className="page-header cv-header">
        <h1 className="page-title" style={{ margin: 0 }}>Content</h1>
        <div style={{ flex: 1 }} />
        <span className="skeleton" style={{ display: 'block', width: 320, maxWidth: '60%', height: 32, borderRadius: 8 }} />
      </div>
      <ContentViewSkeleton view="review" />
    </div>
  )
}

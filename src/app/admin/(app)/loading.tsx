import { SkHeader, SkCard, SkPage } from '@/components/ui/Skeleton'

// The fallback for any admin page without a skeleton of its own: a header and two cards, in the
// same shimmer as the rest.
export default function AdminLoading() {
  return (
    <SkPage>
      <SkHeader actions={1} />
      <div className="ui-stack"><SkCard /><SkCard /></div>
    </SkPage>
  )
}

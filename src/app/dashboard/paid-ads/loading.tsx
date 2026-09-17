// Held while this page's queries run, so a tab switch answers straight away instead of leaving
// the previous page on screen. Shaped to what this page renders — see PageSkeleton.
import PageSkeleton from '@/components/dashboard/PageSkeleton'

export default function Loading() {
  return <PageSkeleton kpis={5} blocks={[1,1]} lede={false} />
}

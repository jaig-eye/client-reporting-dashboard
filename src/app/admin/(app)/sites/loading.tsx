import '@/styles/admin/sites.css'
import { Sk, SkHeader, SkPage, SkRows } from '@/components/ui/Skeleton'

// Sites while the page loads: the header, the four-figure health strip, the filter toolbar and
// a card of site rows, in the same places the real ones land.
export default function SitesLoading() {
  return (
    <SkPage label="Loading sites">
      <SkHeader actions={2} />
      <div className="card st-stats" aria-hidden>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="st-stat">
            <Sk w={96} h={11} />
            <Sk w={64} h={24} r={6} style={{ marginTop: 6 }} />
            <Sk w={120} h={10} style={{ marginTop: 4 }} />
          </div>
        ))}
      </div>
      <div className="st-toolbar" aria-hidden>
        <Sk w={186} h={38} r={999} />
        <span className="st-search"><Sk h={36} r={8} /></span>
        <span className="st-filters"><Sk w={118} h={36} r={8} /><Sk w={130} h={36} r={8} /></span>
      </div>
      <div className="card st-list"><SkRows rows={5} /></div>
    </SkPage>
  )
}

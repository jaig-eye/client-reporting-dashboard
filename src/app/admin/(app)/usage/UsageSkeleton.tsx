import { Sk, SkCard } from '@/components/ui/Skeleton'

/** The Usage page below its header and period tabs. */
export const USAGE_BODY_SKELETON = (
  <div aria-hidden>
    <div className="card us-stats">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="us-stat"><Sk w={90} h={11} /><Sk w={96} h={26} r={6} /><Sk w={120} h={10} /></div>
      ))}
    </div>
    <div className="ui-grid-side" style={{ marginBottom: 16 }}>
      <SkCard><Sk w="100%" h={150} r={8} /></SkCard>
      <SkCard><Sk w="70%" h={18} /><Sk w="100%" h={10} r={999} style={{ marginTop: 14 }} /><Sk w={160} h={34} r={8} style={{ marginTop: 18 }} /></SkCard>
    </div>
    <div className="ui-grid-2"><SkCard /><SkCard /><SkCard /><SkCard /></div>
  </div>
)

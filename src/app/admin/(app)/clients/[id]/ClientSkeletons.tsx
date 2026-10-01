// Skeletons for the client page: the whole page (loading.tsx, first visit) and each tab (shown the
// moment a tab is clicked, while the server builds it).

import { Sk, SkText, SkRows, SkCard, SkTabs, SkTable } from '@/components/ui/Skeleton'

export function ClientHeaderSkeleton() {
  return (
    <div className="ui-ph" aria-hidden>
      <div className="ui-ph-main">
        <Sk w={48} h={48} r={14} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Sk w={70} h={11} />
          <Sk w={240} h={22} r={6} />
        </div>
      </div>
      <div className="ui-ph-actions"><Sk w={150} h={36} r={8} /><Sk w={32} h={32} r={6} /></div>
    </div>
  )
}

function SectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="card ui-section" aria-hidden>
      <div className="ui-section-head"><div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}><Sk w={180} h={14} /><Sk w="55%" h={11} /></div></div>
      <div className="ui-section-body"><SkText lines={rows} /></div>
    </div>
  )
}

export const CLIENT_TAB_SKELETONS = {
  overview: (
    <div className="ui-grid-side">
      <div className="ui-stack"><SkCard><SkText lines={5} /></SkCard><SkCard><SkRows rows={3} /></SkCard></div>
      <div className="ui-stack"><SkCard><SkText lines={4} /></SkCard><SkCard /></div>
    </div>
  ),
  sources: (
    <div className="ui-stack" style={{ maxWidth: 760 }}>
      <div className="card" style={{ padding: 0 }}><SkRows rows={5} /></div>
      <div className="card" style={{ padding: 0 }}><SkRows rows={4} /></div>
    </div>
  ),
  performance: <div className="ui-stack" style={{ maxWidth: 820 }}><SectionSkeleton rows={4} /><SectionSkeleton /><SectionSkeleton /></div>,
  content: (
    <div>
      <SkTabs count={5} />
      <div className="card" style={{ padding: 0 }}><SkRows rows={6} /></div>
    </div>
  ),
  billing: <div className="ui-stack" style={{ maxWidth: 820 }}><SectionSkeleton rows={2} /><div className="card" style={{ padding: 0 }}><SkTable rows={5} cols={4} /></div></div>,
  advanced: <div className="ui-stack" style={{ maxWidth: 820 }}><SectionSkeleton /><SectionSkeleton /><SectionSkeleton rows={4} /></div>,
}

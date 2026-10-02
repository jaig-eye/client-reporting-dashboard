import { Sk, SkCard, SkHeader, SkPage, SkRows } from '@/components/ui/Skeleton'

// Campaign categories while they load: header with its button, the list, then the mode guide.
export default function CategoriesLoading() {
  return (
    <SkPage label="Loading categories">
      <SkHeader actions={1} />
      <div className="ui-stack">
        <div className="card" style={{ padding: 0, overflow: 'hidden' }} aria-hidden>
          <div style={{ padding: '18px 20px 6px' }}><Sk w={100} h={14} /></div>
          <SkRows rows={4} />
        </div>
        <SkCard><span className="ui-grid-2" style={{ marginTop: 16 }}>{[0, 1, 2, 3].map(i => <span key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><Sk w="30%" h={11} /><Sk w="80%" h={10} /></span>)}</span></SkCard>
      </div>
    </SkPage>
  )
}

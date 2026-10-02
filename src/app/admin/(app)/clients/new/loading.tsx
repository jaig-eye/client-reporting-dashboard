import { Sk, SkCard, SkHeader, SkPage } from '@/components/ui/Skeleton'

// Add a client while the page loads: header, then the two fields.
export default function NewClientLoading() {
  const field = (w: string) => <span style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><Sk w={w} h={11} /><Sk h={38} r={8} /></span>
  return (
    <SkPage label="Loading">
      <div style={{ maxWidth: 560 }}>
        <SkHeader actions={0} />
        <SkCard><span className="ui-fields" style={{ marginTop: 16 }}>{field('22%')}{field('16%')}</span></SkCard>
      </div>
    </SkPage>
  )
}

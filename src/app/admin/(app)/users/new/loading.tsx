import '@/styles/admin/users.css'
import { Sk, SkCard, SkHeader, SkPage } from '@/components/ui/Skeleton'

// Add a user while the page loads: header, then one section of five fields.
export default function NewUserLoading() {
  const field = (w: string) => <span style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><Sk w={w} h={11} /><Sk h={38} r={8} /></span>
  return (
    <SkPage label="Loading">
      <div className="us-page">
        <SkHeader actions={0} />
        <SkCard><span className="ui-fields" style={{ marginTop: 16 }}>{field('18%')}{field('12%')}{field('16%')}{field('28%')}{field('10%')}</span></SkCard>
      </div>
    </SkPage>
  )
}

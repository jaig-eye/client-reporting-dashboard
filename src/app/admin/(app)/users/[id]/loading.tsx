import '@/styles/admin/users.css'
import { Sk, SkCard, SkPage } from '@/components/ui/Skeleton'

// Edit user while it loads: back link, avatar and name, then the two sections of fields.
export default function EditUserLoading() {
  const field = (w: string) => <span style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><Sk w={w} h={11} /><Sk h={38} r={8} /></span>
  return (
    <SkPage label="Loading user">
      <div className="us-page">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: '1.5rem' }}>
          <Sk w={60} h={11} />
          <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Sk w={44} h={44} r={999} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}><Sk w="40%" h={20} /><Sk w="55%" h={11} /></span>
          </span>
        </div>
        <div className="ui-stack">
          <SkCard><span className="ui-fields" style={{ marginTop: 16 }}>{field('20%')}{field('14%')}{field('18%')}{field('10%')}</span></SkCard>
          <SkCard><span className="ui-fields" style={{ marginTop: 16 }}>{field('24%')}</span></SkCard>
        </div>
      </div>
    </SkPage>
  )
}

import '@/styles/admin/users.css'
import { Sk, SkCard, SkHeader, SkPage } from '@/components/ui/Skeleton'

// Your profile while it loads: header, the profile section with its photo, then the password one.
export default function ProfileLoading() {
  const field = (w: string) => <span style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><Sk w={w} h={11} /><Sk h={38} r={8} /></span>
  return (
    <SkPage label="Loading your profile">
      <div className="us-page">
        <SkHeader actions={0} />
        <div className="ui-stack">
          <SkCard>
            <span className="ui-fields" style={{ marginTop: 16 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}><Sk w={56} h={56} r={999} /><Sk w={120} h={32} r={6} /></span>
              {field('12%')}{field('10%')}
            </span>
          </SkCard>
          <SkCard><span className="ui-fields" style={{ marginTop: 16 }}>{field('22%')}<span className="ui-grid-2">{field('30%')}{field('36%')}</span></span></SkCard>
        </div>
      </div>
    </SkPage>
  )
}

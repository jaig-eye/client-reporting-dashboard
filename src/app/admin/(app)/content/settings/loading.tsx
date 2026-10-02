import '@/styles/admin/content.css'
import { Sk, SkCard, SkPage } from '@/components/ui/Skeleton'

// Content settings while they load: back link and title, then the prompt sections.
export default function ContentSettingsLoading() {
  return (
    <SkPage label="Loading content settings">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: '1.5rem' }}><Sk w={70} h={11} /><Sk w={220} h={24} /><Sk w="min(420px, 80%)" h={12} /></div>
      <div className="cs ui-stack">
        <SkCard><span className="ui-fields" style={{ marginTop: 16 }}><Sk w="30%" h={11} /><Sk h={130} r={8} /><Sk w={80} h={38} r={8} /></span></SkCard>
        <SkCard><span className="ui-fields" style={{ marginTop: 16 }}><Sk w="24%" h={11} /><Sk h={260} r={8} /></span></SkCard>
      </div>
    </SkPage>
  )
}

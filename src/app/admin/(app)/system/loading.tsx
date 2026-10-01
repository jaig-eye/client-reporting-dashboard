import '@/styles/admin/system.css'
import { Sk, SkCard, SkHeader, SkPage, SkRows, SkTable, SkTabs } from '@/components/ui/Skeleton'

// System & logs while the page loads: header, the two tabs, the two sync cards side by side, then
// the sync log table (rows on a phone).
export default function SystemLoading() {
  return (
    <SkPage label="Loading system and logs">
      <SkHeader actions={0} />
      <SkTabs count={2} />
      <div className="sy-panel">
        <div className="ui-grid-2 sy-run">
          <SkCard><Sk w="70%" h={11} /><Sk w={260} h={38} r={8} style={{ marginTop: 16 }} /></SkCard>
          <SkCard><Sk w="80%" h={11} /><span style={{ display: 'flex', gap: 10, marginTop: 16 }}><Sk w={120} h={38} r={8} /><Sk w={140} h={38} r={8} /></span></SkCard>
        </div>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }} aria-hidden>
          <div style={{ padding: '18px 20px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Sk w={120} h={14} />
            <Sk w="min(440px, 80%)" h={11} />
            <span style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}><Sk w={260} h={38} r={999} /><Sk w={200} h={36} r={8} /></span>
          </div>
          <div className="sy-sk-wide"><SkTable rows={8} cols={7} /></div>
          <div className="sy-sk-list"><SkRows rows={6} /></div>
        </div>
      </div>
    </SkPage>
  )
}

import '@/styles/admin/content.css'
import { Sk, SkHeader, SkPage, SkTabs } from '@/components/ui/Skeleton'

// The planner while it loads: header, the six counts, the tabs, then a keyword table.
export default function SiloLoading() {
  return (
    <SkPage label="Loading the planner">
      <SkHeader actions={1} />
      <div className="sd-stats">{Array.from({ length: 6 }, (_, i) => <div key={i} className="sd-stat"><Sk w={28} h={20} /><Sk w="70%" h={10} /></div>)}</div>
      <div style={{ marginBottom: 20 }}><SkTabs count={5} /></div>
      <Sk w={300} h={38} r={8} style={{ marginBottom: 18 }} />
      <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }} aria-hidden>
        {Array.from({ length: 4 }, (_, i) => <span key={i} style={{ display: 'flex', gap: 16 }}><Sk w={16} h={16} r={4} /><Sk w="30%" h={12} /><Sk w="14%" h={12} /><Sk w="12%" h={12} /></span>)}
      </div>
    </SkPage>
  )
}

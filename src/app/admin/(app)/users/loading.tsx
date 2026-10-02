import '@/styles/admin/users.css'
import { Sk, SkHeader, SkPage } from '@/components/ui/Skeleton'

// Users while the list loads: header with its button, then rows shaped like the real ones.
export default function UsersLoading() {
  return (
    <SkPage label="Loading users">
      <SkHeader actions={1} />
      <div className="card" style={{ padding: '4px 0', overflow: 'hidden' }} aria-hidden>
        <ul className="us-list">
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className="us-row">
              <div className="us-who">
                <Sk w={36} h={36} r={999} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}><Sk w="38%" h={12} /><Sk w="56%" h={10} /></span>
              </div>
              <div className="us-meta">
                <div className="us-role"><Sk w={52} h={20} r={999} /></div>
                <div className="us-status"><Sk w={64} h={20} r={999} /></div>
                <div className="us-seen"><Sk w={110} h={11} /></div>
              </div>
              <div className="us-act"><Sk w={32} h={32} r={8} /></div>
            </li>
          ))}
        </ul>
      </div>
    </SkPage>
  )
}

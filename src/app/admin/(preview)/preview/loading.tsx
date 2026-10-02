import { SkHeader, SkRows, SkPage } from '@/components/ui/Skeleton'

// Choosing a client to preview: the header and the client list.
export default function PreviewLoading() {
  return (
    <SkPage label="Loading clients to preview">
      <div style={{ maxWidth: 720, padding: 'var(--adm-gutter)' }}>
        <SkHeader actions={0} />
        <div className="card" style={{ padding: 0 }}><SkRows rows={6} /></div>
      </div>
    </SkPage>
  )
}

import Bone from '@/components/admin/Bone'

export default function ClientsLoading() {
  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Bone className="h-7 w-24 rounded" />
        <Bone className="h-8 w-32 rounded" />
      </div>
      <Bone className="h-8 w-64 rounded mb-4" />
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {[...Array(8)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
            <Bone className="h-4 w-40 rounded" />
            <Bone className="h-4 w-24 rounded" style={{ marginLeft: 'auto' }} />
            <Bone className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

import Bone from '@/components/admin/Bone'

export default function DashboardLoading() {
  return (
    <div>
      <div className="page-header">
        <Bone className="h-7 w-28 rounded" />
      </div>
      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card p-4">
            <Bone className="h-3 w-20 rounded mb-3" />
            <Bone className="h-7 w-16 rounded" />
          </div>
        ))}
      </div>
      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <Bone className="h-4 w-24 rounded" />
        </div>
        {[...Array(8)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
            <Bone className="h-4 w-36 rounded" />
            <Bone className="h-4 w-20 rounded" style={{ marginLeft: 'auto' }} />
            <Bone className="h-4 w-16 rounded" />
            <Bone className="h-4 w-16 rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}

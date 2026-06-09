import Bone from '@/components/admin/Bone'

export default function AdFuelLoading() {
  return (
    <div>
      <div className="page-header flex items-center justify-between">
        <Bone className="h-7 w-20 rounded" />
        <Bone className="h-8 w-32 rounded" />
      </div>
      {/* Tab strip */}
      <div className="flex gap-1 mb-6 border-b" style={{ borderColor: 'var(--border)' }}>
        {[80, 60, 72].map((w, i) => (
          <Bone key={i} className="h-8 rounded-t" style={{ width: w }} />
        ))}
      </div>
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="card p-4">
            <Bone className="h-3 w-24 rounded mb-3" />
            <Bone className="h-8 w-20 rounded" />
          </div>
        ))}
      </div>
      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {[...Array(10)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
            <Bone className="h-4 w-32 rounded" />
            <Bone className="h-4 w-24 rounded" style={{ marginLeft: 'auto' }} />
            <Bone className="h-4 w-16 rounded" />
            <Bone className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

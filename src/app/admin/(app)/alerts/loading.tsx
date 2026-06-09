import Bone from '@/components/admin/Bone'

export default function AlertsLoading() {
  return (
    <div>
      <div className="page-header">
        <Bone className="h-7 w-16 rounded" />
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {[...Array(8)].map((_, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
            <Bone className="h-8 w-8 rounded-full flex-shrink-0" />
            <div className="flex-1">
              <Bone className="h-4 w-48 rounded mb-2" />
              <Bone className="h-3 w-72 rounded" />
            </div>
            <Bone className="h-3 w-16 rounded flex-shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}

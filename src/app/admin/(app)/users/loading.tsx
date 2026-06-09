import Bone from '@/components/admin/Bone'

export default function UsersLoading() {
  return (
    <div>
      <div className="page-header flex items-center justify-between">
        <Bone className="h-7 w-16 rounded" />
        <Bone className="h-8 w-28 rounded" />
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {[...Array(6)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
            <Bone className="h-9 w-9 rounded-full flex-shrink-0" />
            <div>
              <Bone className="h-4 w-32 rounded mb-1" />
              <Bone className="h-3 w-48 rounded" />
            </div>
            <Bone className="h-5 w-16 rounded-full" style={{ marginLeft: 'auto' }} />
            <Bone className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

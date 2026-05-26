import Bone from '@/components/admin/Bone'

export default function ConnectionsLoading() {
  return (
    <div>
      <div className="page-header">
        <Bone className="h-7 w-36 rounded" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {[...Array(6)].map((_, i) => (
          <div key={i} className="card" style={{ padding: 20 }}>
            <Bone className="h-5 w-24 rounded mb-3" />
            <Bone className="h-4 w-full rounded mb-2" />
            <Bone className="h-4 w-3/4 rounded" style={{ marginBottom: 12 }} />
            <Bone className="h-8 w-28 rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}
